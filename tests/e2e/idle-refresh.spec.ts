import { expect, test, type Page } from '@playwright/test';

async function prepared(page: Page, beforeRefresh: () => Promise<void> = async () => {}) {
  let now = Date.parse('2026-11-06T10:00:00Z');
  let refreshes = 0, settingsReads = 0, inventoryReads = 0, unavailable = false, reuseToken = false;
  let lastToken = '';
  const companyId = '31000000-0000-4000-8000-000000000097';
  const shop = { id: '32000000-0000-4000-8000-000000000097', name: 'Idle shop', type: 'shop' };
  const item = { id: '51000000-0000-4000-8000-000000000097', name: 'Idle product', sku: 'IDLE', category: 'Test', unit: 'pcs', isActive: true, sellingPriceCents: 175, unitCostCents: 100, reorderLevel: 0 };
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript(() => {
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { get: () => visibility });
    (window as unknown as { setVisibility: (value: string) => void }).setVisibility = value => { visibility = value; document.dispatchEvent(new Event('visibilitychange')); };
  });
  await page.route('**/auth/refresh', async route => {
    refreshes++;
    await beforeRefresh();
    if (unavailable) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + 900, version: refreshes })).toString('base64url');
    const token = reuseToken ? lastToken : `test.${payload}.signature`;
    lastToken = token;
    return route.fulfill({ json: { accessToken: token, user: { id: '41000000-0000-4000-8000-000000000097', companyId, locationId: shop.id, fullName: 'Attendant', email: 'idle@example.invalid', role: 'shop_attendant', isActive: true } } });
  });
  await page.route('**/settings', route => { settingsReads++; return route.fulfill({ json: { id: companyId, name: 'Idle test', currency: 'GHS', timeZone: 'Africa/Accra', itemTerm: 'item', shopTerm: 'shop', warehouseTerm: 'warehouse' } }); });
  await page.route('**/inventory/snapshot**', route => { inventoryReads++; return route.fulfill({ json: { items: [item], locations: [shop], positions: [{ item, location: shop, closing: 20 }], movements: [], periodMovements: [], summary: {} } }); });
  await page.route('**/inventory/sale-completion', route => route.fulfill({ json: { available: false } }));
  await page.goto('/sell');
  await page.getByRole('combobox', { name: 'Item', exact: true }).click();
  await page.getByRole('option', { name: item.name, exact: true }).click();
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  // Let the dropdown's closing animation and its pointer events finish before
  // simulating a long unattended interval.
  await page.mouse.move(0, 0);
  await page.clock.runFor(100);
  const advance = async (milliseconds: number) => { now += milliseconds; await page.clock.fastForward(milliseconds); };
  const activity = () => page.evaluate(() => window.dispatchEvent(new Event('pointerdown')));
  const visible = (value: string) => page.evaluate(value => (window as unknown as { setVisibility: (value: string) => void }).setVisibility(value), value);
  const initial = { refreshes, settingsReads, inventoryReads };
  return { initial, advance, activity, visible, reuseToken: () => { reuseToken = true; }, failRefresh: (value: boolean) => { unavailable = value; }, counts: () => ({ refreshes, settingsReads, inventoryReads }) };
}

test('an idle tab pauses refresh and refreshes once on return without losing the sale draft', async ({ page }) => {
  const app = await prepared(page);
  await app.advance(14 * 60_000);
  expect(app.counts()).toEqual(app.initial);
  await expect(page.getByRole('status').filter({ hasText: 'Updates paused' })).toBeVisible();
  await app.activity();
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); });
  await expect.poll(app.counts).toEqual({ refreshes: app.initial.refreshes + 1, settingsReads: app.initial.settingsReads + 1, inventoryReads: app.initial.inventoryReads + 1 });
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
});

test('a hidden tab makes no refresh requests and resumes once when visible', async ({ page }) => {
  const app = await prepared(page);
  await app.visible('hidden');
  await app.advance(60 * 60_000);
  expect(app.counts()).toEqual(app.initial);
  await app.visible('visible');
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); });
  await expect.poll(app.counts).toEqual({ refreshes: app.initial.refreshes + 1, settingsReads: app.initial.settingsReads + 1, inventoryReads: app.initial.inventoryReads + 1 });
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
});

test('failed return refresh clearly blocks stale data until an explicit successful retry', async ({ page }) => {
  const app = await prepared(page);
  await app.visible('hidden');
  await app.advance(60 * 60_000);
  app.failRefresh(true);
  await app.visible('visible');
  await expect(page.getByRole('alert').filter({ hasText: 'could not refresh' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry refresh', exact: true })).toBeVisible();
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  expect(app.counts()).toEqual({ ...app.initial, refreshes: app.initial.refreshes + 1 });
  await app.activity();
  expect(app.counts().refreshes).toBe(2);
  app.failRefresh(false);
  await page.getByRole('button', { name: 'Retry refresh', exact: true }).click();
  await expect.poll(app.counts).toEqual({ refreshes: app.initial.refreshes + 2, settingsReads: app.initial.settingsReads + 1, inventoryReads: app.initial.inventoryReads + 1 });
  await expect(page.getByRole('alert').filter({ hasText: 'could not refresh' })).toHaveCount(0);
});

test('recent activity keeps the normal token refresh working', async ({ page }) => {
  const app = await prepared(page);
  for (let index = 0; index < 3; index++) { await app.advance(4 * 60_000); await app.activity(); }
  await app.advance(2 * 60_000);
  await expect.poll(() => app.counts().refreshes).toBe(app.initial.refreshes + 1);
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
});


test('returning refreshes workspace data even when the new access token equals the old one', async ({ page }) => {
  const app = await prepared(page);
  app.reuseToken();
  await app.visible('hidden');
  await app.visible('visible');
  await expect.poll(app.counts).toEqual({ refreshes: app.initial.refreshes + 1, settingsReads: app.initial.settingsReads + 1, inventoryReads: app.initial.inventoryReads + 1 });
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  await app.advance(14 * 60_000);
  await expect(page.getByRole('status').filter({ hasText: 'Updates paused' })).toBeVisible();
  expect(app.counts().refreshes).toBe(2);
});

test('a refresh finishing after the tab hides does not reload workspace data until return', async ({ page }) => {
  let gate: Promise<void> = Promise.resolve(), release!: () => void;
  const app = await prepared(page, () => gate);
  gate = new Promise<void>(resolve => { release = resolve; });
  await app.visible('hidden');
  await app.visible('visible');
  await expect.poll(() => app.counts().refreshes).toBe(2);
  await app.visible('hidden');
  const response = page.waitForResponse('**/auth/refresh');
  release();
  await (await response).finished();
  await expect.poll(async () => (await page.evaluate(() => navigator.locks.query())).held?.filter(lock => lock.name === 'stockledger:session').length).toBe(0);
  await expect(page.getByRole('status').filter({ hasText: 'Updates paused' })).toBeVisible();
  expect(app.counts()).toEqual({ ...app.initial, refreshes: app.initial.refreshes + 1 });
  await app.visible('visible');
  await expect.poll(app.counts).toEqual({ refreshes: app.initial.refreshes + 2, settingsReads: app.initial.settingsReads + 1, inventoryReads: app.initial.inventoryReads + 1 });
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
});

test('simultaneously returning tabs serialize rotating-cookie refresh requests', async ({ context }) => {
  let concurrent = 0, maximumConcurrent = 0;
  const beforeRefresh = async () => {
    concurrent++; maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    await new Promise(resolve => setTimeout(resolve, 50));
    concurrent--;
  };
  const first = await context.newPage(), second = await context.newPage();
  const a = await prepared(first, beforeRefresh), b = await prepared(second, beforeRefresh);
  await Promise.all([a.visible('hidden'), b.visible('hidden')]);
  await Promise.all([a.visible('visible'), b.visible('visible')]);
  await expect.poll(a.counts).toEqual({ refreshes: a.initial.refreshes + 1, settingsReads: a.initial.settingsReads + 1, inventoryReads: a.initial.inventoryReads + 1 });
  await expect.poll(b.counts).toEqual({ refreshes: b.initial.refreshes + 1, settingsReads: b.initial.settingsReads + 1, inventoryReads: b.initial.inventoryReads + 1 });
  expect(maximumConcurrent).toBe(1);
  await expect(first.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  await expect(second.getByLabel('Quantity', { exact: true })).toHaveValue('2');
});

test('signing out in another tab prevents an in-flight refresh from restoring the session', async ({ context }) => {
  let gate: Promise<void> = Promise.resolve(), release!: () => void;
  const first = await context.newPage(), second = await context.newPage();
  const a = await prepared(first), b = await prepared(second, () => gate);
  let logouts = 0;
  await context.route('**/auth/logout', route => { logouts++; return route.fulfill({ json: { signedOut: true } }); });
  gate = new Promise<void>(resolve => { release = resolve; });
  await b.visible('hidden');
  await b.visible('visible');
  await expect.poll(() => b.counts().refreshes).toBe(2);
  await first.getByRole('button', { name: 'Open account menu' }).click();
  await first.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(first.getByRole('link', { name: 'Sign in', exact: true }).first()).toBeVisible();
  await expect(second.getByRole('link', { name: 'Sign in', exact: true }).first()).toBeVisible();
  release();
  await expect.poll(() => logouts).toBe(1);
  await b.activity();
  await b.advance(60 * 60_000);
  expect(b.counts()).toEqual({ ...b.initial, refreshes: 2 });
  expect(a.counts()).toEqual(a.initial);
  await expect(second.getByRole('link', { name: 'Sign in', exact: true }).first()).toBeVisible();
});

test('a tab hidden while waiting for the session lock skips its queued refresh', async ({ context }) => {
  let gate: Promise<void> = Promise.resolve(), release!: () => void;
  const first = await context.newPage(), second = await context.newPage();
  const a = await prepared(first, () => gate), b = await prepared(second);
  gate = new Promise<void>(resolve => { release = resolve; });
  await a.visible('hidden');
  await b.visible('hidden');
  await a.visible('visible');
  await expect.poll(() => a.counts().refreshes).toBe(a.initial.refreshes + 1);
  await b.visible('visible');
  await expect.poll(async () => (await second.evaluate(() => navigator.locks.query())).pending?.filter(lock => lock.name === 'stockledger:session').length).toBe(1);
  await b.visible('hidden');
  release();
  await expect.poll(a.counts).toEqual({ refreshes: a.initial.refreshes + 1, settingsReads: a.initial.settingsReads + 1, inventoryReads: a.initial.inventoryReads + 1 });
  await expect.poll(async () => (await second.evaluate(() => navigator.locks.query())).held?.filter(lock => lock.name === 'stockledger:session').length).toBe(0);
  expect(b.counts()).toEqual(b.initial);
  await b.visible('visible');
  await expect.poll(b.counts).toEqual({ refreshes: b.initial.refreshes + 1, settingsReads: b.initial.settingsReads + 1, inventoryReads: b.initial.inventoryReads + 1 });
});

test('sign-out remains available when return refresh fails', async ({ page }) => {
  const app = await prepared(page);
  await page.route('**/auth/logout', route => route.fulfill({ json: { signedOut: true } }));
  app.failRefresh(true);
  await app.visible('hidden');
  await app.visible('visible');
  await expect(page.getByRole('alert').filter({ hasText: 'could not refresh' })).toBeVisible();
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true }).first()).toBeVisible();
});
