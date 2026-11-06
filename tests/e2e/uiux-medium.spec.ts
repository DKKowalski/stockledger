import { expect, test } from '@playwright/test';
import { uiuxEvidence } from './helpers/uiux-evidence';

for (const width of [390, 1440]) {
  test(`returning staff can sign in from the landing header at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const signIn = page.locator('.landing-nav').getByRole('link', { name: 'Sign in', exact: true });
    await expect(signIn).toBeInViewport();
    expect((await signIn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('.landing-hero').getByRole('link', { name: 'Sign in' })).toBeVisible();
    await uiuxEvidence(page, 'ux06-landing');
    await signIn.click();
    await expect(page).toHaveURL('/login');
  });
}

import { mediumSession } from './helpers/medium-session';
for (const width of [390, 1440]) test(`stock alerts retain item and place at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await mediumSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: '1 low-stock alert', exact: true }).click();
  await page.getByRole('menuitem', { name: /Milo Family/ }).click();
  await expect(page).toHaveURL('/reports?tab=low&item=target&place=shop');
  await expect(page.getByRole('tab', { name: 'Low stock (1)' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Selected stock alert' })).toContainText('Milo Family Tin 400g · Main shop');
  await expect(page.getByRole('link', { name: 'Receive stock', exact: true })).toHaveAttribute('href', '/movements?item=target&place=shop');
  await uiuxEvidence(page, 'ux08-scoped-alert');
  await page.getByRole('button', { name: 'View all low stock' }).click();
  await expect(page).toHaveURL('/reports?tab=low');
});

for (const width of [390, 1440]) test(`stock charts expose full identities and honest zeroes at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await mediumSession(page);
  await page.goto('/');
  const list = page.getByRole('list', { name: 'Stock held and movement details' });
  await expect(list).toContainText('Milo Family Tin 400g');
  await list.locator('summary').first().click();
  await expect(list.locator('details').first().locator('dl')).toContainText('Closing7 tin');
  await expect(page.locator('.health-metric')).toContainText('1 of 2stock lines above reorder level');
  expect(await page.locator('.chart-group').last().locator('.chart-bar.closing').evaluate(element => (element as HTMLElement).style.height)).toBe('0%');
  await uiuxEvidence(page, 'ux09-overview');
});

for (const width of [390, 1440]) test(`first-run guidance leads with the next task at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await mediumSession(page, true);
  await page.goto('/');
  await expect(page.locator('.owner-setup-next')).toHaveText('Create your first inventory item');
  await expect(page.locator('.owner-setup-card')).toBeInViewport();
  await expect(page.getByText('Box and quantity deals', { exact: true })).toHaveCount(0);
  await expect(page.locator('.health-panel')).toHaveText('Inventory healthStock health will appear after you add stock.');
  await expect(page.getByText('All levels look good', { exact: true })).toHaveCount(0);
  await expect(page.locator('.health-panel')).not.toContainText('0%');
  await uiuxEvidence(page, 'ux10-first-run');
});

for (const width of [390, 1440]) test(`top navigation and item tabs support keyboard at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await mediumSession(page);
  await page.goto('/items');
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toHaveCount(0);
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await skip.focus();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  if (width === 390) {
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.locator('.top-nav a').first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true }).first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
    await expect(page.locator('.nav-scrim')).toHaveCount(0);
  } else {
    for (const label of ['Finance', 'Profit', 'Reports']) await expect(page.locator('.top-nav').getByText(label, { exact: true })).toBeVisible();
  }
  await page.locator('.catalog-row').filter({ hasText: 'Milo Family' }).click();
  await page.getByRole('tab', { name: 'Stock', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Pricing', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Pricing', exact: true })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
  await uiuxEvidence(page, 'ux11-navigation-tabs');
});

for (const width of [390, 1440]) test(`receiving stock previews units, money and destination at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await mediumSession(page, false, 'inventory_manager');
  let saved: { quantity: number; unitCostCents: number; locationId: string } | undefined;
  await page.route('**/inventory/movements', route => { saved = route.request().postDataJSON(); return route.fulfill({ status: 201, json: {} }); });
  await page.goto('/movements?item=target&place=shop');
  await expect(page.getByRole('heading', { name: 'Receive stock', exact: true })).toBeVisible();
  await page.getByLabel('Quantity received (tin)', { exact: true }).fill('20');
  await page.getByLabel('Cost per tin (GHS)', { exact: true }).fill('1.50');
  await expect(page.getByRole('status', { name: 'Receipt preview' })).toContainText('20 tin × GH₵1.50 = GH₵30.00');
  await expect(page.getByRole('status', { name: 'Receipt preview' })).toContainText('Main shop: 7 → 27 tin');
  await expect(page.getByLabel('Reference', { exact: true })).toBeHidden();
  await uiuxEvidence(page, 'ux13-receive-stock');
  await page.getByRole('button', { name: 'Save receipt', exact: true }).click();
  await expect.poll(() => saved?.quantity).toBe(20);
  expect(saved?.unitCostCents).toBe(150); expect(saved?.locationId).toBe('shop');
});

test('purchase safeguards automatically expose required delivery details', async ({ page }) => {
  await mediumSession(page, false, 'inventory_manager', true);
  await page.goto('/movements?item=target&place=shop');
  await expect(page.getByLabel('Reference', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Reference', { exact: true })).toHaveAttribute('required', '');
});


test('compact navigation names appear on keyboard focus and tablet menus retain labels', async ({ page }) => {
  await mediumSession(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/items');
  const finance = page.locator('.top-nav').getByRole('link', { name: 'Finance', exact: true });
  await page.keyboard.press('Tab'); await finance.focus();
  await expect(finance.locator('span')).toHaveCSS('opacity', '1');
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(finance.locator('span')).toBeVisible();
  await expect(finance.locator('span')).toHaveCSS('position', 'static');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.nav-scrim')).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeFocused();
});

test('View all alerts opens low stock and transfer actions retain the destination', async ({ page }) => {
  const snapshot = await mediumSession(page);
  snapshot.positions = Array.from({ length: 7 }, (_, index) => ({ ...snapshot.positions[0], item: { ...snapshot.items[0], id: `item-${index}`, name: `Item ${index}` } }));
  await page.goto('/');
  await page.getByRole('button', { name: '7 low-stock alerts', exact: true }).click();
  await page.getByRole('menuitem', { name: 'View all 7 alerts' }).click();
  await expect(page).toHaveURL('/reports?tab=low');
  await expect(page.getByRole('tab', { name: 'Low stock (7)' })).toHaveAttribute('aria-selected', 'true');
  await page.goto('/movements?type=transfer&item=target&destination=shop');
  await expect(page.getByRole('combobox', { name: 'Movement type' })).toHaveText('Transfer');
  await expect(page.getByRole('combobox', { name: 'To', exact: true })).toHaveText('Main shop');
});
