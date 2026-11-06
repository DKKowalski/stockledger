import { expect, test, type Page } from '@playwright/test';

const companyId = '31000000-0000-4000-8000-000000000098';
const shopId = '32000000-0000-4000-8000-000000000098';
const summary = { netSalesCents: 0, discountsGivenCents: 0, fullPriceSalesCents: 0, costedRevenueCents: 0, cogsCents: 0, grossProfitCents: 0, marginPercent: null, inventoryLossCents: 0, costCoveragePercent: 100, unitsSold: 0, unitsReturned: 0 };

// A mocked session: the login endpoint is rate limited and the demo specs already use its allowance.
async function ownerAt(page: Page, path: string) {
  await page.route('http://localhost:3100/**', route => route.fulfill({ json: [] }));
  await page.route('**/auth/refresh', route => route.fulfill({ json: { accessToken: 'test.session.token', user: { id: 'test-admin', companyId, fullName: 'Test admin', email: 'test@example.invalid', role: 'administrator', locationId: null, isActive: true, isDemo: false, setupPending: false } } }));
  await page.route('**/onboarding', route => route.fulfill({ json: { completed: true, company: { id: companyId, name: 'Test business', businessType: 'mixed', inventorySource: 'paper' }, counts: { locations: 1, items: 1, movements: 1, teammates: 1 } } }));
  await page.route('**/settings', route => route.fulfill({ json: { id: companyId, name: 'Test business', currency: 'GHS', timeZone: 'Africa/Accra', defaultUnit: 'pcs', defaultReorderLevel: 0, defaultLocationId: shopId, itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse' } }));
  await page.route('**/inventory/snapshot**', route => route.fulfill({ json: { items: [], locations: [{ id: shopId, name: 'Shop', type: 'shop' }], positions: [], movements: [], periodMovements: [], summary: { closingUnits: 0, stockValueCents: 0, lowStockItems: 0, damagedUnits: 0, deadStockLines: 0 } } }));
  await page.route('**/inventory/profitability**', route => route.fulfill({ json: { periodDays: 30, startDate: '2026-01-01', endDate: '2026-01-31', summary, lines: [], trend: [] } }));
  await page.route('**/inventory/movements?**', route => route.fulfill({ json: { movements: [], total: 0, offset: 0, limit: 50 } }));
  await page.goto(path);
}
async function openCustom(page: Page, label: string) {
  await page.getByRole('combobox', { name: label, exact: true }).first().click();
  await page.getByRole('option', { name: 'Custom dates', exact: true }).click();
}

for (const width of [1440, 390]) {
  test(`blocks a backwards range and applies a custom range at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ownerAt(page, '/profitability');
    await openCustom(page, 'Profit period');
    await page.getByLabel('Start date').fill('2026-03-10');
    await page.getByLabel('End date').fill('2026-03-01');
    await expect(page.getByRole('alert').filter({ hasText: 'on or after the start date' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply dates' })).toBeDisabled();
    await page.getByLabel('End date').fill('2026-03-31');
    const request = page.waitForRequest(candidate => candidate.url().includes('/inventory/profitability') && candidate.url().includes('from=2026-03-10') && candidate.url().includes('to=2026-03-31'));
    await page.getByRole('button', { name: 'Apply dates' }).click();
    await request;
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('applies from the keyboard and returns to a preset', async ({ page }) => {
  await ownerAt(page, '/movements');
  await openCustom(page, 'Reporting period');
  await page.getByLabel('Start date').fill('2026-01-01');
  await page.getByLabel('End date').fill('2026-01-31');
  const applied = page.waitForRequest(candidate => candidate.url().includes('/inventory/movements?') && candidate.url().includes('to=2026-01-31'));
  await page.getByLabel('End date').press('Enter');
  await applied;
  await page.getByRole('combobox', { name: 'Reporting period', exact: true }).first().click();
  const preset = page.waitForRequest(candidate => candidate.url().includes('/inventory/movements?') && !candidate.url().includes('2026-01-31'));
  await page.getByRole('option', { name: 'Last 30 days', exact: true }).click();
  await preset;
  await expect(page.getByLabel('Start date')).toHaveCount(0);
});

test('the shared store range reaches every inventory page and the activity log', async ({ page }) => {
  await ownerAt(page, '/reports');
  await openCustom(page, 'Reporting period');
  await page.getByLabel('Start date').fill('2026-02-01');
  await page.getByLabel('End date').fill('2026-02-02');
  const snapshot = page.waitForRequest(candidate => candidate.url().includes('/inventory/snapshot') && candidate.url().includes('from=2026-02-01'));
  await page.getByRole('button', { name: 'Apply dates' }).click();
  await snapshot;
  await page.evaluate(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByLabel('Start date')).toHaveValue('2026-02-01');
  await page.evaluate(() => { window.history.pushState({}, '', '/settings/activity'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await openCustom(page, 'Reporting period');
  await page.getByLabel('Start date').fill('2026-02-01');
  await page.getByLabel('End date').fill('2026-02-02');
  const activity = page.waitForRequest(candidate => candidate.url().includes('/settings/activity') && candidate.url().includes('to=2026-02-02'));
  await page.getByRole('button', { name: 'Apply dates' }).click();
  await activity;
});
