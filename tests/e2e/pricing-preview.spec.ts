import { expect, test, type Page } from '@playwright/test';

const itemId = '51000000-0000-4000-8000-000000000099';
const shopId = '32000000-0000-4000-8000-000000000099';
const companyId = '31000000-0000-4000-8000-000000000099';
const item = { id: itemId, sku: 'TEST', name: 'Preview product', category: 'Test', unit: 'pcs',
  unitCostCents: 1000, sellingPriceCents: 1500, reorderLevel: 0, isActive: true,
  createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' };
const shop = { id: shopId, name: 'Test shop', type: 'shop' };
const snapshot = { items: [item], locations: [shop], locationId: shopId, periodDays: 30, generatedAt: '2026-10-20T00:00:00Z',
  summary: { closingUnits: 30, stockValueCents: 30000, lowStockItems: 0, damagedUnits: 0, deadStockLines: 1 },
  positions: [{ item, location: shop, opening: 30, purchases: 0, returnsIn: 0, transferredIn: 0,
    transferredOut: 0, returnsOut: 0, damaged: 0, sales: 0, adjustmentsIn: 0, adjustmentsOut: 0,
    closing: 30, valueCents: 30000, outLastPeriod: 0, lastOutDate: null, isLowStock: false, velocity: 'dead' }],
  movements: [], periodMovements: [] };

async function session(page: Page, role = 'administrator', available = true) {
  // Browser-only fixtures. Backend rules and writable HTTP workflows are tested against isolated PostgreSQL.
  await page.route('**/auth/refresh', (route) => route.fulfill({ json: { accessToken: 'test.session.token', user: {
    id: 'test-user', companyId, fullName: 'Test user', email: 'test@example.invalid', role,
    locationId: role === 'shop_attendant' ? shopId : null, isActive: true, isDemo: false, setupPending: false,
  } } }));
  await page.route('**/onboarding', (route) => route.fulfill({ json: { completed: true,
    company: { id: companyId, name: 'Test business', businessType: 'mixed', inventorySource: 'paper' },
    counts: { locations: 1, items: 1, movements: 1, teammates: 1 } } }));
  await page.route('**/settings', (route) => route.fulfill({ json: { id: companyId, name: 'Test business', currency: 'GHS',
    timeZone: 'Africa/Accra', defaultUnit: 'pcs', defaultReorderLevel: 0, defaultLocationId: shopId,
    itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse', requireAdjustmentReason: true } }));
  await page.route('**/inventory/snapshot**', (route) => route.fulfill({ json: snapshot }));
  await page.route('**/inventory/pricing-preview', (route) => route.fulfill({ json: { available, previewOnly: true } }));
}

// Pricing lives in the selected item's panel: pick the item, then its Pricing tab.
async function openPricing(page: Page) {
  await page.locator('.catalog-row', { hasText: 'Preview product' }).click();
  await page.getByRole('tab', { name: 'Pricing', exact: true }).click();
}

test('hides optional pricing controls when the company is not enabled', async ({ page }) => {
  await session(page, 'administrator', false);
  await page.goto('/items');
  await openPricing(page);
  await expect(page.getByLabel(/Selling price per/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Box and quantity pricing', exact: true })).toHaveCount(0);
});

for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
  test(`configures and previews pricing without recording a sale at width ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await session(page);
    let saved: Record<string, unknown> | null = null;
    let configuration: Record<string, unknown> | null = null;
    let mutations = 0;
    await page.route('**/inventory/movements', (route) => { mutations++; return route.fulfill({ status: 500, json: { message: 'Unexpected stock write' } }); });
    await page.route(`**/inventory/items/${itemId}/pricing-preview`, async (route) => {
      if (route.request().method() === 'PATCH') {
        saved = route.request().postDataJSON();
        configuration = {
          id: 'config-1', itemId, companyId, version: 1, baseUnit: 'pcs', previewEnabled: true,
          packageLabel: 'box', packageSize: 10, packagePriceCents: 12000,
          bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1300 }],
        };
      }
      return route.fulfill({ json: { available: true, previewOnly: true, configuration } });
    });
    await page.route('**/inventory/pricing-preview/quote', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ lines: [{ itemId, quantity: 15, quantityUnit: 'base', expectedVersion: 1 }] });
      return route.fulfill({ json: { previewOnly: true, canComplete: false, currency: 'GHS',
        grossSalesCents: 22500, automaticDiscountCents: 4000, totalCents: 18500,
        lines: [{ itemId, quantity: 15, priceDropQuantities: [], components: [
          { category: 'box', quantity: 10, unitPriceCents: 1200, totalCents: 12000 },
          { category: 'bulk', quantity: 5, unitPriceCents: 1300, totalCents: 6500 },
        ] }] } });
    });
    await page.goto('/items');
    await openPricing(page);
    const panel = page.locator('.pricing-preview-panel');
    await panel.getByRole('combobox', { name: 'Pricing option', exact: true }).click();
    await page.getByRole('option', { name: 'Box and quantity discounts', exact: true }).click();
    await panel.getByLabel('Offer a box or carton price').check();
    await panel.getByLabel('pcs per box').fill('10');
    await panel.getByLabel('Price for one box or carton', { exact: true }).fill('120');
    await panel.getByRole('button', { name: 'Add quantity discount' }).click();
    await panel.getByLabel('Discount minimum 1').fill('5');
    await panel.getByLabel('Discount price 1').fill('13');
    await expect(panel.getByRole('button', { name: 'Calculate total' })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Save pricing', exact: true })).toBeDisabled();
    await panel.getByLabel('My stock is counted in pcs.').check();
    await panel.getByRole('button', { name: 'Save pricing' }).click();
    await expect(panel.getByRole('button', { name: 'Calculate total' })).toBeEnabled();
    expect(saved).toMatchObject({ baseUnit: 'pcs', baseUnitVerified: true, expectedVersion: 0,
      package: { label: 'box', size: 10, priceCents: 12000 }, bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1300 }] });
    await panel.getByLabel('Test quantity', { exact: true }).fill('15');
    await panel.getByRole('button', { name: 'Calculate total' }).click();
    await expect(panel.locator('.pricing-quote-result')).toContainText('185.00');
    await expect(panel.getByText('Changes apply to the next sale. Sales already made keep the price they were sold at.')).toBeVisible();
    await expect(panel.getByLabel('My stock is counted in pcs.')).toHaveCount(0);
    expect(mutations).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByText('Pricing saved', { exact: true })).toBeHidden();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`pricing-preview-${viewport.width}.png`), fullPage: true });
    await page.reload();
    await openPricing(page);
    await expect(panel.getByLabel('My stock is counted in pcs.')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Save pricing', exact: true })).toBeEnabled();
  });
}

test('requires a fresh stock-unit confirmation when saved pricing uses a different unit', async ({ page }) => {
  await session(page);
  let submitted: Record<string, unknown> | null = null;
  await page.route(`**/inventory/items/${itemId}/pricing-preview`, async (route) => {
    if (route.request().method() === 'PATCH') submitted = route.request().postDataJSON();
    return route.fulfill({ json: { available: true, previewOnly: true, configuration: {
      version: submitted ? 5 : 4, baseUnit: submitted ? 'pcs' : 'carton', previewEnabled: true,
      packageLabel: 'box', packageSize: 10, packagePriceCents: 12000,
      bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1300 }],
    } } });
  });
  await page.goto('/items');
  await openPricing(page);
  const panel = page.locator('.pricing-preview-panel');
  await expect(panel.getByRole('button', { name: 'Save pricing', exact: true })).toBeDisabled();
  await panel.getByLabel('My stock is counted in pcs.').check();
  await panel.getByRole('button', { name: 'Save pricing', exact: true }).click();
  await expect(panel.getByLabel('My stock is counted in pcs.')).toHaveCount(0);
  expect(submitted).toMatchObject({ expectedVersion: 4, baseUnit: 'pcs', baseUnitVerified: true });
});

test('can switch to individual pricing without saving incomplete discount edits', async ({ page }) => {
  await session(page);
  let submitted: Record<string, unknown> | null = null;
  await page.route(`**/inventory/items/${itemId}/pricing-preview`, async (route) => {
    if (route.request().method() === 'PATCH') submitted = route.request().postDataJSON();
    return route.fulfill({ json: { available: true, previewOnly: true, configuration: {
      version: submitted ? 3 : 2, baseUnit: 'pcs', previewEnabled: !submitted,
      packageLabel: 'box', packageSize: 10, packagePriceCents: 12000,
      bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1300 }],
    } } });
  });
  await page.goto('/items');
  await openPricing(page);
  const panel = page.locator('.pricing-preview-panel');
  await panel.getByRole('button', { name: 'Add quantity discount', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Calculate total', exact: true })).toBeDisabled();
  await panel.getByRole('combobox', { name: 'Pricing option', exact: true }).click();
  await page.getByRole('option', { name: 'Individual price only', exact: true }).click();
  await panel.getByRole('button', { name: 'Save pricing', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Calculate total', exact: true })).toBeEnabled();
  expect(submitted).toMatchObject({ expectedVersion: 2, previewEnabled: false, baseUnitVerified: true,
    package: { label: 'box', size: 10, priceCents: 12000 }, bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1300 }] });
});

test('clears a committed sale form when the following inventory refresh fails', async ({ page }) => {
  await session(page, 'shop_attendant');
  let writes = 0;
  let refreshFails = false;
  await page.route('**/inventory/snapshot**', (route) => refreshFails
    ? route.fulfill({ status: 503, json: { message: 'Refresh unavailable' } })
    : route.fulfill({ json: snapshot }));
  await page.route('**/inventory/movements', (route) => {
    writes++; refreshFails = true;
    return route.fulfill({ status: 201, json: { id: 'committed-sale' } });
  });
  await page.goto('/sell');
  await page.getByRole('combobox', { name: 'Item', exact: true }).click();
  await page.getByRole('option', { name: 'Preview product', exact: true }).click();
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your change was saved');
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Sell', exact: true })).toBeDisabled();
  expect(writes).toBe(1);
  refreshFails = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(writes).toBe(1);
});
