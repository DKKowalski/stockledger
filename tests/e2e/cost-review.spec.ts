import { expect, test, type Page } from '@playwright/test';
import type { CostReview, CostReviewInput } from '../../apps/web/src/types';

const companyId = '31000000-0000-4000-8000-000000000077';
const itemId = '51000000-0000-4000-8000-000000000077';
const shopId = '32000000-0000-4000-8000-000000000077';
const item = { id: itemId, name: 'Cost review product', sku: 'COST', unit: 'bottle', unitCostCents: 500, sellingPriceCents: 1000,
  updatedAt: '2026-10-21T00:00:00.000Z', createdAt: '2026-10-21T00:00:00.000Z', category: 'Test', reorderLevel: 0, isActive: true };
const initial = (cost = 500): CostReview => ({ available: true, developmentOnly: true, currency: 'GHS', item: { ...item, unitCostCents: cost }, state: 'unconfirmed', review: null });
async function session(page: Page, available = true) {
  await page.route('**/auth/refresh', route => route.fulfill({ json: { accessToken: 'test.session.token', user: { id: 'test-admin', companyId, fullName: 'Test admin', email: 'test@example.invalid', role: 'administrator', locationId: null, isActive: true, isDemo: false, setupPending: false } } }));
  await page.route('**/onboarding', route => route.fulfill({ json: { completed: true, company: { id: companyId, name: 'Test business', businessType: 'mixed', inventorySource: 'paper' }, counts: { locations: 1, items: 1, movements: 1, teammates: 1 } } }));
  await page.route('**/settings', route => route.fulfill({ json: { id: companyId, name: 'Test business', currency: 'GHS', timeZone: 'Africa/Accra', defaultUnit: 'bottle', defaultReorderLevel: 0, defaultLocationId: shopId, itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse' } }));
  await page.route('**/inventory/snapshot**', route => route.fulfill({ json: { items: [item], locations: [{ id: shopId, name: 'Shop', type: 'shop' }], positions: [], movements: [], periodMovements: [], summary: { closingUnits: 0, stockValueCents: 0, lowStockItems: 0, damagedUnits: 0, deadStockLines: 0 } } }));
  await page.route('**/inventory/pricing-preview', route => route.fulfill({ json: { available: false, previewOnly: true } }));
  await page.route('**/inventory/cost-review', route => route.fulfill({ json: { available, developmentOnly: true } }));
}
async function select(page: Page, label: string, name: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}
function confirmed(current: CostReview, body: CostReviewInput): CostReview {
  return { ...current, state: 'confirmed', review: { id: 'review-1', costCents: current.item.unitCostCents, unit: current.item.unit,
    itemUpdatedAt: current.item.updatedAt, currency: current.currency, source: body.source, reference: body.reference, reviewedAt: '2026-10-21T12:00:00.000Z', reviewedByUserId: 'test-admin' } };
}

test('keeps the optional cost review hidden when disabled', async ({ page }) => {
  await session(page, false); await page.goto('/items');
  await expect(page.getByRole('region', { name: /catalog/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review purchase costs', exact: true })).toHaveCount(0);
});

// The cost review screen is hidden while exact costing is postponed; its API stays covered by integration tests.
for (const width of [1440, 390]) {
  test.skip(`confirms and restores the current cost without a stock write at width ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); await session(page);
    let current = initial(), writes = 0, stockWrites = 0;
    await page.route('**/inventory/movements', route => { stockWrites++; return route.fulfill({ status: 500, json: {} }); });
    await page.route(`**/inventory/items/${itemId}/cost-review`, route => {
      if (route.request().method() === 'POST') {
        writes++; const body: CostReviewInput = route.request().postDataJSON();
        expect(body).toEqual({ expectedCostCents: 500, expectedUnit: 'bottle', expectedCurrency: 'GHS', expectedItemUpdatedAt: item.updatedAt, source: 'opening_records', reference: 'Opening stock sheet TEST-1', confirmed: true });
        current = confirmed(current, body);
      }
      return route.fulfill({ json: current });
    });
    await page.goto('/items'); await select(page, 'Cost review item', item.name);
    const panel = page.locator('.cost-review-panel');
    await expect(panel.getByRole('status')).toContainText('has not been reviewed');
    await expect(panel.getByRole('button', { name: 'Confirm current cost', exact: true })).toBeDisabled();
    await select(page, 'Records checked', 'Opening stock records');
    await panel.getByLabel('Record reference', { exact: true }).fill('Opening stock sheet TEST-1');
    await panel.getByRole('button', { name: 'Confirm current cost', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('confirmed by an administrator');
    await expect(panel.getByRole('button', { name: 'Confirm current cost', exact: true })).toHaveCount(0);
    await page.reload(); await select(page, 'Cost review item', item.name);
    await expect(panel).toContainText('Opening stock sheet TEST-1');
    expect(writes).toBe(1); expect(stockWrites).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`cost-review-${width}.png`) });
  });
}

test.skip('does not treat zero as free stock without an explicit confirmation and record', async ({ page }) => {
  await session(page); let current = initial(0), writes = 0;
  await page.route(`**/inventory/items/${itemId}/cost-review`, route => {
    if (route.request().method() === 'POST') {
      const body: CostReviewInput = route.request().postDataJSON(); writes++;
      expect(body.source).toBe('free_acquisition'); expect(body.expectedCostCents).toBe(0);
      current = confirmed(current, body);
    }
    return route.fulfill({ json: current });
  });
  await page.goto('/items'); await select(page, 'Cost review item', item.name);
  const panel = page.locator('.cost-review-panel');
  await expect(panel.getByText('If the cost is missing, correct it under Catalog maintenance before confirming.')).toBeVisible();
  await panel.getByLabel('Record reference', { exact: true }).fill('Supplier sample note TEST-2');
  await expect(panel.getByRole('button', { name: 'Confirm current cost', exact: true })).toBeDisabled();
  await panel.getByLabel('This stock was acquired free of charge.').check();
  await panel.getByRole('button', { name: 'Confirm current cost', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Confirmed as stock acquired free of charge'); expect(writes).toBe(1);
});

test.skip('a stale review requires reloading and checking the new cost before retrying', async ({ page }) => {
  await session(page); let current = initial(), writes = 0;
  await page.route(`**/inventory/items/${itemId}/cost-review`, route => {
    if (route.request().method() === 'POST') {
      const body: CostReviewInput = route.request().postDataJSON(); writes++;
      if (writes === 1) {
        current = { ...current, currency: 'USD', item: { ...item, unitCostCents: 600, updatedAt: '2026-10-21T01:00:00.000Z' } };
        return route.fulfill({ status: 409, json: { message: 'The item changed. Reload and check its current cost before confirming' } });
      }
      expect(body.expectedCurrency).toBe('USD'); expect(body.expectedCostCents).toBe(600); expect(body.expectedItemUpdatedAt).toBe(current.item.updatedAt);
      current = confirmed(current, body);
    }
    return route.fulfill({ json: current });
  });
  await page.goto('/items'); await select(page, 'Cost review item', item.name); const panel = page.locator('.cost-review-panel');
  await select(page, 'Records checked', 'Purchase records'); await panel.getByLabel('Record reference', { exact: true }).fill('Receipt TEST-3');
  await panel.getByRole('button', { name: 'Confirm current cost', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('The item changed');
  await expect(panel.getByRole('button', { name: 'Confirm current cost', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Reload current cost', exact: true }).click();
  await expect(panel.getByLabel('Record reference', { exact: true })).toHaveValue('');
  await expect(panel.locator('.pricing-current-price strong')).toContainText('$6.00');
  await select(page, 'Records checked', 'Purchase records'); await panel.getByLabel('Record reference', { exact: true }).fill('Receipt TEST-4');
  await panel.getByRole('button', { name: 'Confirm current cost', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('confirmed by an administrator'); expect(writes).toBe(2);
});
