import { expect, test, type Page } from '@playwright/test';

async function signIntoDemo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Preview the demo workspace' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('You are viewing a read-only demo.')).toBeVisible();
}

test('opens the login page from the public landing page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in', exact: true }).first().click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('resends verification from the signup confirmation', async ({ page }) => {
  let resentEmail = '';
  await page.route('**/auth/register', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ verificationRequired: true, email: 'ama@example.com' }),
  }));
  await page.route('**/auth/email/resend', async (route) => {
    resentEmail = (await route.request().postDataJSON() as { email: string }).email;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sent: true }) });
  });

  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Your name').fill('Ama Mensah');
  await page.getByLabel('Business name').fill('Mensah Trading');
  await page.getByLabel('Work email').fill('ama@example.com');
  await page.getByPlaceholder('At least 8 characters').fill('StockLedger123!');
  await page.getByRole('button', { name: 'Continue to setup' }).click();

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByRole('button', { name: 'Send another link' }).click();
  await expect(page.getByRole('status')).toContainText('a fresh link is on the way');
  expect(resentEmail).toBe('ama@example.com');
});

test('requests a fresh link from an invalid verification page', async ({ page }) => {
  let resentEmail = '';
  await page.route('**/auth/email/verify', (route) => route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'This verification link is invalid or has expired' }),
  }));
  await page.route('**/auth/email/resend', async (route) => {
    resentEmail = (await route.request().postDataJSON() as { email: string }).email;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sent: true }) });
  });

  await page.goto('/verify-email?token=expired', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Link not accepted' })).toBeVisible();
  await page.getByLabel('Email address').fill('ama@example.com');
  await page.getByRole('button', { name: 'Send another link' }).click();

  await expect(page.getByRole('status')).toContainText('a fresh link is on the way');
  expect(resentEmail).toBe('ama@example.com');
});

test('submits a generated password-reset token with unambiguous password fields', async ({ page }) => {
  const token = '31000000-0000-4000-8000-000000000001.' + 'a'.repeat(64);
  let submittedToken = '';
  await page.route('**/auth/password/reset', async (route) => {
    submittedToken = (await route.request().postDataJSON() as { token: string }).token;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ changed: true }) });
  });

  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel('New password', { exact: true }).fill('FreshPassword123!');
  await page.getByLabel('Confirm new password', { exact: true }).fill('FreshPassword123!');
  await page.getByRole('button', { name: 'Set new password' }).click();

  await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
  expect(submittedToken).toBe(token);
});

test('publishes the privacy notice and terms without requiring an account', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy notice' })).toBeVisible();
  await expect(page.getByText('We do not sell personal information.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'sewunakpandana5@gmail.com' })).toHaveAttribute('href', 'mailto:sewunakpandana5@gmail.com');

  await page.getByRole('link', { name: 'Back home' }).click();
  await page.getByRole('link', { name: 'Terms' }).click();
  await expect(page.getByRole('heading', { name: 'Terms of use' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'sewunakpandana5@gmail.com' })).toHaveAttribute('href', 'mailto:sewunakpandana5@gmail.com');
});

test('opens the seeded demo and restores its secure session after reload', async ({ page }) => {
  await signIntoDemo(page);
  await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();

  await page.reload();
  await expect(page.getByText('You are viewing a read-only demo.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
});

test('leaves the demo session to create a workspace', async ({ page }) => {
  await signIntoDemo(page);

  await page.getByRole('link', { name: 'Create a workspace' }).click();

  await expect(page).toHaveURL('/signup');
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
});

test('allows the signup route while the demo session is still authenticated', async ({ page }) => {
  await signIntoDemo(page);

  await page.goto('/signup');

  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
});

test('rejects changes made from the public demo', async ({ page }) => {
  await signIntoDemo(page);
  await page.goto('/account');

  await page.getByLabel('Full name').fill('Changed demo name');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('alert')).toContainText('This demo is read-only');
});

test('contains wide data tables within the mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIntoDemo(page);

  for (const path of ['/items', '/movements', '/team']) {
    await page.evaluate((nextPath) => {
      window.history.pushState({}, '', nextPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    await expect(page).toHaveURL(path);
    await expect(page.locator('.table-wrap').first()).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      hasScrollableTable: [...document.querySelectorAll<HTMLElement>('.table-wrap')]
        .some((table) => table.scrollWidth > table.clientWidth),
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
    expect(dimensions.hasScrollableTable).toBe(true);
  }
});
