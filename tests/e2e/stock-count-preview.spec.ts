import { expect, test } from '@playwright/test';
import { clickDay } from './helpers/calendar';

test('count variance uses the selected business date and cannot save an unavailable preview', async ({ page }) => {
  const companyId = '31000000-0000-4000-8000-000000000098';
  const shop = { id: '32000000-0000-4000-8000-000000000098', name: 'Count shop', type: 'shop' };
  const item = { id: '51000000-0000-4000-8000-000000000098', name: 'Count product', sku: 'COUNT', category: 'Test', unit: 'pcs', isActive: true, sellingPriceCents: 175, unitCostCents: 100, reorderLevel: 0 };
  await page.route('**/auth/refresh', route => route.fulfill({ json: { accessToken: 'count-test-session', user: { id: '41000000-0000-4000-8000-000000000098', companyId, fullName: 'Manager', email: 'manager@example.invalid', role: 'inventory_manager', isActive: true } } }));
  await page.route('**/settings', route => route.fulfill({ json: { id: companyId, name: 'Count test', currency: 'GHS', timeZone: 'Africa/Accra', itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse' } }));
  await page.route('**/inventory/snapshot**', route => route.fulfill({ json: { items: [item], locations: [shop], positions: [{ item, location: shop, closing: 14 }], movements: [], periodMovements: [], summary: {} } }));
  await page.route('**/inventory/stock-counts', route => route.fulfill({ json: [] }));
  let fail = false, submitted: Record<string, unknown> | undefined;
  await page.route('**/inventory/stock-counts/preview?**', route => {
    const date = new URL(route.request().url()).searchParams.get('countedAt');
    return fail ? route.fulfill({ status: 503, json: { message: 'Unavailable' } }) : route.fulfill({ json: { expectedQuantity: date === '2026-11-04' ? 10 : 14 } });
  });
  await page.goto('/stock-counts');
  await page.getByRole('combobox', { name: 'Place', exact: true }).click();
  await page.getByRole('option', { name: shop.name, exact: true }).click();
  await page.getByRole('combobox', { name: 'Item', exact: true }).click();
  await page.getByRole('option', { name: item.name, exact: true }).click();
  await expect(page.getByLabel('Ledger quantity', { exact: true })).toHaveValue('14');
  await page.getByRole('button', { name: /^Count date:/ }).click();
  await clickDay(page, '2026-11-04');
  await expect(page.getByLabel('Ledger quantity', { exact: true })).toHaveValue('10');
  await page.getByLabel('Counted quantity', { exact: true }).fill('8');
  await expect(page.locator('.stock-count-variance strong')).toHaveText('-2');
  await page.route('**/inventory/stock-counts', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: [] });
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 409, json: { message: 'Stock changed since you reviewed this count. Refresh and review the variance.' } });
  });
  fail = true;
  await page.getByRole('button', { name: 'Save count', exact: true }).click();
  await expect.poll(() => submitted).toMatchObject({ countedAt: '2026-11-04', expectedQuantity: 10, countedQuantity: 8 });
  await expect(page.getByRole('alert').filter({ hasText: 'ledger quantity for this date could not load' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save count', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Counted quantity', { exact: true })).toHaveValue('8');
  fail = false;
  await page.getByRole('button', { name: 'Retry ledger quantity' }).click();
  await expect(page.getByLabel('Ledger quantity', { exact: true })).toHaveValue('10');
  await expect(page.getByRole('button', { name: 'Save count', exact: true })).toBeEnabled();
});
