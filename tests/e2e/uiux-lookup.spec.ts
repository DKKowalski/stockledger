import { expect, test, type Page } from '@playwright/test';
import { uiuxEvidence } from './helpers/uiux-evidence';

const targetName = 'Milo Malt Chocolate Drink Large Family Tin 400g';
async function session(page: Page, role = 'shop_attendant', deals = false, precise = false) {
  const shop = { id: 'shop', name: 'Main shop', type: 'shop' };
  const store = { id: 'store', name: 'Warehouse', type: 'warehouse' };
  const target = { id: 'target', name: targetName, sku: 'MIL400-A', category: 'Drinks', unit: 'tin', isActive: true, sellingPriceCents: 4200, unitCostCents: 3200, reorderLevel: 2, preciseCosting: precise };
  const items = [target, { ...target, id: 'duplicate', sku: 'MIL400-B' }, { ...target, id: 'empty', name: 'Empty shelf product', sku: 'EMPTY' }, ...Array.from({ length: 150 }, (_, i) => ({ ...target, id: `item-${i}`, name: `Household product ${i}`, sku: `HH-${i}` }))];
  const positions = items.map((item, index) => ({ item, location: shop, closing: index === 2 ? 0 : index === 0 ? 7 : 9, opening: 10, purchases: 0, returnsIn: 0, transferredIn: 0, transferredOut: 0, returnsOut: 0, damaged: 0, sales: 3, adjustmentsIn: 0, adjustmentsOut: 0, valueCents: 22400, isLowStock: false, velocity: 'fast', outLastPeriod: 3, lastOutDate: null }));
  await page.route('http://localhost:3100/**', route => route.fulfill({ json: [] }));
  await page.route('**/auth/refresh', route => route.fulfill({ json: { accessToken: 'lookup-session', user: { id: role, companyId: 'company', fullName: 'Shop staff', role, isActive: true, locationId: role === 'shop_attendant' ? shop.id : null, isDemo: false, setupPending: false } } }));
  await page.route('**/settings', route => route.fulfill({ json: { currency: 'GHS', timeZone: 'Africa/Accra', itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse' } }));
  await page.route('**/inventory/snapshot**', route => route.fulfill({ json: { generatedAt: '2026-11-06', locationId: role === 'shop_attendant' ? shop.id : null, items, locations: role === 'shop_attendant' ? [shop] : [shop, store], positions: role === 'shop_attendant' ? positions : [...positions, { ...positions[0], location: store, closing: 999 }], movements: [], periodMovements: [], summary: { closingUnits: 7, stockValueCents: 22400, lowStockItems: 0, damagedUnits: 0, deadStockLines: 0 } } }));
  await page.route('**/inventory/sale-completion', route => route.fulfill({ json: { available: deals } }));
  await page.route('**/inventory/stock-counts/preview?**', route => route.fulfill({ json: { expectedQuantity: 7 } }));
}

for (const width of [360, 390, 1440]) {
  test(`staff find duplicate/long item names by code and carry identity into Sell at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await session(page);
    await page.goto('/items');
    const search = page.getByRole('searchbox', { name: 'Search items by name or code' });
    await search.fill('MIL400-A');
    const row = width < 600 ? page.locator('.phone-stock-row') : page.locator('.desktop-stock-table tbody tr');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(targetName);
    await expect(row).toContainText('42.00');
    await expect(row).toContainText('7');
    if (width !== 360) await uiuxEvidence(page, 'ux01-staff-catalog');
    const quantity = width < 600 ? row.locator('.phone-stock-available') : row.locator('td').nth(4);
    await expect(quantity).toBeInViewport();
    await row.getByRole('link', { name: `Sell ${targetName}`, exact: true }).click();
    await expect(page).toHaveURL('/sell?item=target');
    await expect(page.getByRole('combobox', { name: 'Item', exact: true })).toContainText(targetName);
    await expect(page.locator('.selected-availability')).toHaveText('7 tin available at Main shop');
    if (width !== 360) await uiuxEvidence(page, 'ux01-retail-sell');
    await page.getByRole('combobox', { name: 'Item', exact: true }).click();
    const lookup = page.getByRole('combobox', { name: 'Search items by name or code' });
    await lookup.fill('Milo');
    await expect(page.getByRole('option', { name: targetName, exact: true })).toHaveCount(2);
    await lookup.fill('MIL400-B');
    await expect(page.getByRole('option', { name: targetName, exact: true })).toContainText('MIL400-B');
    await expect(page.getByRole('option', { name: targetName, exact: true })).toContainText('9 tin available at Main shop');
    if (width !== 360) await uiuxEvidence(page, 'ux01-searchable-picker');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.selected-availability')).toHaveText('9 tin available at Main shop');
    await page.getByRole('combobox', { name: 'Item', exact: true }).click();
    await lookup.fill('EMPTY');
    const empty = page.getByRole('option', { name: 'Empty shelf product', exact: true });
    await expect(empty).toHaveAttribute('aria-disabled', 'true');
    await expect(empty).toContainText('0 tin — out of stock');
    await lookup.fill('no such item');
    await expect(page.getByText('No matching items. Try the name or code.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Item', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto('/items');
    await search.fill('no such item');
    await expect(page.getByText('No items match this name or code.')).toBeVisible();
  });
}

for (const width of [390, 1440]) {
  test(`deals checkout keeps searchable selection and stock beside quantity at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await session(page, 'shop_attendant', true);
    await page.goto('/sell?item=target');
    await expect(page.locator('.selected-availability')).toHaveText('7 tin available at Main shop');
    await expect(page.getByRole('button', { name: 'Review sale', exact: true })).toBeVisible();
    await uiuxEvidence(page, 'ux01-deals-sell');
    await page.getByRole('combobox', { name: 'Item', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search items by name or code' }).fill('MIL400-A');
    await page.getByRole('option', { name: targetName, exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Item', exact: true })).toContainText(targetName);
  });

  test(`manager lookup and current stock keep the available quantity visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await session(page, 'inventory_manager');
    await page.goto('/items');
    await page.getByRole('searchbox', { name: 'Search items by name or code' }).fill('MIL400-A');
    const row = width < 600 ? page.locator('.phone-stock-row') : page.locator('.desktop-stock-table tbody tr');
    await expect(row).toHaveCount(2);
    await expect(row.first()).toContainText('Main shop');
    await expect(row.last()).toContainText('999');
    await expect(page.getByRole('link', { name: /^Sell / })).toHaveCount(0);
    await uiuxEvidence(page, 'ux01-manager-catalog');
    await page.goto('/reports');
    if (width < 600) {
      await expect(page.locator('.phone-stock-row').first().locator('.phone-stock-available')).toHaveText('7 tin available');
      await expect(page.locator('.phone-stock-row').first().locator('.phone-stock-available')).toBeInViewport();
      await page.locator('.phone-stock-row').first().getByText('Stock details', { exact: true }).click();
      await expect(page.locator('.phone-stock-row').first()).toContainText('Opening10');
    } else await expect(page.getByRole('columnheader', { name: 'Closing', exact: true })).toBeVisible();
    await uiuxEvidence(page, 'ux01-current-stock-report');
    await page.goto('/movements');
    await page.getByRole('combobox', { name: 'Place', exact: true }).click();
    await page.getByRole('option', { name: 'Main shop', exact: true }).click();
    await page.getByRole('combobox', { name: 'Item', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search items by name or code' }).fill('MIL400-A');
    const option = page.getByRole('option', { name: targetName, exact: true });
    await expect(option).toContainText('7 tin available at Main shop');
    await expect(option).not.toContainText('999');
    await uiuxEvidence(page, 'ux01-movement-picker');
    await option.click();
    await page.goto('/stock-counts');
    await page.getByRole('combobox', { name: 'Place', exact: true }).click();
    await page.getByRole('option', { name: 'Main shop', exact: true }).click();
    await page.getByRole('combobox', { name: 'Item', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search items by name or code' }).fill('MIL400-A');
    await uiuxEvidence(page, 'ux01-count-picker');
    await page.getByRole('option', { name: targetName, exact: true }).click();
    await expect(page.getByLabel('Ledger quantity', { exact: true })).toHaveValue('7');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test.describe('phone touch lookup', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  test('searches by code and selects the exact item with touch', async ({ page }) => {
    await session(page);
    await page.goto('/sell');
    await page.getByRole('combobox', { name: 'Item', exact: true }).tap();
    await page.getByRole('combobox', { name: 'Search items by name or code' }).fill('MIL400-A');
    await page.getByRole('option', { name: targetName, exact: true }).tap();
    await expect(page.locator('.selected-availability')).toHaveText('7 tin available at Main shop');
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
  });
});

for (const width of [390, 1440]) {
  test(`exact stock forms use the shared searchable picker at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await session(page, 'inventory_manager', false, true);
    await page.route('**/inventory/stock-operations', route => route.fulfill({ json: { available: true, hasEnrolledItems: true } }));
    await page.goto('/movements');
    await page.getByRole('combobox', { name: 'Exact stock item', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search items by name or code' }).fill('MIL400-A');
    await expect(page.getByRole('option', { name: targetName, exact: true })).toHaveCount(1);
    await expect(page.getByRole('option', { name: targetName, exact: true })).toContainText('MIL400-A');
    await uiuxEvidence(page, 'ux01-exact-stock-picker');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Exact stock item', exact: true })).toBeFocused();
  });
}
