import { describe, expect, it } from 'vitest';
import type { MovementRecord } from '../inventory/inventory-calculations.js';
import { StockMovementType } from '../inventory/inventory.types.js';
import { buildProfitability } from '../inventory/profitability-calculations.js';
import { buildFinanceYear, financeLine } from './finance-calculations.js';

const movement = (date: string, type = StockMovementType.SALE, overrides: Partial<MovementRecord> = {}): MovementRecord => ({ id: `${type}:${date}`, itemId: 'item', locationId: 'shop', destinationLocationId: null, quantity: 2, type, unitPriceCents: 900, unitCostCents: 500, supplierId: null, relatedMovementId: null, stockCountId: null, movementDate: date, reference: null, note: null, createdAt: `${date}T23:30:00Z`, ...overrides });
const source = { items: [], locations: [], movements: [movement('2026-01-31'), movement('2026-02-01', StockMovementType.RETURN_IN), movement('2026-12-31'), movement('2027-01-01')], discounts: [{ locationId: 'shop', itemId: 'item', movementDate: '2026-01-31', discountCents: 200 }] };
const category = { id: 'rent', name: 'Rent', isActive: false };
const entries = [{ id: 'e', kind: 'expense', categoryId: 'rent', entryDate: '2026-01-31', amountCents: 100, note: '' }, { id: 'r', kind: 'other_revenue', categoryId: null, entryDate: '2026-02-01', amountCents: 300, note: '' }];
const line = (report: ReturnType<typeof buildFinanceYear>['yearly'], key: string) => report.lines.find(row => row.key === key)!;

describe('finance report calculations', () => {
  it('separates full-price sales, discounts and net-price returns without double deduction', () => {
    const report = buildFinanceYear(2026, source, [category], entries, []);
    expect(line(report.months[0], 'sales').actualCents).toBe(2000);
    expect(line(report.months[0], 'discounts').actualCents).toBe(-200);
    expect(line(report.months[0], 'revenue').actualCents).toBe(1800);
    expect(line(report.months[1], 'returns').actualCents).toBe(-1800);
    expect(line(report.months[1], 'cogs').actualCents).toBe(-1000);
    expect(line(report.months[1], 'gross_profit').actualCents).toBe(-500);
  });
  it('reconciles each month to Profitability, including refunds and uncosted legacy sales', () => {
    const input = { ...source, movements: [...source.movements, movement('2026-01-10', StockMovementType.SALE, { unitCostCents: null })] };
    const report = buildFinanceYear(2026, input, [category], entries, []);
    for (const month of report.months) {
      const profit = buildProfitability([], [], input.movements, { days: 30, from: month.from, to: month.to, locationId: null, locationType: null, itemId: null, category: null }, new Date(), input.discounts).summary;
      expect(line(month, 'revenue').actualCents - line(month, 'other_revenue').actualCents).toBe(profit.netSalesCents);
      expect(line(month, 'cogs').actualCents).toBe(profit.cogsCents);
      expect(line(month, 'gross_profit').actualCents - line(month, 'other_revenue').actualCents).toBe(profit.grossProfitCents);
    }
    expect(line(report.months[0], 'uncosted').actualCents).toBe(-1800);
  });
  it('sums every yearly amount from the 12 months, excludes next year and keeps archived categories', () => {
    const report = buildFinanceYear(2026, source, [category], entries, [{ month: '2026-01-01', lineKey: 'expense:rent', amountCents: 150 }]);
    for (const [index, row] of report.yearly.lines.entries()) {
      expect(row.actualCents).toBe(report.months.reduce((sum, month) => sum + month.lines[index].actualCents, 0));
      expect(row.budgetCents).toBe(report.months.reduce((sum, month) => sum + month.lines[index].budgetCents, 0));
      expect(row.varianceCents).toBe(report.months.reduce((sum, month) => sum + month.lines[index].varianceCents, 0));
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
    const report = buildFinanceYear(2026, source, [], [], []);
    expect(report.yearly.hasBudget).toBe(false);
    expect(report.yearly.lines.every(row => row.variancePercent === null)).toBe(true);
    expect(line(report.months[0], 'gross_profit').actualCents).toBe(800);
  });
  it('handles leap days and month end inclusive, irrespective of creation time', () => {
    const report = buildFinanceYear(2024, { ...source, movements: [movement('2024-02-29'), movement('2024-03-01')], discounts: [] }, [], [], []);
    expect(report.months[1].to).toBe('2024-02-29');
    expect(line(report.months[1], 'revenue').actualCents).toBe(1800);
    expect(line(report.months[2], 'revenue').actualCents).toBe(1800);
  });
  it('reverses a discounted sale at its net price, so a full return leaves nothing in revenue', () => {
    const discountedSale = movement('2026-03-10', StockMovementType.SALE, { unitPriceCents: 800 });
    const refund = movement('2026-03-12', StockMovementType.RETURN_IN, { unitPriceCents: 800 });
    const report = buildFinanceYear(2026, { items: [], locations: [], movements: [discountedSale, refund], discounts: [{ locationId: 'shop', itemId: 'item', movementDate: '2026-03-10', discountCents: 400 }] }, [], [], []);
    const march = report.months[2]!;
    expect(line(march, 'sales').actualCents).toBe(2000);
    expect(line(march, 'discounts').actualCents).toBe(-400);
    expect(line(march, 'returns').actualCents).toBe(-1600);
    expect(line(march, 'revenue').actualCents).toBe(0);
    expect(line(march, 'cogs').actualCents).toBe(0);
  });
  it('keeps sales lacking a cost out of profit and reports their coverage for months and the year', () => {
    const report = buildFinanceYear(2026, { items: [], locations: [], movements: [movement('2026-05-05'), movement('2026-06-05', StockMovementType.SALE, { unitCostCents: null }), movement('2026-06-06', StockMovementType.SALE, { unitPriceCents: null, unitCostCents: null })], discounts: [] }, [], [], []);
    expect(line(report.months[5]!, 'revenue').actualCents).toBe(1800);
    expect(line(report.months[5]!, 'uncosted').actualCents).toBe(-1800);
    expect(line(report.months[5]!, 'gross_profit').actualCents).toBe(0);
    expect(report.months[5]).toMatchObject({ costCoveragePercent: 0, profitability: { uncostedSaleUnits: 4 } });
    expect(report.yearly).toMatchObject({ costCoveragePercent: 33.33, profitability: { unitsSold: 6, uncostedSaleUnits: 4 } });
    expect(line(report.yearly, 'net_profit').actualCents).toBe(800);
  });
  it('matches a whole-year Profitability range, not only the individual months', () => {
    const profit = buildProfitability([], [], source.movements, { days: 30, from: '2026-01-01', to: '2026-12-31', locationId: null, locationType: null, itemId: null, category: null }, new Date(), source.discounts).summary;
    const report = buildFinanceYear(2026, source, [category], entries, []);
    expect(report.yearly.profitability).toMatchObject({ netSalesCents: profit.netSalesCents, grossProfitCents: profit.grossProfitCents, inventoryLossCents: profit.inventoryLossCents });
    expect(line(report.yearly, 'revenue').actualCents).toBe(profit.netSalesCents + 300);
    expect(line(report.yearly, 'gross_profit').actualCents).toBe(profit.grossProfitCents + 300);
  });
  it('treats a zero budget as a dash and never produces Infinity or NaN', () => {
    const report = buildFinanceYear(2026, source, [category], entries, [{ month: '2026-01-01', lineKey: 'sales', amountCents: 0 }]);
    for (const period of [...report.months, report.yearly]) for (const row of period.lines) {
      expect(row.variancePercent).toBeNull();
      expect(Number.isFinite(row.varianceCents)).toBe(true);
    }
    expect(report.months[0]!.hasBudget).toBe(false);
  });
  it('uses month boundaries inclusively and ignores entries outside the month', () => {
    const report = buildFinanceYear(2026, source, [{ ...category, isActive: true }], [{ id: 'a', kind: 'expense', categoryId: 'rent', entryDate: '2026-01-31', amountCents: 10, note: '' }, { id: 'b', kind: 'expense', categoryId: 'rent', entryDate: '2026-02-01', amountCents: 20, note: '' }], []);
    expect(line(report.months[0]!, 'expense:rent').actualCents).toBe(10);
    expect(line(report.months[1]!, 'expense:rent').actualCents).toBe(20);
  });
  it('drops an archived category only when its year has nothing recorded', () => {
    const idle = { id: 'idle', name: 'Idle', isActive: false };
    const report = buildFinanceYear(2026, source, [category, idle], entries, []);
    expect(report.yearly.lines.some(row => row.key === 'expense:idle')).toBe(false);
    expect(report.months.every(month => month.lines.length === report.yearly.lines.length)).toBe(true);
    expect(line(report.yearly, 'expense:rent').label).toBe('Rent (archived)');
  });
  it('includes recorded inventory loss in operating expenses, separately from gross profit', () => {
    const report = buildFinanceYear(2026, { ...source, movements: [movement('2026-01-02', StockMovementType.DAMAGE)] }, [], [], []);
    expect(line(report.months[0], 'inventory_loss').actualCents).toBe(1000);
    expect(line(report.months[0], 'net_profit').actualCents).toBe(-1000);
  });
});
