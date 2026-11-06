import { calendarDay } from '../../common/date-range.js';
import { buildProfitability, type SaleDiscount } from '../inventory/profitability-calculations.js';
import type { ItemRecord, LocationRecord, MovementRecord } from '../inventory/inventory-calculations.js';

export const DEFAULT_FINANCE_CATEGORIES = ['Automobile', 'Rented Equipment', 'Insurance', 'Job Expenses', 'Legal and Professional Fees', 'Maintenance and Repair', 'Meals', 'Office Expenses', 'Rent or Lease', 'Utilities'];
export const FINANCE_LINES = ['sales', 'other_revenue', 'discounts', 'returns', 'cogs', 'inventory_loss'] as const;
export type FinanceCategory = { id: string; name: string; isActive: boolean };
export type FinanceEntry = { id: string; kind: string; categoryId: string | null; entryDate: string; amountCents: number; note: string };
export type FinanceBudget = { month: string; lineKey: string; amountCents: number };
// Actual and variance are null until a period has started, so nothing reads as a real zero or a loss.
export type FinanceLine = { key: string; label: string; section: string; budgetCents: number; actualCents: number | null; varianceCents: number | null; variancePercent: number | null; editable: boolean };
export type FinanceStatus = 'complete' | 'in_progress' | 'future';
// The Profitability figures behind this period, shown so owners can tie the two reports together.
export type FinanceProfitability = { netSalesCents: number; grossProfitCents: number; inventoryLossCents: number; unitsSold: number; uncostedSaleUnits: number };

const PROFIT_MOVEMENTS = new Set<string>(['sale', 'return_in', 'damage', 'adjustment_out']);
const negative = (cents: number) => (cents === 0 ? 0 : -cents);
const coverage = ({ unitsSold, uncostedSaleUnits }: FinanceProfitability) => (unitsSold > 0 ? Math.round(((unitsSold - uncostedSaleUnits) / unitsSold) * 10_000) / 100 : 100);

// Variance is always favourable-to-profit: more income or less cost is positive.
export function financeLine(key: string, label: string, section: string, budgetCents: number, actualCents: number | null, cost = false, editable = false): FinanceLine {
  if (actualCents === null) return { key, label, section, budgetCents, actualCents, varianceCents: null, variancePercent: null, editable };
  const varianceCents = cost ? budgetCents - actualCents : actualCents - budgetCents;
  return { key, label, section, budgetCents, actualCents, varianceCents, variancePercent: budgetCents === 0 ? null : Math.round(varianceCents / Math.abs(budgetCents) * 10000) / 100, editable };
}

export function buildFinanceYear(year: number, source: { items: readonly ItemRecord[]; locations: readonly LocationRecord[]; movements: readonly MovementRecord[]; discounts: readonly SaleDiscount[] }, categories: readonly FinanceCategory[], entries: readonly FinanceEntry[], budgets: readonly FinanceBudget[], now: Date, timeZone = 'UTC') {
  const today = calendarDay(now, timeZone);
  const inYear = (date: string) => date.startsWith(`${year}-`);
  const movements = source.movements.filter(movement => inYear(movement.movementDate));
  const discounts = source.discounts.filter(discount => inYear(discount.movementDate));
  const budgetAmounts = new Map(budgets.map(row => [`${row.month}:${row.lineKey}`, row.amountCents]));

  const allMonths = Array.from({ length: 12 }, (_, i) => {
    const from = `${year}-${String(i + 1).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(year, i + 1, 0)).toISOString().slice(0, 10);
    const status: FinanceStatus = to < today ? 'complete' : from > today ? 'future' : 'in_progress';
    // Actuals stop at today, so "month to date" is exact and a record dated ahead waits for its date.
    const actualsTo = status === 'future' ? null : to < today ? to : today;
    const cutoff = actualsTo ?? today;
    const { summary } = buildProfitability(source.items, source.locations, movements, { days: 30, from, to: cutoff, locationId: null, locationType: null, itemId: null, category: null }, now, discounts);
    const periodEntries = entries.filter(entry => entry.entryDate >= from && entry.entryDate <= cutoff);
    const dated = (date: string) => date >= from && date <= to && date > today;
    const futureDatedRecords = entries.some(entry => dated(entry.entryDate)) || movements.some(m => PROFIT_MOVEMENTS.has(m.type) && dated(m.movementDate));
    const budget = (key: string) => budgetAmounts.get(`${from}:${key}`) ?? 0;
    const returns = movements.filter(m => m.type === 'return_in' && m.movementDate >= from && m.movementDate <= cutoff).reduce((sum, m) => sum + (m.unitPriceCents ?? 0) * m.quantity, 0);
    const other = periodEntries.filter(entry => entry.kind === 'other_revenue').reduce((sum, entry) => sum + entry.amountCents, 0);
    // Net sales are already after discounts and returns, so the two deductions gross them back up for display.
    const lines = [
      financeLine('sales', 'Sales Revenue', 'Revenue', budget('sales'), summary.netSalesCents + returns + summary.discountsGivenCents, false, true),
      financeLine('other_revenue', 'Other Revenue', 'Revenue', budget('other_revenue'), other, false, true),
      financeLine('discounts', 'Sales Discounts', 'Revenue', negative(budget('discounts')), negative(summary.discountsGivenCents), false, true),
      financeLine('returns', 'Sales Returns / Allowances', 'Revenue', negative(budget('returns')), negative(returns), false, true),
    ];
    const revenueBudget = lines.reduce((sum, line) => sum + line.budgetCents, 0);
    const revenueActual = summary.netSalesCents + other;
    lines.push(financeLine('revenue', 'Total Revenue', 'Revenue', revenueBudget, revenueActual));
    lines.push(financeLine('cogs', 'Cost of Goods Sold', 'Cost of Goods Sold', budget('cogs'), summary.cogsCents, true, true));
    // Revenue with no cost snapshot has no known margin, so it stays out of profit, as on Profitability.
    lines.push(financeLine('uncosted', 'Sales excluded from profit (missing cost)', 'Cost of Goods Sold', 0, negative(summary.netSalesCents - summary.costedRevenueCents)));
    const grossBudget = revenueBudget - budget('cogs');
    const grossActual = summary.grossProfitCents + other;
    lines.push(financeLine('gross_profit', 'Gross Profit / Loss', 'Cost of Goods Sold', grossBudget, grossActual));
    for (const category of categories) {
      const key = `expense:${category.id}`;
      lines.push(financeLine(key, `${category.name}${category.isActive ? '' : ' (archived)'}`, 'Expenses', budget(key), periodEntries.filter(entry => entry.kind === 'expense' && entry.categoryId === category.id).reduce((sum, entry) => sum + entry.amountCents, 0), true, true));
    }
    lines.push(financeLine('inventory_loss', 'Inventory Losses', 'Expenses', budget('inventory_loss'), summary.inventoryLossCents, true, true));
    const expenses = lines.filter(line => line.section === 'Expenses');
    const expenseBudget = expenses.reduce((sum, line) => sum + line.budgetCents, 0);
    const expenseActual = expenses.reduce((sum, line) => sum + (line.actualCents ?? 0), 0);
    lines.push(financeLine('expenses', 'Total Expenses', 'Expenses', expenseBudget, expenseActual, true));
    lines.push(financeLine('net_profit', 'Net Profit / Loss', 'Result', grossBudget - expenseBudget, grossActual - expenseActual));
    const profitability = { netSalesCents: summary.netSalesCents, grossProfitCents: summary.grossProfitCents, inventoryLossCents: summary.inventoryLossCents, unitsSold: summary.unitsSold, uncostedSaleUnits: summary.uncostedSaleUnits };
    return { month: from.slice(0, 7), from, to, status, actualsTo, futureDatedRecords, hasBudget: budgets.some(row => row.month === from && row.amountCents > 0), costCoveragePercent: coverage(profitability), profitability, lines };
  });

  // An archived category leaves the report once the year has nothing recorded against it.
  const unused = new Set(categories.filter(category => !category.isActive).map(category => `expense:${category.id}`).filter(key => allMonths.every(month => month.lines.every(line => line.key !== key || (line.budgetCents === 0 && line.actualCents === 0)))));
  const months = allMonths.map(month => ({ ...month, lines: month.lines.filter(line => !unused.has(line.key)).map(line => (month.status === 'future' ? financeLine(line.key, line.label, line.section, line.budgetCents, null, false, line.editable) : line)) }));

  // Year figures are the months they cover added together, never a separate calculation. Once a
  // year has started that means the months through this one; the whole year's budget stays alongside.
  const covered = months.filter(month => month.status !== 'future');
  const compared = covered.length ? covered : months;
  const total = (rows: typeof months, index: number, value: (line: FinanceLine) => number) => rows.reduce((sum, month) => sum + value(month.lines[index]!), 0);
  const lines = months[0]!.lines.map((line, index) => ({
    ...financeLine(line.key, line.label, line.section, total(compared, index, row => row.budgetCents), covered.length ? total(covered, index, row => row.actualCents ?? 0) : null, line.key === 'cogs' || line.section === 'Expenses', line.editable),
    fullBudgetCents: total(months, index, row => row.budgetCents),
  }));
  const profitability = months.reduce<FinanceProfitability>((total, month) => ({
    netSalesCents: total.netSalesCents + month.profitability.netSalesCents,
    grossProfitCents: total.grossProfitCents + month.profitability.grossProfitCents,
    inventoryLossCents: total.inventoryLossCents + month.profitability.inventoryLossCents,
    unitsSold: total.unitsSold + month.profitability.unitsSold,
    uncostedSaleUnits: total.uncostedSaleUnits + month.profitability.uncostedSaleUnits,
  }), { netSalesCents: 0, grossProfitCents: 0, inventoryLossCents: 0, unitsSold: 0, uncostedSaleUnits: 0 });
  const status: FinanceStatus = !covered.length ? 'future' : months.every(month => month.status === 'complete') ? 'complete' : 'in_progress';
  return { year, months, yearly: { from: `${year}-01-01`, to: `${year}-12-31`, status, actualsTo: covered.at(-1)?.actualsTo ?? null, futureDatedRecords: months.some(month => month.futureDatedRecords), hasBudget: compared.some(month => month.hasBudget), costCoveragePercent: coverage(profitability), profitability, lines } };
}
