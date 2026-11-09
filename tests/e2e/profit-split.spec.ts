import { expect, test, type Page } from '@playwright/test';
import type { FinanceLine, FinanceReport } from '../../apps/web/src/features/finance/finance-types';
import type { ProfitSplit, ProfitSplitCompletion, ProfitSplitSetting } from '../../apps/web/src/features/finance/profit-split-types';

// The API is mocked here (like finance.spec.ts); the API itself is covered by integration tests.
const companyId = '31000000-0000-4000-8000-000000000098';
const shopId = '32000000-0000-4000-8000-000000000098';
const year = 2026;
const now = new Date('2026-11-06T12:00:00Z');
const NET = 123457;

function line(key: string, label: string, section: string, actualCents: number, cost = false): FinanceLine {
  return { key, label, section, budgetCents: 0, actualCents, varianceCents: cost ? -actualCents : actualCents, variancePercent: null, editable: false };
}
const lines = () => [
  line('sales', 'Sales Revenue', 'Revenue', NET + 6000), line('other_revenue', 'Other Revenue', 'Revenue', 0), line('discounts', 'Sales Discounts', 'Revenue', 0), line('returns', 'Sales Returns / Allowances', 'Revenue', 0),
  line('revenue', 'Total Revenue', 'Revenue', NET + 6000), line('cogs', 'Cost of Goods Sold', 'Cost of Goods Sold', 4000, true), line('uncosted', 'Sales excluded from profit (missing cost)', 'Cost of Goods Sold', 0),
  line('gross_profit', 'Gross Profit / Loss', 'Cost of Goods Sold', NET + 2000), line('inventory_loss', 'Inventory Losses', 'Expenses', 0, true), line('expenses', 'Total Expenses', 'Expenses', 2000, true), line('net_profit', 'Net Profit / Loss', 'Result', NET),
];
function report(): FinanceReport {
  const profitability = { netSalesCents: 10000, grossProfitCents: 4000, inventoryLossCents: 0, unitsSold: 4, uncostedSaleUnits: 0 };
  const base = { futureDatedRecords: false, hasBudget: false, costCoveragePercent: 100, profitability };
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    const status = index < 10 ? 'complete' as const : index === 10 ? 'in_progress' as const : 'future' as const;
    return { ...base, month, from: `${month}-01`, to: `${month}-28`, status, actualsTo: status === 'future' ? null : `${month}-28`, lines: lines() };
  });
  return { year, company: { name: 'Mensah Trading', currency: 'GHS', timeZone: 'Africa/Accra' }, categories: [], months, yearly: { ...base, status: 'in_progress', actualsTo: `${year}-11-06`, from: `${year}-01-01`, to: `${year}-12-31`, lines: lines() } };
}

const defaults: ProfitSplitSetting[] = [
  { key: 'default-1', name: 'Tax reserve', destination: 'Tax account', percent: 10 },
  { key: 'default-2', name: 'Top up emergency reserve', destination: 'Reserve account (Target: 1–3 months of expenses)', percent: 20 },
  { key: 'default-3', name: 'Reinvest in inventory/tools', destination: 'Business (high-margin SKUs)', percent: 20 },
  { key: 'default-4', name: "Pay owner's draw", destination: 'Personal account', percent: 20 },
  { key: 'default-5', name: 'Repay debt / clear supplier', destination: 'Creditors', percent: 10 },
  { key: 'default-6', name: 'Growth fund', destination: 'Growth savings account', percent: 20 },
];

// Largest remainder over integer cents, as the API does.
function allocate(net: number, bps: number[]) {
  const floors = bps.map(bp => Math.floor(net * bp / 10000));
  let left = net - floors.reduce((a, b) => a + b, 0);
  const order = bps.map((bp, i) => ({ i, r: (net * bp) % 10000 })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) { if (left-- > 0) floors[i]! += 1; }
  return floors;
}

async function session(page: Page) {
  const state = { settings: defaults as Array<Required<ProfitSplitSetting>> as any[], done: {} as Record<string, ProfitSplitCompletion>, saves: [] as unknown[] };
  await page.clock.setFixedTime(now);
  await page.route('http://localhost:3100/**', route => route.fulfill({ json: [] }));
  await page.route('**/auth/refresh', route => route.fulfill({ json: { accessToken: 'test.session.token', user: { id: 'test-admin', companyId, fullName: 'Test admin', email: 'test@example.invalid', role: 'administrator', locationId: null, isActive: true, isDemo: false, setupPending: false } } }));
  await page.route('**/onboarding', route => route.fulfill({ json: { completed: true, company: { id: companyId, name: 'Mensah Trading', businessType: 'mixed', inventorySource: 'paper' }, counts: { locations: 1, items: 1, movements: 1, teammates: 1 } } }));
  await page.route('**/settings', route => route.fulfill({ json: { id: companyId, name: 'Mensah Trading', currency: 'GHS', timeZone: 'Africa/Accra', dateFormat: 'day_month_year', defaultUnit: 'pcs', defaultReorderLevel: 0, defaultLocationId: shopId, itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse' } }));
  await page.route('**/inventory/snapshot**', route => route.fulfill({ json: { items: [], locations: [{ id: shopId, name: 'Shop', type: 'shop' }], positions: [], movements: [], periodMovements: [], summary: { closingUnits: 0, stockValueCents: 0, lowStockItems: 0, damagedUnits: 0, deadStockLines: 0 } } }));
  await page.route('**/finance?**', route => route.fulfill({ json: report() }));
  await page.route('**/finance/entries?**', route => route.fulfill({ json: { entries: [], truncated: false, limit: 500 } }));
  const view = (month: string): ProfitSplit => {
    const status = month === '2026-11' ? 'in_progress' : 'complete';
    const amounts = allocate(NET, state.settings.map(part => Math.round(part.percent * 100)));
    return {
      month, status, currency: 'GHS', timeZone: 'Africa/Accra', today: '2026-11-06', netProfitCents: NET, hasProfit: true, isEstimate: status === 'in_progress', canComplete: status === 'complete', usingDefaults: false, settings: state.settings, retired: [],
      parts: state.settings.map((part, i) => ({ key: part.key, name: part.name, destination: part.destination, percent: part.percent, percentBasisPoints: Math.round(part.percent * 100), amountCents: amounts[i]!, completion: state.done[part.key] ?? null })),
    };
  };
  await page.route('http://localhost:3100/finance/profit-split**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const match = /\/finance\/profit-split\/(\d{4}-\d{2})\/parts\/([^/]+)$/.exec(url.pathname);
    if (url.pathname.endsWith('/profit-split/settings')) { state.saves.push(request.postDataJSON()); state.settings = (request.postDataJSON().parts as ProfitSplitSetting[]).map((part, i) => ({ ...part, key: part.key ?? `new-${i}` })); return route.fulfill({ json: { saved: true } }); }
    if (match && request.method() === 'PUT') {
      const body = request.postDataJSON() as { doneOn: string; note: string };
      const part = view(match[1]!).parts.find(candidate => candidate.key === match[2])!;
      state.done[part.key] = { doneOn: body.doneOn, note: body.note, amountCents: part.amountCents, percentBasisPoints: part.percentBasisPoints, partName: part.name, destination: part.destination, changedSinceDone: false };
      return route.fulfill({ json: view(match[1]!) });
    }
    if (match && request.method() === 'DELETE') { delete state.done[match[2]!]; return route.fulfill({ json: view(match[1]!) }); }
    return route.fulfill({ json: view(url.searchParams.get('month')!) });
  });
  return state;
}

test('owner sees the split on a phone, marks a part done and edits the settings', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const state = await session(page);
  await page.goto('/finance');
  await expect(page.getByRole('heading', { name: 'Mensah Trading' })).toBeVisible();

  // The current month is an estimate and cannot be marked done.
  const split = page.locator('.profit-split');
  await expect(split.getByText("Estimate so far — the month isn't finished")).toBeVisible();
  await expect(split.getByRole('checkbox', { name: 'Done' }).first()).toBeDisabled();

  await page.getByRole('combobox', { name: 'Finance month' }).click();
  await page.getByRole('option', { name: 'October', exact: true }).click();
  await expect(split.getByRole('heading', { name: 'Profit split' })).toBeVisible();
  await expect(split.getByText("Estimate so far")).toHaveCount(0);
  await expect(split.locator('.profit-split-net')).toContainText('1,234.57');
  await expect(split.getByText('Tax reserve')).toBeVisible();
  await expect(split.getByText('Target: 1–3 months of expenses')).toBeVisible();
  const [tax, reserve] = [split.locator('li', { hasText: 'Tax reserve' }), split.locator('li', { hasText: 'Top up emergency reserve' })];
  await expect(tax).toContainText('123.46'); // 10% is 123.457: both 10% parts have the biggest remainder, so they round up
  await expect(reserve).toContainText('246.92'); // 20% is 246.914; the leftover cent goes to the largest remainder
  await expect(split.locator('.profit-split-total')).toContainText('1,234.57');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const box = await split.getByRole('checkbox', { name: 'Done' }).first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(20);
  await tax.getByLabel('Done').check();
  await tax.getByLabel('Note for Tax reserve').fill('Paid to GRA');
  await tax.getByRole('button', { name: 'Save as done' }).click();
  await expect(tax).toContainText('Paid to GRA');
  await expect(tax.getByLabel(/^Done on/)).toBeChecked();
  expect(state.done['default-1']).toMatchObject({ note: 'Paid to GRA', doneOn: '2026-11-06' });
  await page.screenshot({ path: process.env.SPLIT_SHOT ?? 'test-results/profit-split-375.png', fullPage: true });

  await tax.getByLabel(/^Done on/).click();
  await expect(tax.getByLabel('Done', { exact: true })).not.toBeChecked();

  await page.getByRole('button', { name: 'Profit split settings' }).click();
  const form = page.locator('.profit-split-settings');
  await expect(form.getByRole('status')).toContainText('Total 100%');
  await form.getByRole('button', { name: 'Add part' }).click();
  await expect(form.getByRole('status')).toContainText('enter a percent for every part');
  await expect(form.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  const growth = form.locator('fieldset').nth(5);
  await growth.getByLabel('Percent').fill('15.5');
  const added = form.locator('fieldset').nth(6);
  await added.getByLabel('Name').fill('Charity');
  await added.getByLabel('Destination').fill('Giving account');
  await added.getByLabel('Percent').fill('4.5');
  await expect(form.getByRole('status')).toContainText('Total 100%');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await form.getByRole('button', { name: 'Save settings' }).click();
  await expect(split.getByText('Charity')).toBeVisible();
  expect(state.saves).toHaveLength(1);
  await expect(form).toHaveCount(0);
});
