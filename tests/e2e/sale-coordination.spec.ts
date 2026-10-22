import { expect, test, type BrowserContext } from '@playwright/test';

const companyId = '31000000-0000-4000-8000-000000000099';
const userId = '41000000-0000-4000-8000-000000000099';
const shopId = '32000000-0000-4000-8000-000000000099';
const itemId = '51000000-0000-4000-8000-000000000099';

async function prepared(context: BrowserContext, suspendStorageEvents = false) {
  // UI coordination boundary only. Separate HTTP/live tests verify actual financial persistence.
  const item = { id: itemId, sku: 'TEST', name: 'Test product', category: 'Test', unit: 'pcs', unitCostCents: 1000, sellingPriceCents: 1500, reorderLevel: 0, isActive: true };
  const shop = { id: shopId, name: 'Shop', type: 'shop' };
  const snapshot = { items: [item], locations: [shop], locationId: shopId, periodDays: 30, positions: [{ item, location: shop, closing: 30 }], movements: [], periodMovements: [], summary: { closingUnits: 30, stockValueCents: 30000, lowStockItems: 0, damagedUnits: 0, deadStockLines: 0 } };
  const line = { itemId, itemName: item.name, baseUnit: 'pcs', quantity: 15, retailPriceCents: 1500, pricingVersion: 1, priceDropQuantities: [], components: [{ category: 'box', quantity: 10, unitPriceCents: 1200, totalCents: 12000 }, { category: 'bulk', quantity: 5, unitPriceCents: 1300, totalCents: 6500 }] };
  const quote = { currency: 'GHS', totalCents: 18500, grossSalesCents: 22500, automaticDiscountCents: 4000, lines: [line] };
  await context.route('**/auth/refresh', route => route.fulfill({ json: { accessToken: 'test-only-session', user: { id: userId, companyId, locationId: shopId, fullName: 'Tester', email: 'tester@example.invalid', role: 'shop_attendant', isActive: true, isDemo: false, setupPending: false } } }));
  await context.route('**/onboarding', route => route.fulfill({ json: { completed: true, company: { id: companyId, name: 'Test', businessType: 'mixed', inventorySource: 'paper' }, counts: { locations: 1, items: 1, movements: 1, teammates: 1 } } }));
  await context.route('**/settings', route => route.fulfill({ json: { id: companyId, name: 'Test', currency: 'GHS', timeZone: 'Africa/Accra', itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse' } }));
  await context.route('**/inventory/snapshot**', route => route.fulfill({ json: snapshot }));
  await context.route('**/inventory/sale-completion', route => route.fulfill({ json: { available: true, developmentOnly: true } }));
  await context.route('**/inventory/pricing-preview/quote', route => route.fulfill({ json: { ...quote, previewOnly: true, canComplete: false } }));
  await context.route('**/inventory/sales/quote', route => route.fulfill({ json: { ...quote, canComplete: true, developmentOnly: true, quoteToken: 'synthetic.quote', expiresAt: '2099-01-01T00:00:00Z' } }));
  const pages = [await context.newPage(), await context.newPage()];
  if (suspendStorageEvents) await pages[1]!.addInitScript(() => window.addEventListener('storage', event => event.stopImmediatePropagation()));
  for (const page of pages) {
    await page.goto('/sell');
    await page.getByRole('combobox', { name: 'Item', exact: true }).click(); await page.getByRole('option', { name: item.name, exact: true }).click();
    await page.getByLabel('Quantity', { exact: true }).fill('15'); await page.getByRole('button', { name: 'Review sale', exact: true }).click();
    await expect(page.locator('.checkout-pay dd')).toContainText('185.00');
  }
  return { pages, quote };
}

test('two tabs queued together persist one pending intent and send one completion', async ({ context }) => {
  const { pages, quote } = await prepared(context);
  const lockName = `stockledger:sale-request:${companyId}:${userId}:${shopId}:`;
  await pages[0]!.evaluate(name => new Promise<boolean>(acquired => {
    void navigator.locks.request(name, async () => {
      acquired(true); await new Promise<void>(release => { (window as unknown as { releaseCheckoutLock: () => void }).releaseCheckoutLock = release; });
    });
  }), lockName);
  let writes = 0; let releaseResponse!: () => void;
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
  await context.route('**/inventory/sales/complete', async route => {
    writes++; await responseGate;
    await route.fulfill({ status: 201, json: { id: 'completed-test-sale', idempotencyKey: route.request().postDataJSON().idempotencyKey, status: 'completed', ...quote } });
  });
  await Promise.all(pages.map(page => page.getByRole('button', { name: 'Complete sale', exact: true }).evaluate((button: HTMLButtonElement) => button.click())));
  await expect.poll(async () => (await pages[0]!.evaluate(() => navigator.locks.query())).pending?.filter(lock => lock.name === lockName).length).toBe(2);
  await pages[0]!.evaluate(() => (window as unknown as { releaseCheckoutLock: () => void }).releaseCheckoutLock());
  try {
    await Promise.all(pages.map(page => expect(page.getByRole('heading', { name: 'Confirm pending sale', exact: true })).toBeVisible()));
    await expect.poll(() => writes).toBe(1);
    expect(await pages[0]!.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('stockledger:sale-request:')).length)).toBe(1);
  } finally { releaseResponse(); }
  await expect.poll(async () => pages[0]!.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('stockledger:sale-request:')).length)).toBe(0);
  expect(writes).toBe(1);
});


test('a suspended tab cannot complete a reviewed quote after another tab finishes', async ({ context }) => {
  // Register before the app so this tab misses the transient pending record entirely.
  const { pages, quote } = await prepared(context, true);
  let writes = 0;
  await context.route('**/inventory/sales/complete', async route => {
    writes++; await route.fulfill({ status: 201, json: { id: 'completed-test-sale', idempotencyKey: route.request().postDataJSON().idempotencyKey, status: 'completed', ...quote } });
  });
  await pages[0]!.getByRole('button', { name: 'Complete sale', exact: true }).click();
  await expect(pages[0]!.locator('.checkout-body')).toContainText('Sale recorded');
  await pages[1]!.getByRole('button', { name: 'Complete sale', exact: true }).click();
  await expect(pages[1]!.getByRole('alert')).toContainText('Review a new quote');
  await expect(pages[1]!.getByRole('button', { name: 'Complete sale', exact: true })).toHaveCount(0);
  expect(writes).toBe(1);
});
