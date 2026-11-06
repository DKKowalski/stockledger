import { describe, expect, it } from 'vitest';
import type { MovementRecord } from '../inventory/inventory-calculations.js';
import { StockMovementType } from '../inventory/inventory.types.js';
import { buildProfitability } from '../inventory/profitability-calculations.js';
import { buildFinanceYear, financeLine, type FinanceCategory, type FinanceLine } from './finance-calculations.js';

const movement = (date: string, type = StockMovementType.SALE, overrides: Partial<MovementRecord> = {}): MovementRecord => ({ id: `${type}:${date}`, itemId: 'item', locationId: 'shop', destinationLocationId: null, quantity: 2, type, unitPriceCents: 900, unitCostCents: 500, supplierId: null, relatedMovementId: null, stockCountId: null, movementDate: date, reference: null, note: null, createdAt: `${date}T23:30:00Z`, ...overrides });
const source = { items: [], locations: [], movements: [movement('2026-01-31'), movement('2026-02-01', StockMovementType.RETURN_IN), movement('2026-12-31'), movement('2027-01-01')], discounts: [{ locationId: 'shop', itemId: 'item', movementDate: '2026-01-31', discountCents: 200 }] };
const category = { id: 'rent', name: 'Rent', isActive: false };
const entries = [{ id: 'e', kind: 'expense', categoryId: 'rent', entryDate: '2026-01-31', amountCents: 100, note: '' }, { id: 'r', kind: 'other_revenue', categoryId: null, entryDate: '2026-02-01', amountCents: 300, note: '' }];
const after = new Date('2028-06-15T12:00:00Z');
const build = (year: number, input: Parameters<typeof buildFinanceYear>[1], cats: readonly FinanceCategory[], rows: Parameters<typeof buildFinanceYear>[3], budgets: Parameters<typeof buildFinanceYear>[4]) => buildFinanceYear(year, input, cats, rows, budgets, after);
type Settled = FinanceLine & { actualCents: number; varianceCents: number };
const line = (report: { lines: readonly FinanceLine[] }, key: string) => report.lines.find(row => row.key === key)! as Settled;

describe('finance report calculations', () => {
  it('separates full-price sales, discounts and net-price returns without double deduction', () => {
    const report = build(2026, source, [category], entries, []);
    expect(line(report.months[0], 'sales').actualCents).toBe(2000);
    expect(line(report.months[0], 'discounts').actualCents).toBe(-200);
    expect(line(report.months[0], 'revenue').actualCents).toBe(1800);
    expect(line(report.months[1], 'returns').actualCents).toBe(-1800);
    expect(line(report.months[1], 'cogs').actualCents).toBe(-1000);
    expect(line(report.months[1], 'gross_profit').actualCents).toBe(-500);
  });
  it('reconciles each month to Profitability, including refunds and uncosted legacy sales', () => {
    const input = { ...source, movements: [...source.movements, movement('2026-01-10', StockMovementType.SALE, { unitCostCents: null })] };
    const report = build(2026, input, [category], entries, []);
    for (const month of report.months) {
      const profit = buildProfitability([], [], input.movements, { days: 30, from: month.from, to: month.to, locationId: null, locationType: null, itemId: null, category: null }, new Date(), input.discounts).summary;
      expect(line(month, 'revenue').actualCents - line(month, 'other_revenue').actualCents).toBe(profit.netSalesCents);
      expect(line(month, 'cogs').actualCents).toBe(profit.cogsCents);
      expect(line(month, 'gross_profit').actualCents - line(month, 'other_revenue').actualCents).toBe(profit.grossProfitCents);
    }
    expect(line(report.months[0], 'uncosted').actualCents).toBe(-1800);
  });
  it('sums every yearly amount from the 12 months, excludes next year and keeps archived categories', () => {
    const report = build(2026, source, [category], entries, [{ month: '2026-01-01', lineKey: 'expense:rent', amountCents: 150 }]);
    for (const [index, row] of report.yearly.lines.entries()) {
      expect(row.actualCents).toBe(report.months.reduce((sum, month) => sum + month.lines[index]!.actualCents!, 0));
      expect(row.budgetCents).toBe(report.months.reduce((sum, month) => sum + month.lines[index]!.budgetCents, 0));
      expect(row.varianceCents).toBe(report.months.reduce((sum, month) => sum + month.lines[index]!.varianceCents!, 0));
    }
    expect(line(report.yearly, 'sales').actualCents).toBe(3800);
    expect(line(report.yearly, 'expense:rent')).toMatchObject({ actualCents: 100, budgetCents: 150, varianceCents: 50 });
  });
  it('uses favourable-to-profit variances consistently, including negative revenue deductions', () => {
    expect(financeLine('sales', '', '', 100, 120)).toMatchObject({ varianceCents: 20, variancePercent: 20 });
    expect(financeLine('cogs', '', '', 100, 120, true)).toMatchObject({ varianceCents: -20, variancePercent: -20 });
    expect(financeLine('discounts', '', '', -100, -80)).toMatchObject({ varianceCents: 20, variancePercent: 20 });
    expect(financeLine('returns', '', '', -100, -120)).toMatchObject({ varianceCents: -20, variancePercent: -20 });
  });
  it('shows actuals without a budget and returns null percentages for zero budgets', () => {
    const report = build(2026, source, [], [], []);
    expect(report.yearly.hasBudget).toBe(false);
    expect(report.yearly.lines.every(row => row.variancePercent === null)).toBe(true);
    expect(line(report.months[0], 'gross_profit').actualCents).toBe(800);
  });
  it('handles leap days and month end inclusive, irrespective of creation time', () => {
    const report = build(2024, { ...source, movements: [movement('2024-02-29'), movement('2024-03-01')], discounts: [] }, [], [], []);
    expect(report.months[1].to).toBe('2024-02-29');
    expect(line(report.months[1], 'revenue').actualCents).toBe(1800);
    expect(line(report.months[2], 'revenue').actualCents).toBe(1800);
  });
  it('reverses a discounted sale at its net price, so a full return leaves nothing in revenue', () => {
    const discountedSale = movement('2026-03-10', StockMovementType.SALE, { unitPriceCents: 800 });
    const refund = movement('2026-03-12', StockMovementType.RETURN_IN, { unitPriceCents: 800 });
    const report = build(2026, { items: [], locations: [], movements: [discountedSale, refund], discounts: [{ locationId: 'shop', itemId: 'item', movementDate: '2026-03-10', discountCents: 400 }] }, [], [], []);
    const march = report.months[2]!;
    expect(line(march, 'sales').actualCents).toBe(2000);
    expect(line(march, 'discounts').actualCents).toBe(-400);
    expect(line(march, 'returns').actualCents).toBe(-1600);
    expect(line(march, 'revenue').actualCents).toBe(0);
    expect(line(march, 'cogs').actualCents).toBe(0);
  });
  it('keeps sales lacking a cost out of profit and reports their coverage for months and the year', () => {
    const report = build(2026, { items: [], locations: [], movements: [movement('2026-05-05'), movement('2026-06-05', StockMovementType.SALE, { unitCostCents: null }), movement('2026-06-06', StockMovementType.SALE, { unitPriceCents: null, unitCostCents: null })], discounts: [] }, [], [], []);
    expect(line(report.months[5]!, 'revenue').actualCents).toBe(1800);
    expect(line(report.months[5]!, 'uncosted').actualCents).toBe(-1800);
    expect(line(report.months[5]!, 'gross_profit').actualCents).toBe(0);
    expect(report.months[5]).toMatchObject({ costCoveragePercent: 0, profitability: { uncostedSaleUnits: 4 } });
    expect(report.yearly).toMatchObject({ costCoveragePercent: 33.33, profitability: { unitsSold: 6, uncostedSaleUnits: 4 } });
    expect(line(report.yearly, 'net_profit').actualCents).toBe(800);
  });
  it('matches a whole-year Profitability range, not only the individual months', () => {
    const profit = buildProfitability([], [], source.movements, { days: 30, from: '2026-01-01', to: '2026-12-31', locationId: null, locationType: null, itemId: null, category: null }, new Date(), source.discounts).summary;
    const report = build(2026, source, [category], entries, []);
    expect(report.yearly.profitability).toMatchObject({ netSalesCents: profit.netSalesCents, grossProfitCents: profit.grossProfitCents, inventoryLossCents: profit.inventoryLossCents });
    expect(line(report.yearly, 'revenue').actualCents).toBe(profit.netSalesCents + 300);
    expect(line(report.yearly, 'gross_profit').actualCents).toBe(profit.grossProfitCents + 300);
  });
  it('treats a zero budget as a dash and never produces Infinity or NaN', () => {
    const report = build(2026, source, [category], entries, [{ month: '2026-01-01', lineKey: 'sales', amountCents: 0 }]);
    for (const period of [...report.months, report.yearly]) for (const row of period.lines) {
      expect(row.variancePercent).toBeNull();
      expect(Number.isFinite(row.varianceCents)).toBe(true);
    }
    expect(report.months[0]!.hasBudget).toBe(false);
  });
  it('uses month boundaries inclusively and ignores entries outside the month', () => {
    const report = build(2026, source, [{ ...category, isActive: true }], [{ id: 'a', kind: 'expense', categoryId: 'rent', entryDate: '2026-01-31', amountCents: 10, note: '' }, { id: 'b', kind: 'expense', categoryId: 'rent', entryDate: '2026-02-01', amountCents: 20, note: '' }], []);
    expect(line(report.months[0]!, 'expense:rent').actualCents).toBe(10);
    expect(line(report.months[1]!, 'expense:rent').actualCents).toBe(20);
  });
  it('drops an archived category only when its year has nothing recorded', () => {
    const idle = { id: 'idle', name: 'Idle', isActive: false };
    const report = build(2026, source, [category, idle], entries, []);
    expect(report.yearly.lines.some(row => row.key === 'expense:idle')).toBe(false);
    expect(report.months.every(month => month.lines.length === report.yearly.lines.length)).toBe(true);
    expect(line(report.yearly, 'expense:rent').label).toBe('Rent (archived)');
  });
  it('includes recorded inventory loss in operating expenses, separately from gross profit', () => {
    const report = build(2026, { ...source, movements: [movement('2026-01-02', StockMovementType.DAMAGE)] }, [], [], []);
    expect(line(report.months[0], 'inventory_loss').actualCents).toBe(1000);
    expect(line(report.months[0], 'net_profit').actualCents).toBe(-1000);
  });
});

describe('unfinished periods', () => {
  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}-01`, lineKey: 'sales', amountCents: 1000 }));
  const sales = { items: [], locations: [], discounts: [], movements: [movement('2026-10-15'), movement('2026-11-05'), movement('2026-11-07')] };
  const report = (now: string, timeZone?: string, year = 2026) => buildFinanceYear(year, sales, [], [], monthly, new Date(now), timeZone);

  it('shows a future month as budget only, with no actual or variance', () => {
    const december = report('2026-11-06T12:00:00Z').months[11]!;
    expect(december).toMatchObject({ status: 'future', actualsTo: null });
    for (const row of december.lines) expect(row).toMatchObject({ actualCents: null, varianceCents: null, variancePercent: null });
    expect(december.lines.find(row => row.key === 'sales')!.budgetCents).toBe(1000);
    expect(december.lines.find(row => row.key === 'net_profit')!.budgetCents).toBe(1000);
  });
  it('keeps the current month against its whole budget, with actuals only to today', () => {
    const november = report('2026-11-06T12:00:00Z').months[10]!;
    expect(november).toMatchObject({ status: 'in_progress', actualsTo: '2026-11-06', from: '2026-11-01', to: '2026-11-30', futureDatedRecords: true });
    expect(line(november, 'sales')).toMatchObject({ budgetCents: 1000, actualCents: 1800, varianceCents: 800 });
  });
  it('treats the last day of a month as in progress and the next day as complete', () => {
    expect(report('2026-11-30T12:00:00Z').months[10]).toMatchObject({ status: 'in_progress', actualsTo: '2026-11-30' });
    expect(report('2026-12-01T12:00:00Z').months[10]).toMatchObject({ status: 'complete', actualsTo: '2026-11-30' });
  });
  it('compares the current year with elapsed months and keeps the full-year budget separately', () => {
    const { yearly, months } = report('2026-11-06T12:00:00Z');
    expect(yearly).toMatchObject({ status: 'in_progress', actualsTo: '2026-11-06', futureDatedRecords: true, hasBudget: true });
    expect(yearly.lines.find(row => row.key === 'sales')).toMatchObject({ budgetCents: 11_000, fullBudgetCents: 12_000, actualCents: 3600, varianceCents: -7400 });
    const covered = months.slice(0, 11);
    for (const [index, row] of yearly.lines.entries()) {
      expect(row.budgetCents).toBe(covered.reduce((sum, month) => sum + month.lines[index]!.budgetCents, 0));
      expect(row.actualCents).toBe(covered.reduce((sum, month) => sum + month.lines[index]!.actualCents!, 0));
      expect(row.varianceCents).toBe(covered.reduce((sum, month) => sum + month.lines[index]!.varianceCents!, 0));
    }
  });
  it('treats a finished year as twelve complete months and counts every record', () => {
    const { yearly, months } = report('2027-02-01T12:00:00Z');
    expect(months.every(month => month.status === 'complete')).toBe(true);
    expect(yearly).toMatchObject({ status: 'complete', actualsTo: '2026-12-31', futureDatedRecords: false });
    expect(yearly.lines.find(row => row.key === 'sales')).toMatchObject({ budgetCents: 12_000, fullBudgetCents: 12_000, actualCents: 5400 });
  });
  it('turns the year on the company calendar, not on UTC', () => {
    const now = '2026-12-31T23:30:00Z';
    expect(report(now, 'UTC').yearly).toMatchObject({ status: 'in_progress', actualsTo: '2026-12-31' });
    expect(report(now, 'Pacific/Auckland').yearly).toMatchObject({ status: 'complete', actualsTo: '2026-12-31' });
    expect(report(now, 'Pacific/Auckland', 2027).months[0]).toMatchObject({ status: 'in_progress', actualsTo: '2027-01-01' });
    expect(report('2027-01-01T03:00:00Z', 'America/Los_Angeles').months[11]).toMatchObject({ status: 'in_progress', actualsTo: '2026-12-31' });
  });
  it('shows a year that has not started as its full budget, with no actuals', () => {
    const { yearly } = buildFinanceYear(2027, sales, [], [], monthly.map(row => ({ ...row, month: row.month.replace('2026', '2027') })), new Date('2026-11-06T12:00:00Z'));
    expect(yearly).toMatchObject({ status: 'future', actualsTo: null, hasBudget: true });
    expect(yearly.lines.find(row => row.key === 'sales')).toMatchObject({ budgetCents: 12_000, fullBudgetCents: 12_000, actualCents: null, varianceCents: null });
  });
  it('flags a record dated ahead instead of counting or silently dropping it', () => {
    const rent = { id: 'r', kind: 'other_revenue', categoryId: null, entryDate: '2026-12-20', amountCents: 500, note: '' };
    const year = buildFinanceYear(2026, { items: [], locations: [], movements: [], discounts: [] }, [], [rent], [], new Date('2026-11-06T12:00:00Z'));
    expect(year.months[11]).toMatchObject({ futureDatedRecords: true });
    expect(year.yearly.lines.find(row => row.key === 'other_revenue')!.actualCents).toBe(0);
  });
});
