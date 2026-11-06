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
