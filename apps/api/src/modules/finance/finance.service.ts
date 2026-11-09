import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import { calendarDay, dateRange } from '../../common/date-range.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { toCsv } from '../settings/csv.js';
import { buildFinanceYear, DEFAULT_FINANCE_CATEGORIES, FINANCE_LINES, type FinanceStatus } from './finance-calculations.js';
import { randomUUID } from 'node:crypto';
import { allocateProfit, CAPITAL_DESTINATION, CAPITAL_PART_KEY, CAPITAL_PART_NAME, capitalAmountCents, DEFAULT_SPLIT_PARTS, validateSplitParts, type SplitPartSetting } from './profit-split.js';
import type { CompleteSplitPartDto, SaveProfitSplitDto, FinanceCategoryDto, FinanceEntryDto, FinanceExportDto, FinanceQueryDto, SaveBudgetDto } from './finance.dto.js';

const ENTRY_LIST_LIMIT = 500;

// An in-progress month compares its full budget with actuals so far; a year compares elapsed months.
function basis(period: { month: string; status: FinanceStatus }) {
  const year = period.month.length === 4;
  if (period.status === 'future') return 'Not started';
  if (period.status === 'complete') return year ? 'Full year' : 'Complete month';
  return year ? 'Year to date' : 'Month to date';
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService, private readonly inventory: InventoryService) {}

  // Profit data is owner-only today, so finance follows the same rule as Profitability.
  private async owner(tx: PrismaTransaction, companyId: string, userId: string) {
    const actor = await tx.orm.public.User.first({ id: userId, companyId });
    if (!actor || !actor.isActive) throw new UnauthorizedException('Account no longer exists');
    if (actor.role !== 'administrator') throw new ForbiddenException('Only an administrator can access finance reports');
    return actor;
  }

  private async categories(tx: PrismaTransaction, companyId: string) {
    const categories = await tx.orm.public.FinanceCategory.where({ companyId }).all();
    return categories.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Must run at READ COMMITTED: a waiter has to see the rows the first request committed.
  private async ensureCategories(tx: PrismaTransaction, companyId: string) {
    if (await tx.orm.public.FinanceCategory.first({ companyId })) return;
    await tx.query(this.prisma.client.raw.sql`SELECT id FROM public.companies WHERE id = ${companyId}::uuid FOR UPDATE`.returnsRow({ id: 'pg/uuid@1' }).build());
    if (await tx.orm.public.FinanceCategory.first({ companyId })) return;
    for (const name of DEFAULT_FINANCE_CATEGORIES) await tx.orm.public.FinanceCategory.create({ companyId, name: name as Varchar<80> });
  }

  private async prepare(userId: string, companyId: string) {
    await this.prisma.withCompany(companyId, async tx => {
      await this.owner(tx, companyId, userId);
      await this.ensureCategories(tx, companyId);
    });
  }

  private async read(tx: PrismaTransaction, userId: string, companyId: string, query: FinanceQueryDto) {
    await this.owner(tx, companyId, userId);
    const company = await tx.orm.public.Company.first({ id: companyId });
    if (!company) throw new UnauthorizedException('Business no longer exists');
    const now = new Date();
    const year = query.year ?? Number(calendarDay(now, company.timeZone).slice(0, 4));
    const [from, to] = [`${year}-01-01`, `${year}-12-31`];
    const categories = await this.categories(tx, companyId);
    const source = await this.inventory.profitabilitySource(tx, companyId, undefined, { from, to });
    const entries = await tx.orm.public.FinanceEntry.where({ companyId }).where(entry => entry.entryDate.gte(from)).where(entry => entry.entryDate.lte(to)).all();
    const budgets = await tx.orm.public.FinanceBudget.where({ companyId }).where(budget => budget.month.gte(from)).where(budget => budget.month.lte(to)).all();
    return { ...buildFinanceYear(year, source, categories, entries, budgets, now, company.timeZone), company: { name: company.name, currency: company.currency, timeZone: company.timeZone }, categories: categories.map(({ id, name, isActive }) => ({ id, name, isActive })) };
  }

  async report(userId: string, companyId: string, query: FinanceQueryDto) {
    await this.prepare(userId, companyId);
    return this.prisma.withCompany(companyId, tx => this.read(tx, userId, companyId, query), { consistentSnapshot: true });
  }

  async entries(userId: string, companyId: string, query: { from?: string; to?: string }) {
    const range = dateRange(query);
    return this.prisma.withCompany(companyId, async tx => {
      await this.owner(tx, companyId, userId);
      const entries = tx.orm.public.FinanceEntry.where({ companyId });
      const scoped = range ? entries.where(entry => entry.entryDate.gte(range.from)).where(entry => entry.entryDate.lte(range.to)) : entries;
      const rows = await scoped.orderBy([entry => entry.entryDate.desc(), entry => entry.createdAt.desc()]).limit(ENTRY_LIST_LIMIT + 1).all();
      return { entries: rows.slice(0, ENTRY_LIST_LIMIT), truncated: rows.length > ENTRY_LIST_LIMIT, limit: ENTRY_LIST_LIMIT };
    });
  }

  async saveCategory(userId: string, companyId: string, body: FinanceCategoryDto, id?: string) {
    return this.prisma.withCompany(companyId, async tx => {
      await this.owner(tx, companyId, userId);
      await this.ensureCategories(tx, companyId);
      const categories = await this.categories(tx, companyId);
      const name = body.name.trim();
      if (!name) throw new BadRequestException('Enter a category name');
      if (categories.some(category => category.id !== id && category.name.toLowerCase() === name.toLowerCase())) throw new ConflictException('A category with this name already exists');
      if (id && !categories.some(category => category.id === id)) throw new NotFoundException('Category not found');
      const values = { name: name as Varchar<80>, isActive: body.isActive ?? true };
      const category = id ? await tx.orm.public.FinanceCategory.where({ companyId, id }).update(values) : await tx.orm.public.FinanceCategory.create({ companyId, ...values });
      await this.audit(tx, companyId, userId, 'finance.category_saved', 'finance_category', id ?? category!.id, { name, isActive: values.isActive });
      return category;
    });
  }

  async saveEntry(userId: string, companyId: string, body: FinanceEntryDto, id?: string) {
    this.assertFinanceDate(body.entryDate);
    return this.prisma.withCompany(companyId, async tx => {
      await this.owner(tx, companyId, userId);
      await this.ensureCategories(tx, companyId);
      const current = id ? await tx.orm.public.FinanceEntry.first({ companyId, id }) : null;
      if (id && !current) throw new NotFoundException('Entry not found');
      if (body.kind === 'other_revenue' && body.categoryId) throw new BadRequestException('Other revenue has no expense category');
      if (body.kind === 'expense') {
        const category = (await this.categories(tx, companyId)).find(candidate => candidate.id === body.categoryId);
        // An archived category stays valid for the entries already filed under it.
        if (!category || (!category.isActive && current?.categoryId !== category.id)) throw new BadRequestException('Choose an active expense category');
      }
      const values = { kind: body.kind as Varchar<20>, categoryId: body.kind === 'expense' ? body.categoryId! : null, entryDate: body.entryDate, amountCents: body.amountCents, note: (body.note ?? '').trim() as Varchar<500> };
      const entry = id ? await tx.orm.public.FinanceEntry.where({ companyId, id }).update(values) : await tx.orm.public.FinanceEntry.create({ companyId, createdByUserId: userId, ...values });
      await this.audit(tx, companyId, userId, 'finance.entry_saved', 'finance_entry', id ?? entry!.id, { ...values });
      return entry;
    });
  }

  async deleteEntry(userId: string, companyId: string, id: string) {
    return this.prisma.withCompany(companyId, async tx => {
      await this.owner(tx, companyId, userId);
      const entry = await tx.orm.public.FinanceEntry.first({ companyId, id });
      if (!entry) throw new NotFoundException('Entry not found');
      await tx.orm.public.FinanceEntry.where({ companyId, id }).delete();
      await this.audit(tx, companyId, userId, 'finance.entry_deleted', 'finance_entry', id, { kind: entry.kind, amountCents: entry.amountCents, entryDate: entry.entryDate, note: entry.note });
      return { deleted: true };
    });
  }

  async saveBudget(userId: string, companyId: string, body: SaveBudgetDto) {
    this.assertFinanceDate(body.month);
    const year = body.month.slice(0, 4);
    return this.prisma.withCompany(companyId, async tx => {
      await this.owner(tx, companyId, userId);
      await this.ensureCategories(tx, companyId);
      const categories = await this.categories(tx, companyId);
      const keys = new Set<string>([...FINANCE_LINES, ...categories.map(category => `expense:${category.id}`)]);
      if (body.lines.some(line => !keys.has(line.lineKey)) || new Set(body.lines.map(line => line.lineKey)).size !== body.lines.length) throw new BadRequestException('Choose distinct report lines from this company');
      const months = body.copyToYear ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`) : [body.month];
      for (const month of months) for (const line of body.lines) {
        const lineKey = line.lineKey as Varchar<80>;
        await tx.orm.public.FinanceBudget.upsert({ create: { companyId, month, lineKey, amountCents: line.amountCents }, update: { amountCents: line.amountCents }, conflictOn: { companyId, month, lineKey } });
      }
      await this.audit(tx, companyId, userId, 'finance.budget_saved', 'company', companyId, { month: body.month, copyToYear: body.copyToYear ?? false, lines: body.lines.map(line => ({ ...line })) });
      return { saved: true };
    });
  }

  async export(userId: string, companyId: string, query: FinanceExportDto) {
    await this.prepare(userId, companyId);
    return this.prisma.withCompany(companyId, async tx => {
      const report = await this.read(tx, userId, companyId, query);
      const view = query.view ?? 'year';
      const month = report.months.find(row => row.month === query.month);
      if (view === 'month' && !month) throw new BadRequestException('Choose a month in the selected year');
      const year = { ...report.yearly, month: String(report.year) };
      const periods = view === 'months' ? [...report.months, year] : view === 'month' ? [month!] : [year];
      const amount = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));
      const rows = periods.flatMap(period => period.lines.map(line => [report.company.name, report.company.currency, period.month, basis(period), period.actualsTo ?? '', period.from, period.to, line.section, line.label, amount(line.budgetCents), amount(line.actualCents), amount(line.varianceCents), line.actualCents === null ? '' : line.variancePercent === null ? '—' : line.variancePercent.toFixed(2), 'fullBudgetCents' in line ? amount(line.fullBudgetCents as number) : '']));
      const content = toCsv(['Company', 'Currency', 'Period', 'Basis', 'Actuals through', 'From', 'To', 'Section', 'Line', 'Budget', 'Actual', 'Variance (positive is favourable)', 'Variance %', 'Full-year budget'], rows);
      await this.audit(tx, companyId, userId, 'finance.exported', 'company', companyId, { year: report.year, view, month: view === 'month' ? month!.month : null });
      return { content, filename: `stockledger-finance-${view === 'month' ? month!.month : report.year}-${view}.csv` };
    }, { consistentSnapshot: true });
  }

  // ---- Profit split: a plan and a record only; nothing here moves money. ----
  private async splitParts(tx: PrismaTransaction, companyId: string): Promise<{ usingDefaults: boolean; parts: SplitPartSetting[] }> {
    const rows = (await tx.orm.public.ProfitSplitPart.where({ companyId }).all()).sort((a, b) => a.position - b.position);
    if (!rows.length) return { usingDefaults: true, parts: DEFAULT_SPLIT_PARTS.map(part => ({ ...part })) };
    return { usingDefaults: false, parts: rows.map(row => ({ key: row.partKey, name: row.name, destination: row.destination, percentBasisPoints: row.percentBasisPoints })) };
  }

  private parseSplitMonth(month: string) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
    if (!match || Number(match[1]) < 2000 || Number(match[1]) > 2100) throw new BadRequestException('Choose a month as YYYY-MM between 2000 and 2100');
    return { year: Number(match[1]), from: `${month}-01` };
  }

  // Net profit is the Finance report's own Net Profit / Loss actual for the month, never recomputed.
  private async splitView(tx: PrismaTransaction, userId: string, companyId: string, month: string) {
    const { year, from } = this.parseSplitMonth(month);
    const report = await this.read(tx, userId, companyId, { year });
    const period = report.months.find(row => row.month === month)!;
    const netProfitCents = period.lines.find(line => line.key === 'net_profit')?.actualCents ?? 0;
    const settings = await this.splitParts(tx, companyId);
    const completions = await tx.orm.public.ProfitSplitCompletion.where({ companyId }).where(row => row.month.eq(from)).all();
    const today = calendarDay(new Date(), report.company.timeZone);
    const hasProfit = period.status !== 'future' && netProfitCents > 0;
    const amounts = hasProfit ? allocateProfit(netProfitCents, settings.parts.map(part => part.percentBasisPoints)) : [];
    const byKey = new Map<string, (typeof completions)[number]>(completions.map(row => [row.partKey, row]));
    const completionView = (row: (typeof completions)[number], currentAmountCents: number | null) => ({ doneOn: row.doneOn, note: row.note, amountCents: row.amountCents, percentBasisPoints: row.percentBasisPoints, partName: row.partName, destination: row.destination, changedSinceDone: currentAmountCents !== null && currentAmountCents !== row.amountCents });
    const parts = hasProfit ? settings.parts.map((part, index) => {
      const done = byKey.get(part.key);
      return { key: part.key, name: part.name, destination: part.destination, percent: part.percentBasisPoints / 100, percentBasisPoints: part.percentBasisPoints, amountCents: amounts[index]!, completion: done ? completionView(done, amounts[index]!) : null };
    }) : [];
    const cogsCents = period.lines.find(line => line.key === 'cogs')?.actualCents ?? 0;
    const capitalCents = period.status === 'future' ? 0 : capitalAmountCents(cogsCents);
    const capitalDone = byKey.get(CAPITAL_PART_KEY);
    const capital = {
      name: CAPITAL_PART_NAME, destination: CAPITAL_DESTINATION, amountCents: capitalCents, status: period.status,
      isEstimate: period.status === 'in_progress', canComplete: period.status === 'complete' && capitalCents > 0,
      completion: capitalDone ? completionView(capitalDone, capitalCents) : null,
    };
    const current = new Set(settings.parts.map(part => part.key));
    // Parts removed after being marked done keep their record so history is never rewritten.
    const retired = completions.filter(row => row.partKey !== CAPITAL_PART_KEY && (!current.has(row.partKey) || !hasProfit)).map(row => ({ key: row.partKey, ...completionView(row, null) }));
    return {
      month, status: period.status, currency: report.company.currency, timeZone: report.company.timeZone, today,
      netProfitCents, hasProfit, isEstimate: period.status === 'in_progress', canComplete: period.status === 'complete' && hasProfit,
      usingDefaults: settings.usingDefaults, settings: settings.parts.map(part => ({ key: part.key, name: part.name, destination: part.destination, percent: part.percentBasisPoints / 100 })),
      parts, retired, capital,
    };
  }

  async profitSplit(userId: string, companyId: string, month: string) {
    this.parseSplitMonth(month);
    await this.prepare(userId, companyId);
    return this.prisma.withCompany(companyId, tx => this.splitView(tx, userId, companyId, month), { consistentSnapshot: true });
  }

  // "Banked in <year>": the Done ticks for months of that year, grouped by the destination stored at tick time.
  async profitSplitSummary(userId: string, companyId: string, yearText: string) {
    if (!/^\d{4}$/.test(yearText) || Number(yearText) < 2000 || Number(yearText) > 2100) throw new BadRequestException('Choose a year between 2000 and 2100');
    await this.prepare(userId, companyId);
    return this.prisma.withCompany(companyId, async tx => {
      const settings = await this.splitParts(tx, companyId);
      const rows = (await tx.orm.public.ProfitSplitCompletion.where({ companyId }).all()).filter(row => row.month.startsWith(`${yearText}-`));
      const groups = new Map<string, { destination: string; partNames: Set<string>; amountCents: number; count: number }>();
      let capital = { amountCents: 0, count: 0 };
      for (const row of rows) {
        // Stock capital is its own line, never mixed into the profit accounts.
        if (row.partKey === CAPITAL_PART_KEY) { capital = { amountCents: capital.amountCents + row.amountCents, count: capital.count + 1 }; continue; }
        const group = groups.get(row.destination) ?? { destination: row.destination, partNames: new Set<string>(), amountCents: 0, count: 0 };
        group.partNames.add(row.partName); group.amountCents += row.amountCents; group.count += 1;
        groups.set(row.destination, group);
      }
      const order = new Map<string, number>();
      settings.parts.forEach((part, index) => { if (!order.has(part.destination)) order.set(part.destination, index); });
      const accounts = [...groups.values()].sort((a, b) => (order.get(a.destination) ?? Infinity) - (order.get(b.destination) ?? Infinity) || a.destination.localeCompare(b.destination))
        .map(group => ({ destination: group.destination, partNames: [...group.partNames].sort((a, b) => a.localeCompare(b)), amountCents: group.amountCents, count: group.count }));
      const profitCents = accounts.reduce((sum, account) => sum + account.amountCents, 0);
      // `accounts` and `totalCents` keep their original meaning (profit only); the capital fields are additive.
      return { year: Number(yearText), accounts, totalCents: profitCents, profitCents, capital: { destination: CAPITAL_DESTINATION, partName: CAPITAL_PART_NAME, ...capital }, capitalCents: capital.amountCents, grandTotalCents: profitCents + capital.amountCents };
    }, { consistentSnapshot: true });
  }

  async saveProfitSplitSettings(userId: string, companyId: string, body: SaveProfitSplitDto) {
    const checked = validateSplitParts(body.parts);
    if ('error' in checked) throw new BadRequestException(checked.error);
    return this.prisma.withCompany(companyId, async tx => {
      await this.owner(tx, companyId, userId);
      const taken = new Set(checked.parts.map(part => part.key).filter((key): key is string => Boolean(key)));
      const rows = checked.parts.map((part, index) => {
        let key = part.key;
        while (!key) { const candidate = `p-${randomUUID().slice(0, 12)}`; if (!taken.has(candidate)) { key = candidate; taken.add(candidate); } }
        return { key, position: index + 1, name: part.name, destination: part.destination, percentBasisPoints: part.percentBasisPoints };
      });
      await tx.orm.public.ProfitSplitPart.where({ companyId }).delete();
      for (const row of rows) await tx.orm.public.ProfitSplitPart.create({ companyId, partKey: row.key as Varchar<40>, position: row.position, name: row.name as Varchar<80>, destination: row.destination as Varchar<120>, percentBasisPoints: row.percentBasisPoints });
      await this.audit(tx, companyId, userId, 'finance.profit_split_settings_saved', 'company', companyId, { parts: rows.map(row => ({ key: row.key, name: row.name, destination: row.destination, percentBasisPoints: row.percentBasisPoints })) });
      return { saved: true };
    });
  }

  async completeSplitPart(userId: string, companyId: string, month: string, partKey: string, body: CompleteSplitPartDto) {
    const { from } = this.parseSplitMonth(month);
    if (body.doneOn) this.assertFinanceDate(body.doneOn);
    await this.prepare(userId, companyId);
    return this.prisma.withCompany(companyId, async tx => {
      const view = await this.splitView(tx, userId, companyId, month);
      if (view.status === 'in_progress') throw new BadRequestException("This month isn't finished, so its split can't be marked done yet");
      if (view.status === 'future' || !view.hasProfit) throw new BadRequestException('No profit to split this month');
      const part = view.parts.find(candidate => candidate.key === partKey);
      if (!part) throw new NotFoundException('Part not found');
      const doneOn = body.doneOn ?? view.today;
      if (doneOn > view.today) throw new BadRequestException('The done date cannot be in the future');
      const note = (body.note ?? '').trim();
      const existing = await tx.orm.public.ProfitSplitCompletion.first({ companyId, month: from, partKey: partKey as Varchar<40> });
      // Re-saving an already done part edits its date and note; the amount stays as first recorded.
      if (existing) await tx.orm.public.ProfitSplitCompletion.where({ companyId, id: existing.id }).update({ doneOn, note: note as Varchar<200> });
      else await tx.orm.public.ProfitSplitCompletion.create({ companyId, month: from, partKey: partKey as Varchar<40>, partName: part.name as Varchar<80>, destination: part.destination as Varchar<120>, amountCents: part.amountCents, percentBasisPoints: part.percentBasisPoints, doneOn, note: note as Varchar<200>, createdByUserId: userId });
      await this.audit(tx, companyId, userId, 'finance.profit_split_part_done', 'company', companyId, { month, partKey, amountCents: existing?.amountCents ?? part.amountCents, doneOn });
      return this.splitView(tx, userId, companyId, month);
    });
  }

  async completeCapital(userId: string, companyId: string, month: string, body: CompleteSplitPartDto) {
    const { from } = this.parseSplitMonth(month);
    if (body.doneOn) this.assertFinanceDate(body.doneOn);
    await this.prepare(userId, companyId);
    return this.prisma.withCompany(companyId, async tx => {
      const view = await this.splitView(tx, userId, companyId, month);
      if (view.status === 'in_progress') throw new BadRequestException("This month isn't finished, so its stock capital can't be marked done yet");
      if (view.status === 'future' || view.capital.amountCents <= 0) throw new BadRequestException('No stock was sold this month, so there is no stock capital to bank');
      const doneOn = body.doneOn ?? view.today;
      if (doneOn > view.today) throw new BadRequestException('The done date cannot be in the future');
      const note = (body.note ?? '').trim();
      const existing = await tx.orm.public.ProfitSplitCompletion.first({ companyId, month: from, partKey: CAPITAL_PART_KEY as Varchar<40> });
      // Re-saving edits the date and note; the amount stays as first recorded.
      if (existing) await tx.orm.public.ProfitSplitCompletion.where({ companyId, id: existing.id }).update({ doneOn, note: note as Varchar<200> });
      else await tx.orm.public.ProfitSplitCompletion.create({ companyId, month: from, partKey: CAPITAL_PART_KEY as Varchar<40>, partName: CAPITAL_PART_NAME as Varchar<80>, destination: CAPITAL_DESTINATION as Varchar<120>, amountCents: view.capital.amountCents, percentBasisPoints: 10_000, doneOn, note: note as Varchar<200>, createdByUserId: userId });
      await this.audit(tx, companyId, userId, 'finance.stock_capital_done', 'company', companyId, { month, partKey: CAPITAL_PART_KEY, amountCents: existing?.amountCents ?? view.capital.amountCents, doneOn });
      return this.splitView(tx, userId, companyId, month);
    });
  }

  async uncompleteCapital(userId: string, companyId: string, month: string) {
    const { from } = this.parseSplitMonth(month);
    return this.prisma.withCompany(companyId, async tx => {
      await this.owner(tx, companyId, userId);
      const existing = await tx.orm.public.ProfitSplitCompletion.first({ companyId, month: from, partKey: CAPITAL_PART_KEY as Varchar<40> });
      if (!existing) throw new NotFoundException('Stock capital is not marked done');
      await tx.orm.public.ProfitSplitCompletion.where({ companyId, id: existing.id }).delete();
      await this.audit(tx, companyId, userId, 'finance.stock_capital_undone', 'company', companyId, { month, partKey: CAPITAL_PART_KEY, amountCents: existing.amountCents });
      return this.splitView(tx, userId, companyId, month);
    });
  }

  async uncompleteSplitPart(userId: string, companyId: string, month: string, partKey: string) {
    const { from } = this.parseSplitMonth(month);
    return this.prisma.withCompany(companyId, async tx => {
      await this.owner(tx, companyId, userId);
      if (partKey === CAPITAL_PART_KEY) throw new NotFoundException('Part not found');
      const existing = await tx.orm.public.ProfitSplitCompletion.first({ companyId, month: from, partKey: partKey as Varchar<40> });
      if (!existing) throw new NotFoundException('This part is not marked done');
      await tx.orm.public.ProfitSplitCompletion.where({ companyId, id: existing.id }).delete();
      await this.audit(tx, companyId, userId, 'finance.profit_split_part_undone', 'company', companyId, { month, partKey, amountCents: existing.amountCents });
      return this.splitView(tx, userId, companyId, month);
    });
  }

  private assertFinanceDate(value: string) {
    dateRange({ from: value, to: value });
    const year = Number(value.slice(0, 4));
    if (year < 2000 || year > 2100) throw new BadRequestException('Choose a date between 2000 and 2100');
  }

  private async audit(tx: PrismaTransaction, companyId: string, actorUserId: string, action: string, entityType: string, entityId: string, metadata: Record<string, string | number | boolean | null | Array<Record<string, string | number>>>) {
    await tx.orm.public.AuditEvent.create({ companyId, actorUserId, action: action as Varchar<80>, entityType: entityType as Varchar<80>, entityId, metadata });
  }
}
