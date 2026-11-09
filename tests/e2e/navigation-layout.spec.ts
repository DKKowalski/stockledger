import { expect, test, type Page } from '@playwright/test';

// Evidence screenshots are only written when SHOT_DIR is set (manual review runs).
const shots = process.env.SHOT_DIR;
async function shot(page: Page, name: string) { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); }

test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.3.${testInfo.line % 250}` });
});

async function signIn(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Preview as owner' }).click();
  await expect(page).toHaveURL('/');
}

async function chooseLayout(page: Page, layout: 'Header' | 'Sidebar') {
  await page.locator('header').getByRole('button', { name: 'Open account menu' }).or(page.locator('[data-slot="sidebar"]').getByRole('button', { name: 'Open account menu' })).and(page.locator(':visible')).click();
  await page.getByRole('menuitemradio', { name: layout }).click();
  await page.keyboard.press('Escape');
}

test('header layout is the default and shows icon + label tabs with an active indicator', async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Overview' }).locator('svg')).toBeVisible();
  await expect(page.locator('[data-slot="sidebar"]')).toBeHidden();
  await shot(page, 'nav-header-1280');
  // Overflowing items live in "More" instead of wrapping or scrolling.
  await page.setViewportSize({ width: 900, height: 800 });
  const more = nav.getByRole('button', { name: 'More' });
  await expect(more).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await more.click();
  await page.getByRole('menuitem', { name: 'Team' }).click();
  await expect(page).toHaveURL(/\/team$/);
  await expect(nav.getByRole('button', { name: /More/ })).toBeVisible();
});

test('switches to the sidebar, collapses, expands and remembers both choices after reload', async ({ page }) => {
  await signIn(page);
  await chooseLayout(page, 'Sidebar');
  const sidebar = page.locator('[data-slot="sidebar"]');
  const nav = sidebar.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible();
  await expect(page.locator('header.topbar')).toBeHidden();
  for (const name of ['Overview', 'Sell', 'Items', 'Movements', 'Reports', 'Profit', 'Finance', 'Banking', 'Places', 'Team']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await shot(page, 'nav-sidebar-1280');

  const collapse = sidebar.getByRole('button', { name: 'Collapse sidebar' });
  await collapse.click();
  await expect(sidebar.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar.locator('[data-state="collapsed"]').or(sidebar)).toHaveAttribute('data-state', 'collapsed');
  await nav.getByRole('link', { name: 'Finance' }).hover();
  await expect(page.locator('[data-slot="tooltip-content"]', { hasText: 'Finance' })).toBeVisible();
  await shot(page, 'nav-sidebar-collapsed-1280');

  await page.reload();
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');
  await page.keyboard.press('Control+b');
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded');
  await page.reload();
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded');
  await expect(page.locator('[data-slot="sidebar"]').getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

  await page.locator('[data-slot="sidebar"]').getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Banking', exact: true }).click();
  await expect(page).toHaveURL(/\/banking$/);
  await expect(page.locator('[data-slot="sidebar"]').getByRole('link', { name: 'Banking' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#main-content')).toBeVisible();

  // Back to the header layout from the sidebar account menu.
  await chooseLayout(page, 'Header');
  await expect(page.locator('header.topbar')).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Finance', exact: true }).click();
  await expect(page).toHaveURL(/\/finance$/);
  await page.reload();
  await expect(page.locator('header.topbar')).toBeVisible();
  await expect(page.locator('[data-slot="sidebar"]')).toBeHidden();
});

for (const layout of ['Header', 'Sidebar'] as const) test(`mobile ${layout} layout uses a top bar and a sheet at 375px`, async ({ page }) => {
  await signIn(page, 1280);
  if (layout === 'Sidebar') await chooseLayout(page, 'Sidebar');
  await page.setViewportSize({ width: 375, height: 700 });
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(open).toBeVisible();
  const box = await open.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('[data-slot="sidebar"]')).toBeHidden();
  await open.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Overview' })).toBeFocused();
  if (layout === 'Header') await shot(page, 'nav-mobile-375');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await open.click();
  await page.getByRole('dialog').getByRole('link', { name: 'Banking', exact: true }).click();
  await expect(page).toHaveURL(/\/banking$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeFocused();
});
