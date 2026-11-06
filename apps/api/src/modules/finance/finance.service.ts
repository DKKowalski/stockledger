import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import { calendarDay, dateRange } from '../../common/date-range.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { toCsv } from '../settings/csv.js';
import { buildFinanceYear, DEFAULT_FINANCE_CATEGORIES, FINANCE_LINES, type FinanceStatus } from './finance-calculations.js';
import type { FinanceCategoryDto, FinanceEntryDto, FinanceExportDto, FinanceQueryDto, SaveBudgetDto } from './finance.dto.js';

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
    const source = await this.inventory.profitabilitySource(tx, companyId);
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

  private assertFinanceDate(value: string) {
    dateRange({ from: value, to: value });
    const year = Number(value.slice(0, 4));
    if (year < 2000 || year > 2100) throw new BadRequestException('Choose a date between 2000 and 2100');
  }

  private async audit(tx: PrismaTransaction, companyId: string, actorUserId: string, action: string, entityType: string, entityId: string, metadata: Record<string, string | number | boolean | null | Array<Record<string, string | number>>>) {
    await tx.orm.public.AuditEvent.create({ companyId, actorUserId, action: action as Varchar<80>, entityType: entityType as Varchar<80>, entityId, metadata });
  }
}
