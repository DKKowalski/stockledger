import { expect, test } from '@playwright/test';
import { uiuxEvidence } from './helpers/uiux-evidence';

for (const width of [390, 1440]) {
  test(`movement correction confirms identity and stock effect, supports cancel and failed retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('http://localhost:3100/**', route => route.fulfill({ json: [] }));
    await page.route('**/auth/refresh', route => route.fulfill({ json: { accessToken: 'test-session', user: { id: 'manager', companyId: 'company', fullName: 'Manager', role: 'inventory_manager', isActive: true } } }));
    await page.route('**/settings', route => route.fulfill({ json: { currency: 'GHS', timeZone: 'Africa/Accra', itemTerm: 'item', shopTerm: 'shop' } }));
    const item = { id: 'item', name: 'Milo 400g Tin', sku: 'MIL400', unit: 'tin', isActive: true };
    const location = { id: 'shop', name: 'Main shop', type: 'shop' };
    await page.route('**/inventory/snapshot**', route => route.fulfill({ json: { generatedAt: Date.now().toString(), items: [item], locations: [location], positions: [], summary: {} } }));
    let removed = false, calls = 0, fail = true;
    const movement = { id: 'receipt', itemId: item.id, locationId: location.id, type: 'purchase', quantity: 12, movementDate: '2026-11-01', reference: 'PO-123', item, location, unitCostCents: 3200, saleTotalCents: null, sign: 1 };
    await page.route('**/inventory/movements?**', route => route.fulfill({ json: { movements: removed ? [{ ...movement, correctedByMovementId: 'correction' }, { ...movement, id: 'correction', type: 'return_out', correctsMovementId: movement.id, note: 'Purchase correction. Original receipt retained.', sign: -1 }] : [movement], total: removed ? 2 : 1 } }));
    await page.route('**/inventory/movements/receipt', route => {
      calls++;
      if (fail) return route.fulfill({ status: 409, json: { message: 'Later movements depend on this stock' } });
      removed = true;
      return route.fulfill({ json: { id: 'receipt' } });
    });
    await page.goto('/movements');
    const trigger = page.getByRole('button', { name: 'Correct movement for Milo 400g Tin' });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Milo 400g Tin · MIL400');
    await expect(dialog).toContainText('PO-123');
    await expect(dialog).toContainText('original receipt stays in history');
    await expect(dialog).toContainText('Stock decreases by 12 at Main shop');
    await expect(dialog).toContainText('32.00');
    await expect(dialog).toContainText('Receipt amount to remove');
    await expect(dialog).toContainText('384.00');
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    expect(calls).toBe(0);
    await uiuxEvidence(page, 'ux04-receipt-confirmation');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(calls).toBe(0);
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'Remove this receipt', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Later movements depend on this stock');
    expect(calls).toBe(1);
    fail = false;
    await dialog.getByRole('button', { name: 'Remove this receipt', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'Purchase correction', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Corrected', exact: true })).toBeVisible();
    await uiuxEvidence(page, 'f01-correction-history');
    await expect(page.getByRole('heading', { name: /^Movement ledger/ })).toBeFocused();
    expect(calls).toBe(2);
    // Transfers affect both places; outgoing damage restores stock when removed.
    removed = false;
    Object.assign(movement, { type: 'transfer', quantity: 4, destination: { id: 'other', name: 'Other shop' }, destinationLocationId: 'other' });
    await page.reload();
    await trigger.click();
    await expect(dialog).toContainText('Stock increases by 4 at Main shop and decreases by 4 at Other shop');
    await uiuxEvidence(page, 'ux04-transfer-confirmation');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    Object.assign(movement, { type: 'damage', quantity: 3, destination: null, destinationLocationId: null, sign: -1 });
    await page.reload();
    await trigger.click();
    await expect(dialog).toContainText('Stock increases by 3 at Main shop');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(calls).toBe(2);
  });
}
