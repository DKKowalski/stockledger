import { expect, test, type Page } from '@playwright/test';

async function signIntoDemo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Preview the demo workspace' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('You are viewing a read-only demo.')).toBeVisible();
}

test('publishes the privacy notice and terms without requiring an account', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy notice' })).toBeVisible();
  await expect(page.getByText('We do not sell personal information.')).toBeVisible();

  await page.getByRole('link', { name: 'Back home' }).click();
  await page.getByRole('link', { name: 'Terms' }).click();
  await expect(page.getByRole('heading', { name: 'Terms of use' })).toBeVisible();
});

test('opens the seeded demo and restores its secure session after reload', async ({ page }) => {
  await signIntoDemo(page);
  await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();

  await page.reload();
  await expect(page.getByText('You are viewing a read-only demo.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
});

test('rejects changes made from the public demo', async ({ page }) => {
  await signIntoDemo(page);
  await page.goto('/account');

  await page.getByLabel('Full name').fill('Changed demo name');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('alert')).toContainText('This demo is read-only');
});
