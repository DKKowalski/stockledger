import { expect, test, type Page } from '@playwright/test';
import type { FinanceBudgetInput, FinanceLine, FinanceReport } from '../../apps/web/src/features/finance/finance-types';

const companyId = '31000000-0000-4000-8000-000000000099';
const shopId = '32000000-0000-4000-8000-000000000099';
const rent = '93000000-0000-4000-8000-000000000099';
const year = new Date().getUTCFullYear();

function line(key: string, label: string, section: string, budgetCents: number, actualCents: number, cost = false, editable = true): FinanceLine {
  const varianceCents = cost ? budgetCents - actualCents : actualCents - budgetCents;
  return { key, label, section, budgetCents, actualCents, varianceCents, variancePercent: budgetCents === 0 ? null : Math.round(varianceCents / Math.abs(budgetCents) * 10000) / 100, editable };
}
function lines(budget: number, uncosted = 0): FinanceLine[] {
  return [
    line('sales', 'Sales Revenue', 'Revenue', budget, 12000), line('other_revenue', 'Other Revenue', 'Revenue', 0, 500),
    line('discounts', 'Sales Discounts', 'Revenue', 0, -1000), line('returns', 'Sales Returns / Allowances', 'Revenue', 0, -1000),
    line('revenue', 'Total Revenue', 'Revenue', budget, 10500, false, false), line('cogs', 'Cost of Goods Sold', 'Cost of Goods Sold', budget / 2, 6000, true),
    line('uncosted', 'Sales excluded from profit (missing cost)', 'Cost of Goods Sold', 0, -uncosted, false, false),
    line('gross_profit', 'Gross Profit / Loss', 'Cost of Goods Sold', budget / 2, 4500 - uncosted, false, false),
    line(`expense:${rent}`, 'Rent or Lease', 'Expenses', budget / 10, 1500, true), line('inventory_loss', 'Inventory Losses', 'Expenses', 0, 0, true),
    line('expenses', 'Total Expenses', 'Expenses', budget / 10, 1500, true, false), line('net_profit', 'Net Profit / Loss', 'Result', budget * .4, 3000 - uncosted, false, false),
  ];
}
function report(budget: number, uncosted = 0): FinanceReport {
  const period = { hasBudget: budget > 0, costCoveragePercent: uncosted ? 50 : 100, profitability: { netSalesCents: 10000, grossProfitCents: 4000 - uncosted, inventoryLossCents: 0, unitsSold: 4, uncostedSaleUnits: uncosted ? 2 : 0 } };
  const months = Array.from({ length: 12 }, (_, index) => { const month = `${year}-${String(index + 1).padStart(2, '0')}`; return { ...period, month, from: `${month}-01`, to: `${month}-28`, lines: lines(budget, uncosted) }; });
  const sum = lines(budget, uncosted).map(row => line(row.key, row.label, row.section, row.budgetCents * 12, row.actualCents * 12, row.key === 'cogs' || row.section === 'Expenses', row.editable));
  return { year, company: { name: 'Mensah Trading', currency: 'GHS', timeZone: 'Africa/Accra' }, categories: [{ id: rent, name: 'Rent or Lease', isActive: true }], months, yearly: { ...period, from: `${year}-01-01`, to: `${year}-12-31`, lines: sum } };
}
async function session(page: Page, data: { report: FinanceReport }, role = 'administrator') {
  await page.route('http://localhost:3100/**', route => route.fulfill({ json: [] }));
  await page.route('**/auth/refresh', route => route.fulfill({ json: { accessToken: 'test.session.token', user: { id: 'test-admin', companyId, fullName: 'Test admin', email: 'test@example.invalid', role, locationId: null, isActive: true, isDemo: false, setupPending: false } } }));
  await page.route('**/onboarding', route => route.fulfill({ json: { completed: true, company: { id: companyId, name: 'Mensah Trading', businessType: 'mixed', inventorySource: 'paper' }, counts: { locations: 1, items: 1, movements: 1, teammates: 1 } } }));
  await page.route('**/settings', route => route.fulfill({ json: { id: companyId, name: 'Mensah Trading', currency: 'GHS', timeZone: 'Africa/Accra', defaultUnit: 'pcs', defaultReorderLevel: 0, defaultLocationId: shopId, itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse' } }));
  await page.route('**/inventory/snapshot**', route => route.fulfill({ json: { items: [], locations: [{ id: shopId, name: 'Shop', type: 'shop' }], positions: [], movements: [], periodMovements: [], summary: { closingUnits: 0, stockValueCents: 0, lowStockItems: 0, damagedUnits: 0, deadStockLines: 0 } } }));
  await page.route('**/finance?**', route => route.fulfill({ json: data.report }));
  await page.route('**/finance/entries?**', route => route.fulfill({ json: [] }));
}
const row = (page: Page, name: string) => page.getByRole('row', { name: new RegExp(`^${name}`) }).first();
const noBrokenNumbers = async (page: Page) => expect(page.locator('.finance-statement')).not.toContainText(/NaN|Infinity|undefined/);

test('shows actuals and guides the owner when no budget exists', async ({ page }) => {
  await session(page, { report: report(0) });
  await page.goto('/finance');
  await expect(page.getByRole('heading', { name: 'Mensah Trading' })).toBeVisible();
  await expect(page.getByText(/For the month ended/)).toBeVisible();
  await expect(page.getByText('All amounts in GHS')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'No budget set' })).toBeVisible();
  await expect(row(page, 'Total Revenue')).toContainText('105.00');
  await expect(row(page, 'Total Revenue')).toContainText('—');
  await expect(page.locator('.finance-statement')).not.toContainText('$');
  await noBrokenNumbers(page);
});

test('applies one favourable-to-profit rule and shows a dash for a zero budget', async ({ page }) => {
  await session(page, { report: report(10000) });
  await page.goto('/finance');
  await expect(row(page, 'Sales Revenue').locator('td').nth(2)).toHaveClass(/positive/);
  await expect(row(page, 'Sales Revenue').locator('td').nth(3)).toHaveText('20.00%');
  await expect(row(page, 'Rent or Lease').locator('td').nth(2)).toHaveClass(/negative/);
  await expect(row(page, 'Rent or Lease').locator('td').nth(3)).toHaveText('-50.00%');
  await expect(row(page, 'Other Revenue').locator('td').nth(3)).toHaveText('—');
  await noBrokenNumbers(page);
});

test('warns about sales without a cost and keeps them out of profit', async ({ page }) => {
  await session(page, { report: report(10000, 1000) });
  await page.goto('/finance');
  await expect(page.getByRole('status').filter({ hasText: '2 sold units have no recorded cost' })).toContainText('50%');
  await expect(page.getByRole('row', { name: /Sales excluded from profit/ }).first()).toBeVisible();
});

test('shows every month, opens one, and the yearly view keeps the statement layout', async ({ page }) => {
  await session(page, { report: report(10000) });
  await page.goto('/finance');
  await page.getByRole('tab', { name: 'All months' }).click();
  await expect(page.locator('.finance-month-summary tbody tr')).toHaveCount(13);
  await page.getByRole('combobox', { name: 'Figures shown' }).click();
  await page.getByRole('option', { name: 'Variance', exact: true }).click();
  await expect(page.locator('.finance-month-grid tbody tr').first().locator('td').first()).toHaveClass(/positive/);
  await page.getByRole('button', { name: 'February' }).click();
  await expect(page.getByRole('tab', { name: 'Month', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', { name: 'Finance month' })).toHaveText(/February/);
  await page.getByRole('tab', { name: 'Yearly' }).click();
  await expect(page.getByText(/For the year ended/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: `${year} budget` }).first()).toBeVisible();
  for (const section of ['Revenue', 'Cost of Goods Sold', 'Expenses']) await expect(page.getByRole('columnheader', { name: section, exact: true })).toBeVisible();
});

test('fills a year from one month and records exact cents', async ({ page }) => {
  const data = { report: report(0) };
  await session(page, data);
  let saved: FinanceBudgetInput | undefined;
  await page.route('**/finance/budgets', route => { saved = route.request().postDataJSON(); data.report = report(10000); return route.fulfill({ status: 201, json: { saved: true } }); });
  await page.goto('/finance');
  await page.getByRole('status').filter({ hasText: 'No budget set' }).getByRole('button', { name: 'Set budget' }).click();
  await page.getByLabel('Sales Revenue budget').fill('1.15');
  await page.getByLabel('Copy these amounts to all 12 months').check();
  await page.getByRole('button', { name: `Save for all of ${year}` }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No budget set' })).toHaveCount(0);
  expect(saved?.copyToYear).toBe(true);
  expect(saved?.lines.find(entry => entry.lineKey === 'sales')?.amountCents).toBe(115);
  expect(saved?.lines.find(entry => entry.lineKey === 'cogs')?.amountCents).toBe(0);
});

test('exports the view on screen and offers a print layout without the app chrome', async ({ page }) => {
  await session(page, { report: report(10000) });
  let exported = '';
  await page.route('**/finance/export?**', route => { exported = route.request().url(); return route.fulfill({ headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="finance.csv"' }, body: 'Company\r\n' }); });
  await page.goto('/finance');
  await page.getByRole('tab', { name: 'Yearly' }).click();
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await expect.poll(() => exported).toContain('view=year');
  expect(exported).not.toContain('month=');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.finance-toolbar')).toBeHidden();
  await expect(page.locator('.finance-statement')).toBeVisible();
});

test('keeps finance out of reach of an inventory manager', async ({ page }) => {
  await session(page, { report: report(0) }, 'inventory_manager');
  await page.goto('/finance');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Finance' })).toHaveCount(0);
});
