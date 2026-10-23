import { expect, test, type Page } from '@playwright/test';

async function signIntoDemo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Preview as owner' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('You are viewing a read-only demo.')).toBeVisible();
}

async function navigateInApp(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
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
  const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === '/settings' && response.request().method() === 'GET');
  await signIntoDemo(page);
  const settings = await (await loaded).json() as Record<string, unknown>;
  await page.goto('/account');

  await page.getByLabel('Full name').fill('Changed demo name');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('alert')).toContainText('This demo is read-only');

  // Saving inventory settings sends only inventory fields (the API rejects any others).
  let sent: Record<string, unknown> = {};
  await page.route('**/settings/inventory', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    sent = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { ...settings, ...sent } });
  });
  await page.goto('/settings/inventory');
  await page.getByText('Box and quantity deals', { exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeHidden();
  expect(Object.keys(sent).sort()).toEqual(['allowNegativeStock', 'defaultLocationId', 'defaultReorderLevel', 'defaultUnit', 'hybridPricingEnabled', 'nextSkuNumber', 'requireAdjustmentReason', 'requirePurchaseSource', 'skuPrefix']);
  expect(sent.hybridPricingEnabled).toBe(!settings.hybridPricingEnabled);

  // Retyping an item that exists points to a top-up instead of creating a second item.
  // In-app navigation keeps the demo session from refreshing on every page.
  await navigateInApp(page, '/items');
  const existing = (await page.locator('.catalog-row:not(:has(.is-archived)) .catalog-name b').first().textContent())!;
  await page.getByRole('button', { name: /^Add item/ }).click();
  await expect(page.getByRole('combobox', { name: 'Category' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(` ${existing.toUpperCase()} `);
  await expect(page.getByText(`You already have ${existing}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: `Add stock to ${existing}` }).click();
  await expect(page).toHaveURL(/\/movements\?item=/);
  await expect(page.getByRole('combobox', { name: 'Item', exact: true })).toContainText(existing);

  // Appearance is a device choice kept in this browser.
  await navigateInApp(page, '/account');
  await page.getByText('One colour', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-cards', 'single');
  expect(await page.evaluate(() => localStorage.getItem('stockledger.appearance.v1'))).toBe('{"accent":"violet","cards":"single"}');
});

test('contains wide data tables within the mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIntoDemo(page);

  for (const path of ['/movements', '/team']) {
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

test('fits the item catalog and item panel within the mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIntoDemo(page);
  await page.evaluate(() => {
    window.history.pushState({}, '', '/items');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('.catalog-row').first()).toBeVisible();
  await page.locator('.catalog-row').nth(1).click();
  await expect(page.locator('.item-panel')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('previews the demo as the Makola shop attendant', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Preview as shop attendant' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('You are viewing a read-only demo.')).toBeVisible();
  await expect(page.getByText('Joyce Baidoo').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deals are on' })).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByRole('heading', { name: 'Deals are on' })).toBeHidden();
});

test('walks the owner through box and quantity deals once', async ({ page }) => {
  await signIntoDemo(page);
  await page.getByRole('button', { name: 'Show me' }).click();
  const guide = page.getByRole('dialog');
  await expect(page).toHaveURL('/settings/inventory');
  await expect(guide.getByRole('heading', { name: 'Turn deals on' })).toBeVisible();
  await expect(page.locator('[data-tour="deals-switch"]')).toHaveClass(/tour-highlight/);
  await guide.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('[data-tour="item-pricing"]')).toHaveClass(/tour-highlight/);
  await guide.getByRole('button', { name: 'Next' }).click();
  await expect(guide.getByText('Customer pays')).toBeVisible();
  await guide.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL('/profitability');
  await guide.getByRole('button', { name: 'Done' }).click();
  await expect(guide).toBeHidden();
  await page.goto('/');
  await expect(page.getByText('Closing stock')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show me' })).toBeHidden();
});
