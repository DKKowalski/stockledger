import { uiuxEvidence } from './helpers/uiux-evidence';
import { clickDay, openCustom } from './helpers/calendar';
import { expect, test, type Page } from '@playwright/test';
import type { FinanceBudgetInput, FinanceLine, FinanceReport } from '../../apps/web/src/features/finance/finance-types';

const companyId = '31000000-0000-4000-8000-000000000099';
const shopId = '32000000-0000-4000-8000-000000000099';
const rent = '93000000-0000-4000-8000-000000000099';
const year = 2026;
const now = new Date('2026-11-06T12:00:00Z');

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
// As the API answers on 6 November: October finished, November running, December not started.
function runningYear(budget: number, scale = 1): FinanceReport {
  const base = report(budget);
  const big = (row: FinanceLine) => line(row.key, row.label, row.section, row.budgetCents * scale, row.actualCents! * scale, row.key === 'cogs' || row.section === 'Expenses', row.editable);
  const months = base.months.map((month, index) => {
    const lines = month.lines.map(big);
    if (index < 10) return { ...month, lines };
    if (index === 10) return { ...month, lines, status: 'in_progress' as const, actualsTo: `${year}-11-06` };
    return { ...month, status: 'future' as const, actualsTo: null, lines: lines.map(row => ({ ...row, actualCents: null, varianceCents: null, variancePercent: null })) };
  });
  const yearly = months[0]!.lines.map((row, index) => ({ ...line(row.key, row.label, row.section, row.budgetCents * 11, row.actualCents! * 11, row.key === 'cogs' || row.section === 'Expenses', row.editable), fullBudgetCents: row.budgetCents * 12 }));
  return { ...base, months, yearly: { ...base.yearly, status: 'in_progress', actualsTo: `${year}-11-06`, lines: yearly } };
}
function report(budget: number, uncosted = 0): FinanceReport {
  const period = { status: 'complete' as const, actualsTo: `${year}-12-31`, futureDatedRecords: false, hasBudget: budget > 0, costCoveragePercent: uncosted ? 50 : 100, profitability: { netSalesCents: 10000, grossProfitCents: 4000 - uncosted, inventoryLossCents: 0, unitsSold: 4, uncostedSaleUnits: uncosted ? 2 : 0 } };
  const months = Array.from({ length: 12 }, (_, index) => { const month = `${year}-${String(index + 1).padStart(2, '0')}`; return { ...period, month, from: `${month}-01`, to: `${month}-28`, lines: lines(budget, uncosted) }; });
  const sum = lines(budget, uncosted).map(row => line(row.key, row.label, row.section, row.budgetCents * 12, row.actualCents * 12, row.key === 'cogs' || row.section === 'Expenses', row.editable));
  return { year, company: { name: 'Mensah Trading', currency: 'GHS', timeZone: 'Africa/Accra' }, categories: [{ id: rent, name: 'Rent or Lease', isActive: true }], months, yearly: { ...period, from: `${year}-01-01`, to: `${year}-12-31`, lines: sum } };
}
async function session(page: Page, data: { report: FinanceReport }, role = 'administrator') {
  await page.clock.setFixedTime(now);
  await page.route('http://localhost:3100/**', route => route.fulfill({ json: [] }));
  await page.route('**/auth/refresh', route => route.fulfill({ json: { accessToken: 'test.session.token', user: { id: 'test-admin', companyId, fullName: 'Test admin', email: 'test@example.invalid', role, locationId: null, isActive: true, isDemo: false, setupPending: false } } }));
  await page.route('**/onboarding', route => route.fulfill({ json: { completed: true, company: { id: companyId, name: 'Mensah Trading', businessType: 'mixed', inventorySource: 'paper' }, counts: { locations: 1, items: 1, movements: 1, teammates: 1 } } }));
  await page.route('**/settings', route => route.fulfill({ json: { id: companyId, name: 'Mensah Trading', currency: 'GHS', timeZone: 'Africa/Accra', dateFormat: 'day_month_year', defaultUnit: 'pcs', defaultReorderLevel: 0, defaultLocationId: shopId, itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse' } }));
  await page.route('**/inventory/snapshot**', route => route.fulfill({ json: { items: [], locations: [{ id: shopId, name: 'Shop', type: 'shop' }], positions: [], movements: [], periodMovements: [], summary: { closingUnits: 0, stockValueCents: 0, lowStockItems: 0, damagedUnits: 0, deadStockLines: 0 } } }));
  await page.route('**/finance?**', route => route.fulfill({ json: data.report }));
  await page.route('**/finance/entries?**', route => route.fulfill({ json: { entries: [], truncated: false, limit: 500 } }));
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
  await page.getByRole('button', { name: 'Copy this month…' }).click();
  await page.getByLabel('Copy these amounts to all 12 months').check();
  await expect(page.getByRole('status').filter({ hasText: 'Selected:' })).toContainText('December (new)');
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
  await page.getByText('More report actions', { exact: true }).click();
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

test('labels the current month as month to date and never as ended', async ({ page }) => {
  await session(page, { report: runningYear(10000) });
  await page.goto('/finance');
  await expect(page.getByText('Month to date, 1 to 6 Nov 2026')).toBeVisible();
  await expect(page.locator('.finance-status')).toHaveText('In progress');
  await expect(page.locator('.finance-basis')).toContainText('The budget is the full month, not pro-rated');
  await expect(page.getByRole('columnheader', { name: 'Variance so far' }).first()).toBeVisible();
  await expect(page.locator('.finance-statement')).not.toContainText('month ended');
});

test('shows a future month as budget only with no red and no zeros', async ({ page }) => {
  await session(page, { report: runningYear(10000) });
  await page.goto('/finance');
  await page.getByRole('combobox', { name: 'Finance month' }).click();
  await page.getByRole('option', { name: 'December', exact: true }).click();
  await expect(page.getByText('December 2026 has not started')).toBeVisible();
  await expect(page.locator('.finance-status')).toHaveText('Not started');
  await expect(row(page, 'Sales Revenue').locator('td').nth(0)).toContainText('100.00');
  for (const cell of [1, 2, 3]) await expect(row(page, 'Sales Revenue').locator('td').nth(cell)).toHaveText('—');
  await expect(page.locator('.finance-statement .negative')).toHaveCount(0);
});

test('compares the running year with elapsed months and shows the full-year budget apart', async ({ page }) => {
  await session(page, { report: runningYear(10000) });
  await page.goto('/finance');
  await page.getByRole('tab', { name: 'All months' }).click();
  const december = page.locator('.finance-month-summary tbody tr').nth(11);
  await expect(december).toContainText('Not started');
  await expect(december.locator('td').nth(4)).toContainText('40.00');
  for (const cell of [0, 1, 2, 3, 5]) await expect(december.locator('td').nth(cell)).toHaveText('—');
  await expect(page.locator('.finance-month-summary tbody tr').nth(10)).toContainText('In progress');
  await expect(page.getByRole('row', { name: /^2026 to date/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /^Full-year budget/ })).toContainText('480.00');
  await page.getByRole('tab', { name: 'Yearly' }).click();
  await expect(page.getByText('Year to date, 1 Jan to 6 Nov 2026')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Full-year budget' }).first()).toBeVisible();
  await expect(row(page, 'Sales Revenue').locator('td').nth(0)).toContainText('1,100.00');
  await expect(row(page, 'Sales Revenue').locator('td').nth(4)).toContainText('1,200.00');
});

test('shows a finished year as a plain statement', async ({ page }) => {
  const base = report(10000);
  const finished: FinanceReport = { ...base, year: 2025, yearly: { ...base.yearly, from: '2025-01-01', to: '2025-12-31', actualsTo: '2025-12-31' }, months: base.months.map(month => ({ ...month, month: month.month.replace(`${year}`, '2025'), from: month.from.replace(`${year}`, '2025'), to: month.to.replace(`${year}`, '2025') })) };
  await session(page, { report: finished });
  await page.goto('/finance');
  await page.getByRole('combobox', { name: 'Finance year' }).click();
  await page.getByRole('option', { name: '2025', exact: true }).click();
  await page.getByRole('tab', { name: 'Yearly' }).click();
  await expect(page.getByText('For the year ended 31 Dec 2025')).toBeVisible();
  await expect(page.locator('.finance-basis')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Full-year budget' })).toHaveCount(0);
});

for (const view of ['Month', 'Yearly']) {
  test(`keeps variance on screen at phone width in the ${view} view, even with amounts in the millions`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await session(page, { report: runningYear(10000, 40000) });
    await page.goto('/finance');
    await page.getByRole('tab', { name: view, exact: true }).click();
    await expect(row(page, 'Sales Revenue')).toBeVisible();
    const problems = await page.evaluate(() => {
      const found: string[] = [];
      for (const tr of document.querySelectorAll<HTMLElement>('.finance-statement-table tr:not(.finance-section-row)')) {
        const cells = [...tr.querySelectorAll<HTMLElement>('td[data-col]')];
        for (const cell of cells) {
          const box = cell.getBoundingClientRect();
          if (box.left < 0 || box.right > innerWidth || cell.scrollWidth > cell.clientWidth + 1) found.push(`off-screen ${cell.textContent}`);
        }
        const inline = cells.filter(cell => ['budget', 'actual', 'variance'].includes(cell.dataset.col!)).map(cell => cell.getBoundingClientRect());
        for (let index = 1; index < inline.length; index++) if (inline[index]!.left < inline[index - 1]!.right) found.push(`collision ${tr.textContent}`);
      }
      return found;
    });
    expect(problems).toEqual([]);
    await row(page, 'Sales Revenue').scrollIntoViewIfNeeded();
    await expect(row(page, 'Sales Revenue').locator('td[data-col="variance"]')).toBeInViewport();
    await expect(row(page, 'Sales Revenue').locator('td[data-col="variance"]')).toHaveAttribute('data-label', 'Variance so far');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.finance-statement-table').first().evaluate(table => table.scrollWidth <= table.clientWidth)).toBe(true);
  });
}

test('keeps the budget and variance columns in the phone month summary', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await session(page, { report: runningYear(10000, 40000) });
  await page.goto('/finance');
  await page.getByRole('tab', { name: 'All months' }).click();
  await page.getByRole('row', { name: /^Full-year budget/ }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('row', { name: /^Full-year budget/ }).locator('td').nth(4)).toBeInViewport();
  await expect(page.locator('.finance-month-summary tbody tr').nth(10).locator('td').nth(5)).toBeInViewport();
  expect(await page.locator('.finance-month-summary').evaluate(table => table.scrollWidth <= table.clientWidth)).toBe(true);
});

test('tells the owner when the entry list is cut off and that totals are unaffected', async ({ page }) => {
  await session(page, { report: report(10000) });
  await page.route('**/finance/entries?**', route => route.fulfill({ json: { entries: [{ id: 'e', kind: 'other_revenue', categoryId: null, entryDate: `${year}-01-02`, amountCents: 100, note: '' }], truncated: true, limit: 500 } }));
  await page.goto('/finance');
  await page.getByRole('button', { name: 'Expenses and other revenue' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Showing the latest 500 entries' })).toContainText('report totals are not affected');
});

test('selects an old entry date with the shared calendar and submits the exact business day', async ({ page }) => {
  await session(page, { report: report(10000) });
  let saved: { entryDate: string; amountCents: number } | undefined;
  await page.route('**/finance/entries', route => { saved = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { id: 'calendar-entry' } }); });
  await page.goto('/finance');
  await page.getByRole('button', { name: 'Expenses and other revenue' }).click();
  await page.getByRole('button', { name: /^Entry date:/ }).click();
  await clickDay(page, '2020-02-29');
  await expect(page.getByRole('button', { name: 'Entry date: 29 Feb 2020', exact: true })).toBeFocused();
  await page.getByLabel('Entry amount').fill('12.34');
  await page.getByRole('button', { name: 'Record entry', exact: true }).click();
  await expect.poll(() => saved?.entryDate).toBe('2020-02-29');
  expect(saved?.amountCents).toBe(1234);
});

test('finance entries use the custom calendar range only after Apply and print no popup', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await session(page, { report: report(10000) });
  await page.goto('/finance');
  await page.getByRole('button', { name: 'Expenses and other revenue' }).click();
  await openCustom(page, 'Finance entry period');
  await clickDay(page, '2026-10-30');
  await clickDay(page, '2026-11-03');
  const applied = page.waitForRequest(request => request.url().includes('/finance/entries?') && request.url().includes('from=2026-10-30') && request.url().includes('to=2026-11-03'));
  await page.getByRole('button', { name: 'Apply dates' }).click();
  await applied;
  await expect(page.getByRole('button', { name: 'Finance entry period: 30 Oct 2026 – 3 Nov 2026', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /^Entry date:/ }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.calendar-positioner')).toBeHidden();
});

for (const width of [390, 1440]) {
  test(`keeps separate Finance drafts across editors, views and budget months at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await session(page, { report: runningYear(10000) });
    await page.goto('/finance');
    await page.getByRole('button', { name: 'Expenses and other revenue', exact: true }).click();
    await page.getByLabel('Entry amount').fill('37.50');
    await page.getByLabel('Entry note').fill('Delivery still to check');
    await uiuxEvidence(page, 'ux03-entry-draft');
    await page.getByRole('button', { name: 'Set budget', exact: true }).click();
    await page.getByLabel('Sales Revenue budget', { exact: true }).fill('222.00');
    await page.getByRole('combobox', { name: 'Budget month' }).click();
    await page.getByRole('option', { name: 'October 2026', exact: true }).click();
    await page.getByLabel('Sales Revenue budget', { exact: true }).fill('333.00');
    await page.getByRole('combobox', { name: 'Budget month' }).click();
    await page.getByRole('option', { name: 'November 2026', exact: true }).click();
    await expect(page.getByLabel('Sales Revenue budget', { exact: true })).toHaveValue('222.00');
    await page.getByRole('button', { name: 'Categories', exact: true }).click();
    await page.getByLabel('New category', { exact: true }).fill('Delivery');
    await page.getByRole('tab', { name: 'Yearly', exact: true }).click();
    await page.getByRole('button', { name: 'Expenses and other revenue', exact: true }).click();
    await expect(page.getByLabel('Entry amount')).toHaveValue('37.50');
    await expect(page.getByLabel('Entry note')).toHaveValue('Delivery still to check');
    await page.getByRole('button', { name: 'Categories', exact: true }).click();
    await expect(page.getByLabel('New category', { exact: true })).toHaveValue('Delivery');
    await uiuxEvidence(page, 'ux03-category-draft');
    await page.getByRole('button', { name: 'Set budget', exact: true }).click();
    await expect(page.getByLabel('Sales Revenue budget', { exact: true })).toHaveValue('222.00');
    await uiuxEvidence(page, 'ux03-budget-draft');
    await page.getByRole('button', { name: 'Discard this month’s draft' }).click();
    await expect(page.getByLabel('Sales Revenue budget', { exact: true })).toHaveValue('100.00');
  });
}

test('retains a failed Finance entry and clears it only after a successful retry', async ({ page }) => {
  await session(page, { report: runningYear(10000) });
  let fail = true;
  await page.route('**/finance/entries', route => route.fulfill(fail ? { status: 503, json: { message: 'Unavailable' } } : { status: 201, json: { id: 'saved-entry' } }));
  await page.goto('/finance');
  await page.getByRole('button', { name: 'Expenses and other revenue', exact: true }).click();
  await page.getByLabel('Entry amount').fill('24.50');
  await page.getByLabel('Entry note').fill('Transport');
  await page.getByRole('button', { name: 'Record entry', exact: true }).click();
  await expect(page.getByText('Could not save finance records', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Set budget', exact: true }).click();
  await page.getByRole('button', { name: 'Expenses and other revenue', exact: true }).click();
  await expect(page.getByLabel('Entry amount')).toHaveValue('24.50');
  await expect(page.getByLabel('Entry note')).toHaveValue('Transport');
  fail = false;
  await page.getByRole('button', { name: 'Record entry', exact: true }).click();
  await expect(page.getByLabel('Entry amount')).toHaveValue('');
  await expect(page.getByLabel('Entry note')).toHaveValue('');
});

for (const width of [360, 390, 1440]) {
  test(`Finance leads with its actual period result at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await session(page, { report: runningYear(10000) });
    await page.goto('/finance');
    const answer = page.getByRole('region', { name: 'Actual money summary' });
    await expect(answer).toContainText('November 2026 · All places · To 6 Nov 2026');
    await expect(answer.locator('.finance-answer-net')).toContainText('30.00');
    await expect(answer.locator('.finance-answer-net')).toBeInViewport();
    await expect(answer).toContainText('Net sales');
    await expect(answer).toContainText('Cost of stock sold');
    await expect(answer).toContainText('Expenses');
    await expect(answer).toContainText('Other revenue');
    await expect(answer).toContainText('Actual means recorded results');
    expect((await answer.boundingBox())!.y).toBeLessThan((await page.locator('.finance-toolbar').boundingBox())!.y);
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeHidden();
    if (width !== 360) await uiuxEvidence(page, 'ux02-finance-answer');
    await page.getByRole('tab', { name: 'All months', exact: true }).click();
    await expect(answer.locator('.finance-answer-net')).toContainText('330.00');
    await page.getByRole('tab', { name: 'Yearly', exact: true }).click();
    await expect(answer.locator('.finance-answer-net')).toContainText('330.00');
    await page.getByRole('tab', { name: 'Month', exact: true }).click();
    await page.getByRole('combobox', { name: 'Finance month', exact: true }).click();
    await page.getByRole('option', { name: 'December', exact: true }).click();
    await expect(answer.locator('.finance-answer-net')).toHaveText('—');
    await expect(answer).toContainText('This period has not started');
    await page.emulateMedia({ media: 'print' });
    await expect(answer).toBeHidden();
    await expect(page.locator('.finance-statement')).toBeVisible();
  });
}

for (const width of [390, 1440]) {
  test(`owner Overview shows today's existing Profit figures above controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await session(page, { report: runningYear(10000) });
    let requested = '';
    await page.route('**/inventory/profitability?**', route => {
      requested = route.request().url();
      return route.fulfill({ json: { summary: { netSalesCents: 7250, grossProfitCents: 3100, costCoveragePercent: 75 }, trend: [], lines: [] } });
    });
    await page.goto('/');
    const answer = page.getByRole('region', { name: "Today's recorded money" });
    await expect(answer).toContainText('72.50');
    await expect(answer).toContainText('31.00');
    await expect(answer).toContainText('Cost coverage: 75%');
    await expect(answer).toContainText('not cash collected');
    expect(new URL(requested).searchParams.get('days')).toBe('30');
    expect(new URL(requested).searchParams.get('from')).toBe('2026-11-06');
    expect(new URL(requested).searchParams.get('to')).toBe('2026-11-06');
    await expect(answer.locator('dd').first()).toBeInViewport();
    await uiuxEvidence(page, 'ux02-overview-today');
  });
}

for (const width of [390, 1440]) test(`simple budget shows used lines and live profit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const data = { report: report(0) };
  data.report.categories.push({ id: 'legal', name: 'Legal fees', isActive: true });
  for (const month of data.report.months) month.lines.push(line('expense:legal', 'Legal fees', 'Expenses', 0, 0, true));
  await session(page, data);
  await page.goto('/finance');
  await page.getByRole('button', { name: 'Set budget', exact: true }).first().click();
  await expect(page.getByLabel('Legal fees budget')).toHaveCount(0);
  await page.getByLabel('Sales Revenue budget').fill('1000');
  await page.getByLabel('Cost of Goods Sold budget').fill('400');
  await page.getByLabel('Rent or Lease budget').fill('200');
  await expect(page.locator('.budget-save-bar')).toContainText('400.00');
  await page.getByRole('combobox', { name: 'Add a budget line' }).click();
  await page.getByRole('option', { name: 'Legal fees', exact: true }).click();
  await expect(page.getByLabel('Legal fees budget')).toBeVisible();
  await uiuxEvidence(page, 'ux07-budget');
  await page.getByRole('button', { name: 'Copy this month…' }).click();
  await page.getByLabel('December (no budget)', { exact: true }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Selected:' })).toHaveText('Selected: December (new).');
});

for (const width of [390, 1440]) test(`Finance retries failed reads without losing a draft at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await session(page, { report: report(10000) });
  let reportReads = 0, entryReads = 0, writes = 0;
  await page.route('**/finance?**', route => { reportReads++; return reportReads === 1 ? route.fulfill({ status: 503, json: { message: 'Offline' } }) : route.fulfill({ json: report(10000) }); });
  await page.route('**/finance/entries?**', route => { entryReads++; return entryReads === 1 ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { entries: [], truncated: false, limit: 500 } }); });
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/finance')) writes++; });
  await page.goto('/finance');
  await page.getByRole('button', { name: 'Retry report', exact: true }).click();
  await expect(page.locator('.finance-answer')).toBeVisible();
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await page.getByLabel('Entry amount').fill('37.50');
  await page.getByLabel('Entry note').fill('Keep this draft');
  await expect(page.getByRole('alert').filter({ hasText: 'Entries could not load' })).toBeVisible();
  await uiuxEvidence(page, 'ux12-entry-retry');
  await page.getByRole('button', { name: 'Retry entries', exact: true }).click();
  await expect(page.getByText('No entries in this period.')).toBeVisible();
  await expect(page.getByLabel('Entry amount')).toHaveValue('37.50');
  await expect(page.getByLabel('Entry note')).toHaveValue('Keep this draft');
  expect(reportReads).toBe(2); expect(entryReads).toBe(2); expect(writes).toBe(0);
});

for (const width of [390, 1440]) test(`editing a distant expense brings its context into focus and returns to its row at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await session(page, { report: report(10000) });
  const entries = Array.from({ length: 30 }, (_, index) => ({ id: `entry-${index}`, kind: 'expense', categoryId: rent, entryDate: '2026-09-01', amountCents: 2450, note: `Delivery ${index}` }));
  await page.route('**/finance/entries?**', route => route.fulfill({ json: { entries, truncated: false, limit: 500 } }));
  let fail = true;
  await page.route('**/finance/entries/entry-29', route => route.fulfill(fail ? { status: 503, json: {} } : { status: 200, json: entries[29] }));
  await page.goto('/finance');
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await page.getByLabel('Entry amount').fill('37.50');
  await page.getByLabel('Entry note').fill('New draft kept');
  const edit = page.locator('[data-edit-entry="entry-29"]');
  await edit.click();
  const heading = page.getByRole('heading', { name: 'Edit expense · 1 Sept 2026 · Rent or Lease' });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect(page.getByLabel('Entry amount')).toHaveValue('24.50');
  await expect(page.getByLabel('Entry note')).toHaveValue('Delivery 29');
  await uiuxEvidence(page, 'ux14-edit-expense');
  await page.getByRole('button', { name: 'Cancel edit' }).click();
  await expect(edit).toBeFocused(); await expect(edit).toBeInViewport();
  await expect(page.getByLabel('Entry note')).toHaveValue('New draft kept');
  await edit.click();
  await page.getByLabel('Entry amount').fill('25.50');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('The entry could not save.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Entry amount')).toHaveValue('25.50');
  fail = false;
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeFocused(); await expect(edit).toBeInViewport();
  await expect(page.getByLabel('Entry amount')).toHaveValue('37.50');
});
