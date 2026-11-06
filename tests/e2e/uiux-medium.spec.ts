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
