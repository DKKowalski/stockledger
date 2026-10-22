// Independent live E2E regression runner. Run: node tests/e2e-live/pricing-preview.mjs
// Creates only disposable localhost resources; no .env files or existing databases are used.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import pg from 'pg';
import * as argon2 from 'argon2';
import { build as buildWeb, createServer, preview } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputName = process.env.E2E_LIVE_OUTPUT_NAME ?? 'live-pricing-agent';
assert.match(outputName, /^[a-z0-9-]+$/);
const output = resolve(root, 'test-results', outputName);
const temporary = await mkdtemp(resolve(tmpdir(), 'stockledger-e2e-'));
const runId = randomUUID().replaceAll('-', '');
const container = `stockledger-e2e-${runId}`;
const database = `stockledger_test_${runId}`;
const company = randomUUID();
const disabledCompany = randomUUID();
const shop = randomUUID();
const disabledShop = randomUUID();
const item = randomUUID();
const disabledItem = randomUUID();
const password = 'Isolated-E2E-only-2026!';
const outcomes = [];
const children = [];
let sql, browser, web, api, apiBase, webBase;
let containerCreated = false;
let databaseUrl;
const cleanEnv = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: temporary,
  NODE_ENV: 'test', DOTENV_CONFIG_PATH: '/dev/null',
  JWT_SECRET: 'isolated-live-browser-test-secret-at-least-32-characters',
  RESEND_API_KEY: '', SENTRY_DSN: '', EMAIL_FROM: '', DEMO_COMPANY_ID: '',
  PRICING_PREVIEW_COMPANY_IDS: company,
  COST_READINESS_COMPANY_IDS: company,
  SALE_RETURNS_COMPANY_IDS: process.env.E2E_LIVE_REMAINING_PHASES === '1' ? company : '',
  STOCK_OPERATIONS_COMPANY_IDS: process.env.E2E_LIVE_REMAINING_PHASES === '1' ? company : '',
  EXACT_COSTING_COMPANY_IDS: process.env.E2E_LIVE_EXACT_COSTING === '1' ? company : '',
};
// Empty optional UUIDs are invalid; leave this key absent.
delete cleanEnv.DEMO_COMPANY_ID;
await mkdir(output, { recursive: true });
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root, encoding: 'utf8', env: cleanEnv, ...options,
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if (await check()) return; } catch { /* retry startup */ }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function scenario(name, task) {
  try { await task(); outcomes.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) {
    outcomes.push({ name, passed: false, error: error.stack });
    console.error(`FAIL ${name}: ${error.stack}`);
  }
}
async function login(page, role = 'administrator', tenant = company) {
  await page.goto(`${webBase}/login`);
  await page.getByLabel('Email address', { exact: true }).fill(`${role}-${tenant}@example.invalid`);
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(password);
  const response = page.waitForResponse((r) => r.url() === `${apiBase}/auth/login` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const result = await response;
  assert.equal(result.status(), 200, 'Real sign-in must succeed');
  const session = await result.json();
  await expect(page.getByRole('link', { name: 'Overview', exact: true }).first()).toBeVisible();
  return session.accessToken;
}
async function http(path, token, method = 'GET', body) {
  const response = await fetch(`${apiBase}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function openPricing(page) {
  await page.locator('.catalog-row', { hasText: 'Live preview product' }).click();
  await page.getByRole('tab', { name: 'Pricing', exact: true }).click();
}
async function select(page, label, name) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}
const rules = { expectedVersion: 0, previewEnabled: true, baseUnit: 'pcs', baseUnitVerified: true,
  package: { label: 'box', size: 10, priceCents: 12000 }, bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1300 }] };
async function stockSnapshot() {
  return (await sql.query('SELECT row_to_json(s) AS row FROM location_stocks s ORDER BY id')).rows;
}
async function movementCount() { return (await sql.query('SELECT count(*)::int AS n FROM stock_movements')).rows[0].n; }
let admin, adminContext, adminToken, attendantToken;
try {
  run('docker', ['run', '--detach', '--rm', '--name', container,
    '--tmpfs', '/var/lib/postgresql/data:rw', '-p', '127.0.0.1::5432',
    '-e', 'POSTGRES_USER=stockledger', '-e', 'POSTGRES_PASSWORD=stockledger',
    '-e', `POSTGRES_DB=${database}`, 'postgres:17-alpine']);
  containerCreated = true;
  const published = run('docker', ['port', container, '5432/tcp']).trim();
  assert.match(published, /^127\.0\.0\.1:\d+$/);
  const adminUrl = `postgresql://stockledger:stockledger@${published}/${database}`;
  sql = new pg.Client({ connectionString: adminUrl });
  await waitFor(async () => {
    const probe = new pg.Client({ connectionString: adminUrl });
    try { await probe.connect(); await probe.end(); return true; } catch { await probe.end(); return false; }
  }, 'disposable PostgreSQL');
  await sql.connect();
  Object.assign(cleanEnv, { DATABASE_URL: adminUrl, DIRECT_DATABASE_URL: adminUrl });
  const migrationLog = run('npm', ['exec', '--', 'prisma', 'db', 'migrate', '--quiet'], { cwd: resolve(root, 'apps/api') });
  await writeFile(resolve(output, 'migration.log'), migrationLog);
  const migrationResult = migrationLog.trim().split('\n').filter((s) => s.startsWith('{')).map((s) => JSON.parse(s)).find((s) => s.kind === 'result');
  assert.equal(migrationResult?.envelope?.ok, true, migrationLog);
  // Exercise the real API using the restricted runtime role and RLS, never the database owner.
  await sql.query("ALTER ROLE stockledger_app LOGIN PASSWORD 'isolated-runtime-password'");
  databaseUrl = `postgresql://stockledger_app:isolated-runtime-password@${published}/${database}`;
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  for (const [tenant, location, product] of [[company, shop, item], [disabledCompany, disabledShop, disabledItem]]) {
    await sql.query("INSERT INTO companies(id,name,business_type,inventory_source,onboarding_completed_at,updated_at) VALUES ($1,'E2E synthetic business','mixed','paper',now(),now())", [tenant]);
    await sql.query("INSERT INTO locations(id,company_id,name,type,updated_at) VALUES ($1,$2,'E2E shop','shop',now())", [location, tenant]);
    await sql.query('UPDATE companies SET default_location_id=$1 WHERE id=$2', [location, tenant]);
    for (const role of ['administrator', 'shop_attendant', 'inventory_manager']) {
      await sql.query('INSERT INTO users(id,company_id,location_id,full_name,email,password_hash,role,email_verified_at,invitation_accepted_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now(),now())',
        [randomUUID(), tenant, role === 'shop_attendant' ? location : null, `E2E ${role}`, `${role}-${tenant}@example.invalid`, hash, role]);
    }
    await sql.query("INSERT INTO inventory_items(id,company_id,sku,name,category,unit,unit_cost_cents,selling_price_cents,updated_at) VALUES ($1,$2,'LIVE-E2E','Live preview product','Test','pcs',1000,1500,now())", [product, tenant]);
    await sql.query('INSERT INTO location_stocks(id,company_id,item_id,location_id,opening_stock,updated_at) VALUES ($1,$2,$3,$4,30,now())', [randomUUID(), tenant, product, location]);
  }
  const build = run('npm', ['run', 'api:build']);
  await writeFile(resolve(output, 'build.log'), build);
  // Empty envDir prevents the build/preview from reading project .env files.
  const { createServer: createNetServer } = await import('node:net');
  const reservation = createNetServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const apiPort = reservation.address().port; await new Promise((done) => reservation.close(done));
  apiBase = `http://127.0.0.1:${apiPort}`;
  const webConfig = { configFile: false, root: resolve(root, 'apps/web'), envDir: temporary,
    plugins: [react()], define: { 'import.meta.env.VITE_API_URL': JSON.stringify(apiBase) } };
  if (process.env.E2E_LIVE_STATIC_WEB === '1') {
    // Rehearse the deployed bundle; no development WebSocket can reload an unfinished form.
    const buildConfig = { ...webConfig, build: { outDir: resolve(temporary, 'web-dist'), emptyOutDir: true } };
    await buildWeb(buildConfig);
    web = await preview({ ...buildConfig, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  } else {
    web = await createServer({ ...webConfig, server: { host: '127.0.0.1', port: 0, strictPort: true } });
    await web.listen();
  }
  webBase = `http://127.0.0.1:${web.httpServer.address().port}`;
  if (process.env.E2E_LIVE_STATIC_WEB === '1') assert.equal((await (await fetch(webBase)).text()).includes('/@vite/client'), false);
  const startApi = async (completionEnabled = false) => {
    if (api && api.exitCode === null && api.signalCode === null) {
      const exited = once(api, 'exit'); api.kill('SIGTERM');
      await Promise.race([exited, delay(5000)]);
      if (api.exitCode === null && api.signalCode === null) {
        console.log('Disposable API exceeded the five-second shutdown budget; terminating only this test child.');
        api.kill('SIGKILL'); await exited;
      }
    }
    api = spawn(process.execPath, [resolve(root, 'apps/api/dist/main.js')], {
      cwd: temporary, env: { ...cleanEnv, DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: databaseUrl,
        SALE_COMPLETION_COMPANY_IDS: completionEnabled ? company : '', PORT: String(apiPort), WEB_ORIGIN: webBase }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(api);
    const apiLog = createWriteStream(resolve(output, 'api.log'), { flags: 'a' });
    api.stdout.pipe(apiLog); api.stderr.pipe(apiLog);
    await waitFor(async () => (await fetch(`${apiBase}/health/ready`)).ok, 'real API readiness');
  };
  await startApi();
  await writeFile(resolve(output, 'local-fixture.json'), JSON.stringify({
    webBase, apiBase, company, item, container, database, webMode: process.env.E2E_LIVE_STATIC_WEB === '1' ? 'static-production-build' : 'development',
    administrator: { email: `administrator-${company}@example.invalid`, password },
    attendant: { email: `shop_attendant-${company}@example.invalid`, password },
  }, null, 2), { mode: 0o600 });
  console.log(`Live fixture ready: ${webBase}; details in ${output}/local-fixture.json`);
  browser = await chromium.launch({ headless: true });
  adminContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  adminContext.setDefaultTimeout(15_000);
  await adminContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
  admin = await adminContext.newPage();
  adminToken = await login(admin);
  const baselineStock = await stockSnapshot();
  await scenario('Desktop administrator configures optional package/bulk pricing through real API and RLS', async () => {
    await admin.goto(`${webBase}/items`);
    await openPricing(admin);
    const panel = admin.locator('.pricing-preview-panel');
    await select(admin, 'Pricing option', 'Box and quantity discounts');
    await panel.getByLabel('Offer a box or carton price').check();
    await panel.getByLabel('pcs per box').fill('10');
    await panel.getByLabel('Price for one box or carton', { exact: true }).fill('120');
    await panel.getByRole('button', { name: 'Add quantity discount' }).click();
    await panel.getByLabel('Discount minimum 1').fill('5');
    await panel.getByLabel('Discount price 1').fill('13');
    await expect(panel.getByRole('button', { name: 'Calculate total' })).toBeDisabled();
    await panel.getByLabel('My stock is counted in pcs.').check();
    const saved = admin.waitForResponse((r) => r.url().endsWith(`/items/${item}/pricing-preview`) && r.request().method() === 'PATCH');
    await panel.getByRole('button', { name: 'Save pricing' }).click();
    const response = await saved; assert.equal(response.status(), 200, await response.text());
    await expect(panel.getByRole('button', { name: 'Calculate total' })).toBeEnabled();
    const history = (await sql.query('SELECT version,base_unit,package_size,package_price_cents,bulk_tiers FROM item_pricing_versions WHERE company_id=$1', [company])).rows;
    assert.deepEqual(history, [{ version: 1, base_unit: 'pcs', package_size: 10, package_price_cents: 12000, bulk_tiers: rules.bulkTiers }]);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM audit_events WHERE company_id=$1 AND action='inventory.pricing_preview_saved'", [company])).rows[0].n, 1);
  });
  await scenario('Nine quantity examples and package input use live authoritative quotes without stock writes', async () => {
    const panel = admin.locator('.pricing-preview-panel');
    for (const [quantity, total] of [[2, 3000], [7, 9100], [10, 12000], [11, 13500], [15, 18500], [19, 23700], [20, 24000], [23, 28500], [25, 30500]]) {
      await panel.getByLabel('Test quantity', { exact: true }).fill(String(quantity));
      const pending = admin.waitForResponse((r) => r.url().endsWith('/pricing-preview/quote'));
      await panel.getByRole('button', { name: 'Calculate total' }).click();
      const response = await pending; assert.equal(response.status(), 201, await response.text());
      const quote = await response.json();
      assert.equal(quote.totalCents, total); assert.equal(quote.previewOnly, true); assert.equal(quote.canComplete, false);
      assert.equal(quote.lines[0].quantity, quantity);
      assert.equal(quote.lines[0].components.reduce((sum, p) => sum + p.quantity * p.unitPriceCents, 0), total);
      await expect(panel.locator('.pricing-quote-result')).toContainText((total / 100).toFixed(2));
    }
    await select(admin, 'Test quantity unit', 'box');
    await panel.getByLabel('Test quantity', { exact: true }).fill('2');
    const pending = admin.waitForResponse((r) => r.url().endsWith('/pricing-preview/quote'));
    await panel.getByRole('button', { name: 'Calculate total' }).click();
    const quote = await (await pending).json(); assert.equal(quote.lines[0].quantity, 20); assert.equal(quote.totalCents, 24000);
    assert.deepEqual(await stockSnapshot(), baselineStock); assert.equal(await movementCount(), 0);
    await panel.screenshot({ path: resolve(output, 'desktop-pricing.png'), animations:'disabled', timeout:30000 });
  });
  await scenario('Real saved rules survive reload; mobile has no page overflow and labelled preview controls', async () => {
    await admin.reload();
    await openPricing(admin);
    const panel = admin.locator('.pricing-preview-panel');
    await expect(panel.getByLabel('pcs per box')).toHaveValue('10');
    await expect(panel.getByLabel('Discount price 1')).toHaveValue('13.00');
    await admin.setViewportSize({ width: 390, height: 844 });
    await panel.getByLabel('Test quantity', { exact: true }).fill('15');
    await panel.getByRole('button', { name: 'Calculate total' }).click();
    await expect(panel.locator('.pricing-quote-result')).toContainText('185.00');
    assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const unlabelled = await panel.locator('input, [role="combobox"], button').evaluateAll((nodes) => nodes.filter((n) => {
      if (n.getAttribute('aria-hidden') === 'true' || n.closest('[hidden], [aria-hidden="true"]')) return false;
      if (n.tagName === 'INPUT') return !n.labels?.length && !n.getAttribute('aria-label') && !n.getAttribute('aria-labelledby');
      return !n.textContent?.trim() && !n.getAttribute('aria-label') && !n.getAttribute('aria-labelledby');
    }).map((n) => n.outerHTML));
    assert.deepEqual(unlabelled, []);
    await panel.getByLabel('Test quantity', { exact: true }).focus();
    await admin.keyboard.press('Tab');
    await expect(panel.getByRole('combobox', { name: 'Test quantity unit' })).toBeFocused();
    await panel.scrollIntoViewIfNeeded();
    await admin.screenshot({ path: resolve(output, 'mobile-pricing.png'), fullPage: true });
  });
  // The cost review screen is hidden in the app for now; its API stays covered by integration tests.
  if (process.env.E2E_LIVE_COST_REVIEW_UI === '1') await scenario('Administrator reviews the current cost without changing stock, prices or recorded sales', async () => {
    const before = (await sql.query('SELECT row_to_json(i) AS row FROM inventory_items i WHERE company_id=$1', [company])).rows;
    const beforeStocks = await stockSnapshot();
    const beforeMovements = await movementCount();
    await select(admin, 'Cost review item', 'Live preview product');
    const panel = admin.locator('.cost-review-panel');
    await expect(panel.getByRole('status')).toContainText('has not been reviewed');
    await select(admin, 'Records checked', 'Opening stock records');
    await panel.getByLabel('Record reference', { exact: true }).fill('Synthetic opening fixture: 30 pcs at GHS 10');
    await panel.getByRole('button', { name: 'Confirm current cost', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('confirmed by an administrator');
    await expect(panel).toContainText('Synthetic opening fixture');
    assert.deepEqual((await sql.query('SELECT row_to_json(i) AS row FROM inventory_items i WHERE company_id=$1', [company])).rows, before);
    assert.deepEqual(await stockSnapshot(), beforeStocks);
    assert.equal(await movementCount(), beforeMovements);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM audit_events WHERE company_id=$1 AND action='inventory.cost_reviewed'", [company])).rows[0].n, 1);
    await admin.reload();
    await select(admin, 'Cost review item', 'Live preview product');
    await expect(panel.getByRole('status')).toContainText('confirmed by an administrator');
    await panel.screenshot({ path: resolve(output, 'mobile-cost-review.png') });
    await admin.setViewportSize({ width: 1440, height: 1100 });
    await panel.screenshot({ path: resolve(output, 'desktop-cost-review.png') });
    await openPricing(admin);
  });
  await scenario('Concurrent configuration changes reject stale browser preview and recover by explicit reload', async () => {
    const panel = admin.locator('.pricing-preview-panel');
    // The preceding cost-review reload starts a fresh async pricing read.
    // Wait until that read has settled before making its version deliberately stale.
    await expect(panel.getByLabel('Discount price 1')).toHaveValue('13.00');
    const saved = await http(`/inventory/items/${item}/pricing-preview`, adminToken, 'PATCH', { ...rules, expectedVersion: 1 });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    await panel.getByLabel('Test quantity', { exact: true }).fill('15');
    await panel.getByRole('button', { name: 'Calculate total' }).click();
    await expect(panel.getByRole('alert')).toContainText('changed');
    assert.equal(await movementCount(), 0);
    await panel.getByRole('button', { name: 'Reload prices' }).click();
    await panel.getByRole('button', { name: 'Calculate total' }).click();
    await expect(panel.locator('.pricing-quote-result')).toContainText('185.00');
    const attempts = await Promise.all([1, 2].map(() => http(`/inventory/items/${item}/pricing-preview`, adminToken, 'PATCH', { ...rules, expectedVersion: 2 })));
    assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 409]);
    assert.deepEqual((await sql.query('SELECT version FROM item_pricing_versions WHERE company_id=$1 ORDER BY version', [company])).rows.map((r) => r.version), [1, 2, 3]);
  });
  await scenario('Malformed, manipulated, stale and cross-tenant requests cannot mutate inventory or configuration', async () => {
    const before = await stockSnapshot(); const versions = (await sql.query('SELECT count(*)::int AS n FROM item_pricing_versions')).rows[0].n;
    assert.equal((await http('/inventory/pricing-preview')).status, 401);
    for (const line of [{ itemId: item, quantity: 1.5 }, { itemId: item, quantity: -1 }, { itemId: item, quantity: 0 },
      { itemId: item, quantity: 2147483648 }, { itemId: item, quantity: 2, totalCents: 1 },
      { itemId: item, quantity: 2, manualDiscountCents: 500 }]) {
      assert.equal((await http('/inventory/pricing-preview/quote', adminToken, 'POST', { lines: [line] })).status, 400);
    }
    assert.equal((await http('/inventory/pricing-preview/quote', adminToken, 'POST', { lines: [{ itemId: item, quantity: 2, expectedVersion: 1 }] })).status, 409);
    assert.equal((await http(`/inventory/items/${item}/pricing-preview`, adminToken, 'PATCH', { ...rules, expectedVersion: 3, package: { ...rules.package, priceCents: '12000' } })).status, 400);
    assert.equal((await http(`/inventory/items/${disabledItem}/pricing-preview`, adminToken)).status, 404);
    assert.equal((await http('/inventory/pricing-preview/quote', adminToken, 'POST', { lines: [{ itemId: disabledItem, quantity: 2 }] })).status, 404);
    assert.equal((await sql.query('SELECT count(*)::int AS n FROM item_pricing_versions')).rows[0].n, versions);
    assert.deepEqual(await stockSnapshot(), before); assert.equal(await movementCount(), 0);
  });
  await scenario('Attendant and manager cannot configure pricing; non-allowlisted tenant sees no controls and keeps retail', async () => {
    for (const role of ['shop_attendant', 'inventory_manager']) {
      const context = await browser.newContext(); const page = await context.newPage();
      const token = await login(page, role); if (role === 'shop_attendant') attendantToken = token;
      await page.goto(`${webBase}/items`);
      await expect(page.getByRole('heading', { name: 'Box and quantity pricing', exact: true })).toHaveCount(0);
      assert.equal((await http(`/inventory/items/${item}/pricing-preview`, token, 'PATCH', { ...rules, expectedVersion: 3 })).status, 403);
      assert.equal((await http(`/inventory/items/${item}/pricing-preview`, token)).status, 403);
      const quoted = await http('/inventory/pricing-preview/quote', token, 'POST', { lines: [{ itemId: item, quantity: 15 }] });
      assert.equal(quoted.status, 201); assert.equal(quoted.body.totalCents, 18500);
      assert.equal(JSON.stringify(quoted.body).includes('unitCostCents'), false);
      await context.close();
    }
    const context = await browser.newContext(); const page = await context.newPage();
    const token = await login(page, 'administrator', disabledCompany);
    await page.goto(`${webBase}/items`);
    await page.locator('.catalog-row').first().click();
    await page.getByRole('tab', { name: 'Pricing', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Box and quantity pricing is off', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Box and quantity pricing', exact: true })).toHaveCount(0);
    assert.equal((await http(`/inventory/items/${disabledItem}/pricing-preview`, token, 'PATCH', rules)).status, 403);
    const quote = await http('/inventory/pricing-preview/quote', token, 'POST', { lines: [{ itemId: disabledItem, quantity: 15 }] });
    assert.equal(quote.body.totalCents, 22500);
    await context.close();
  });
  await scenario('Actual attendant browser sale retains retail price, deducts stock once and preserves profit', async () => {
    const context = await browser.newContext(); const page = await context.newPage();
    attendantToken = await login(page, 'shop_attendant');
    await page.goto(`${webBase}/sell`);
    await select(page, 'Item', 'Live preview product');
    await page.getByLabel('Quantity', { exact: true }).fill('7');
    const pending = page.waitForResponse((r) => r.url().endsWith('/inventory/movements') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sell', exact: true }).click();
    const response = await pending; assert.equal(response.status(), 201, await response.text());
    const sale = await response.json(); assert.equal(sale.unitPriceCents, 1500); assert.equal(sale.quantity, 7);
    await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('');
    assert.equal(await movementCount(), 1);
    const snapshot = await http('/inventory/snapshot', attendantToken);
    assert.equal(snapshot.body.positions.find((p) => p.item.id === item).closing, 23);
    const profit = await http(`/inventory/profitability?itemId=${item}`, adminToken);
    assert.equal(profit.status, 200);
    assert.equal(profit.body.summary.netSalesCents, 10500); assert.equal(profit.body.summary.cogsCents, 7000); assert.equal(profit.body.summary.grossProfitCents, 3500);
    await context.close();
  });
  await scenario('Committed real sale plus failed refresh clears form and retry does not resubmit payment/stock write', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await context.newPage();
    await login(page, 'shop_attendant'); await page.goto(`${webBase}/sell`);
    await select(page, 'Item', 'Live preview product'); await page.getByLabel('Quantity', { exact: true }).fill('2');
    let failRefresh = false; let writes = 0;
    page.on('request', (request) => { if (request.url().endsWith('/inventory/movements') && request.method() === 'POST') writes++; });
    // The write reaches Nest/PostgreSQL. Only its following GET snapshot response is fault-injected.
    await page.route('**/inventory/snapshot**', (route) => failRefresh ? route.fulfill({ status: 503, json: { message: 'Injected refresh failure' } }) : route.continue());
    failRefresh = true;
    const pending = page.waitForResponse((r) => r.url().endsWith('/inventory/movements') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sell', exact: true }).click();
    const response = await pending; assert.equal(response.status(), 201, await response.text());
    await expect(page.getByRole('alert')).toContainText('Your change was saved');
    await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Sell', exact: true })).toBeDisabled();
    await page.screenshot({ path: resolve(output, 'mobile-saved-refresh-failure.png'), fullPage: true });
    assert.equal(writes, 1); assert.equal(await movementCount(), 2);
    failRefresh = false; await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    assert.equal(writes, 1); assert.equal(await movementCount(), 2);
    const snapshot = await http('/inventory/snapshot', attendantToken);
    assert.equal(snapshot.body.positions.find((p) => p.item.id === item).closing, 21);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await context.close();
  });
  if (process.env.E2E_LIVE_SALE_COMPLETION === '1') {
    await startApi(true);
    let recoveredRequest;
    await scenario('Development checkout survives a committed sale with lost response and browser reload', async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(); await login(page, 'shop_attendant'); await page.goto(`${webBase}/sell`);
      await expect(page.getByRole('button', { name: 'Review sale', exact: true })).toBeVisible();
      await select(page, 'Item', 'Live preview product'); await page.getByLabel('Quantity', { exact: true }).fill('15');
      await page.getByRole('button', { name: 'Review sale', exact: true }).click();
      await expect(page.locator('.checkout-pay dd')).toContainText('185.00');
      let posts = 0;
      await page.route('**/inventory/sales/complete', async (route) => {
        posts++; recoveredRequest = route.request().postDataJSON();
        const response = await route.fetch(); assert.equal(response.status(), 201);
        await route.abort('failed'); // The real API/database committed; only delivery is lost.
      });
      await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Confirm pending sale' })).toBeVisible();
      await expect(page.getByRole('alert')).toBeVisible();
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM sales')).rows[0].n, 1);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Check sale status', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Check sale status', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Sale recorded' })).toContainText('185.00');
      assert.equal(posts, 1); assert.equal(await movementCount(), 4);
      assert.equal((await http('/inventory/snapshot', attendantToken)).body.positions.find((p) => p.item.id === item).closing, 6);
      assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('stockledger:sale-request:')).length), 0);
      await page.screenshot({ path: resolve(output, 'desktop-sale-recovered.png'), fullPage: true }); await context.close();
    });
    await scenario('Mobile development checkout records once and clears its key after committed sale plus refresh failure', async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage(); await login(page, 'shop_attendant'); await page.goto(`${webBase}/sell`);
      await expect(page.getByRole('button', { name: 'Review sale', exact: true })).toBeVisible();
      await select(page, 'Item', 'Live preview product'); await page.getByLabel('Quantity', { exact: true }).fill('5');
      await page.getByRole('button', { name: 'Review sale', exact: true }).click();
      await expect(page.locator('.checkout-pay dd')).toContainText('65.00');
      let writes = 0; page.on('request', (r) => { if (r.url().endsWith('/inventory/sales/complete') && r.method() === 'POST') writes++; });
      await page.route('**/inventory/snapshot**', (route) => route.fulfill({ status: 503, json: { message: 'Injected post-commit refresh failure' } }));
      await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Your change was saved');
      assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('stockledger:sale-request:')).length), 0);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM sales')).rows[0].n, 2);
      assert.equal(await movementCount(), 5); assert.equal(writes, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: resolve(output, 'mobile-sale-refresh-failure.png'), fullPage: true });
      await page.unroute('**/inventory/snapshot**'); await page.reload();
      await expect(page.getByRole('button', { name: 'Review sale', exact: true })).toBeVisible();
      assert.equal(writes, 1); await context.close();
    });
    await scenario('An uncommitted lost request retries with the original key and disabled writer still serves committed recovery', async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage(); await login(page, 'shop_attendant'); await page.goto(`${webBase}/sell`);
      await expect(page.getByRole('button', { name: 'Review sale', exact: true })).toBeVisible();
      await select(page, 'Item', 'Live preview product'); await page.getByLabel('Quantity', { exact: true }).fill('1');
      await page.getByRole('button', { name: 'Review sale', exact: true }).click(); await expect(page.locator('.checkout-pay dd')).toContainText('15.00');
      const keys = [];
      await page.route('**/inventory/sales/complete', async (route) => { keys.push(route.request().postDataJSON().idempotencyKey); if (keys.length === 1) await route.abort('failed'); else await route.continue(); });
      await page.getByRole('button', { name: 'Complete sale', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
      await page.getByRole('button', { name: 'Check sale status', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'No completed sale' })).toBeVisible();
      await page.getByRole('button', { name: 'Retry same sale', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Sale recorded' })).toContainText('15.00');
      assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert.equal(await movementCount(), 6);
      await startApi(false);
      const replay = await http('/inventory/sales/complete', attendantToken, 'POST', recoveredRequest); assert.equal(replay.status, 201); assert.equal(replay.body.totalCents, 18500);
      assert.equal((await http('/inventory/snapshot', attendantToken)).body.positions.find((p) => p.item.id === item).closing, 0);
      assert.equal((await http('/inventory/sale-completion', attendantToken)).body.available, false);
      assert.equal(await movementCount(), 6); await context.close();
    });
    if (process.env.E2E_LIVE_HOLD === '1') {
      // Fresh synthetic stock for the separate TesterArmy run, added through the normal audited purchase path.
      const purchased = await http('/inventory/movements', adminToken, 'POST', { itemId: item, locationId: shop, type: 'purchase', quantity: 30, unitCostCents: 1000, movementDate: new Date().toISOString().slice(0, 10) });
      assert.equal(purchased.status, 201); await startApi(true);
    }
  }
  if (process.env.E2E_LIVE_BROWSER_REGRESSIONS === '1') {
    await scenario('Existing browser regressions and synchronized cross-tab coordination pass on localhost', async () => {
      cleanEnv.DEMO_COMPANY_ID = '31000000-0000-4000-8000-000000000001';
      await writeFile(resolve(output, 'demo-seed.log'), run('node', [resolve(root, 'apps/api/dist/prisma/seed.js')]));
      await startApi(false);
      const configFile = resolve(temporary, 'browser.config.mjs');
      await writeFile(configFile, `export default ${JSON.stringify({ testDir: resolve(root, 'tests/e2e'), workers: 1, retries: 0, reporter: 'list', outputDir: resolve(output, 'browser-results'), use: { baseURL: webBase, trace: 'retain-on-failure', screenshot: 'only-on-failure' }, projects: [{ name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } }] })};`);
      const regressionLog = createWriteStream(resolve(output, 'browser-regressions.log'));
      const child = spawn('npm', ['exec', '--', 'playwright', 'test', '--config', configFile], { cwd: root, env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      child.stdout.on('data', (chunk) => regressionLog.write(chunk)); child.stderr.on('data', (chunk) => regressionLog.write(chunk));
      const [code] = await once(child, 'close'); regressionLog.end();
      assert.equal(code, 0, 'Browser regressions failed; inspect browser-regressions.log');
      if (process.env.E2E_LIVE_HOLD === '1' && process.env.E2E_LIVE_SALE_COMPLETION === '1') await startApi(true);
    });
  }
  await adminContext.tracing.stop({ path: resolve(output, 'admin-trace.zip') });
  if (process.env.E2E_LIVE_EXACT_COSTING === '1') {
    await scenario('Exact costs: real admin enrollment and receipt recovery; attendant full sale preserves 302 cents', async () => {
      const exactItem = randomUUID();
      await sql.query("INSERT INTO inventory_items(id,company_id,sku,name,category,unit,unit_cost_cents,selling_price_cents,updated_at) VALUES ($1,$2,'EXACT-LIVE','Exact costs live product','Test','pcs',100,200,now())",[exactItem,company]);
      await sql.query('INSERT INTO location_stocks(id,company_id,item_id,location_id,opening_stock,updated_at) VALUES ($1,$2,$3,$4,0,now())',[randomUUID(),company,exactItem,shop]);
      const refreshed=admin.waitForResponse(r=>r.url().endsWith('/auth/refresh')&&r.status()===200);
      await admin.reload();
      adminToken=(await (await refreshed).json()).accessToken;
      await admin.goto(`${webBase}/items`);
      await select(admin,'Exact cost item','Exact costs live product');
      const panel=admin.locator('.exact-cost-panel');
      await panel.getByLabel('Verified total stock value (GHS)',{exact:true}).fill('0.00');
      await panel.getByLabel('Cost record reference',{exact:true}).fill('Verified empty opening TEST-EXACT');
      await panel.getByLabel('I checked the quantity and value against the referenced records.').check();
      await panel.getByRole('button',{name:'Review cost record',exact:true}).click();
      await expect(panel.getByRole('button',{name:'Confirm cost record',exact:true})).toBeVisible();
      await panel.getByRole('button',{name:'Confirm cost record',exact:true}).click();
      await expect(panel.getByRole('status')).toHaveText('Cost record saved.');
      await panel.getByRole('button',{name:'Continue',exact:true}).click();
      await panel.getByLabel('Purchase quantity',{exact:true}).fill('1');
      await panel.getByLabel('Unit purchase cost (GHS)',{exact:true}).fill('1.00');
      await panel.getByLabel('Cost record reference',{exact:true}).fill('Receipt EXACT-1');
      await panel.getByLabel('I checked the quantity and value against the referenced records.').check();
      await panel.getByRole('button',{name:'Review cost record',exact:true}).click();
      // Simulate a successful commit whose response never reaches the admin browser.
      await admin.route('**/inventory/exact-costing/requests/*/apply',async route=>{const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');},{times:1});
      await panel.getByRole('button',{name:'Confirm cost record',exact:true}).click();
      await expect(panel.getByRole('alert')).toBeVisible();
      const stored=await admin.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('stockledger:exact-cost-request:')));
      assert.equal(stored.length,1);assert.match(stored[0][1],/^[a-f0-9-]{36}$/);
      await admin.reload();await expect(panel.getByRole('status')).toHaveText('Cost record saved.');
      await panel.getByRole('button',{name:'Continue',exact:true}).click();
      await select(admin,'Exact cost item','Exact costs live product');
      await panel.getByLabel('Purchase quantity',{exact:true}).fill('2');
      await panel.getByLabel('Unit purchase cost (GHS)',{exact:true}).fill('1.01');
      await panel.getByLabel('Cost record reference',{exact:true}).fill('Receipt EXACT-2');
      await panel.getByLabel('I checked the quantity and value against the referenced records.').check();
      await panel.getByRole('button',{name:'Review cost record',exact:true}).click();
      await panel.getByRole('button',{name:'Confirm cost record',exact:true}).click();
      await expect(panel.getByRole('status')).toHaveText('Cost record saved.');
      await panel.getByRole('button',{name:'Continue',exact:true}).click();
      await expect(panel).toContainText('GH₵3.02');
      await panel.screenshot({path:resolve(output,'exact-cost-desktop.png')});
      await admin.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();
      assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await panel.screenshot({path:resolve(output,'exact-cost-mobile.png')});
      await admin.setViewportSize({width:1440,height:1100});
      const state=await http(`/inventory/items/${exactItem}/exact-costing`,adminToken);assert.equal(state.body.valueCents,302);assert.equal(state.body.quantity,3);
      const configured=await http(`/inventory/items/${exactItem}/pricing-preview`,adminToken,'PATCH',{...rules,package:{label:'box',size:3,priceCents:550},bulkTiers:[]});assert.equal(configured.status,200);
      const quote=await http('/inventory/sales/quote',attendantToken,'POST',{movementDate:new Date().toISOString().slice(0,10),lines:[{itemId:exactItem,quantity:3,expectedVersion:1,expectedRetailPriceCents:200}]});assert.equal(quote.status,201,JSON.stringify(quote.body));
      const sale=await http('/inventory/sales/complete',attendantToken,'POST',{idempotencyKey:randomUUID(),quoteToken:quote.body.quoteToken});assert.equal(sale.status,201,JSON.stringify(sale.body));
      const allocated=await sql.query("SELECT sum(quantity)::int quantity,sum(quantity*unit_cost_cents)::int cost,sum(quantity*unit_price_cents)::int revenue FROM stock_movements WHERE item_id=$1 AND type='sale'",[exactItem]);
      assert.deepEqual(allocated.rows[0],{quantity:3,cost:302,revenue:550});
      const after=await http(`/inventory/items/${exactItem}/exact-costing`,adminToken);assert.equal(after.body.valueCents,0);assert.equal(after.body.quantity,0);
      const csv=await fetch(`${apiBase}/settings/exports/inventory`,{headers:{Authorization:`Bearer ${adminToken}`}});assert.equal(csv.status,200);
      const archive=await http('/settings/exports/workspace-v4',adminToken);assert.equal(archive.status,200);assert.ok(JSON.stringify(archive.body).includes(state.body.checkpoint.id));
      await writeFile(resolve(output,'exact-cost-proof.json'),JSON.stringify({opening:state.body,allocated:allocated.rows[0],remaining:after.body,saleId:sale.body.id},null,2));
    });
  }
  const persisted = (await sql.query('SELECT type,quantity,unit_price_cents,unit_cost_cents FROM stock_movements WHERE company_id=$1 ORDER BY created_at', [company])).rows;
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify({
    syntheticCompany: company, allowlistedCompanies: [company], apiRuntimeRole: 'stockledger_app (NOSUPERUSER, NOBYPASSRLS)',
    browser: await browser.version(), webBase, apiBase, databaseHost: published,
    pricingVersions: (await sql.query('SELECT version,base_unit,package_size,package_price_cents FROM item_pricing_versions ORDER BY version')).rows,
    persistedMovements: persisted, outcomes,
  }, null, 2));
} catch (error) {
  outcomes.push({ name: 'Harness/setup', passed: false, error: error.stack }); console.error(error);
} finally {
  if (process.env.E2E_LIVE_HOLD === '1' && browser) {
    const holdFile = resolve(output, 'hold-open');
    await writeFile(holdFile, 'Remove this file after the additional TesterArmy run is complete.\n');
    console.log(`Keeping disposable fixture live for additional TesterArmy testing; remove ${holdFile} to release.`);
    const { access } = await import('node:fs/promises');
    for (let n = 0; n < 1800; n++) {
      try { await access(holdFile); } catch { break; }
      await delay(1000);
    }
  }
  if (browser) await browser.close();
  if (web) await web.close();
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), delay(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  }
  if (sql) await sql.end();
  if (containerCreated) run('docker', ['stop', '--time', '5', container]);
  await rm(temporary, { recursive: true, force: true });
  await rm(resolve(output, 'local-fixture.json'), { force: true });
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ outcomes, cleanup: { serversStopped: true, temporaryDirectoryRemoved: true, disposableContainerRemoved: containerCreated } }, null, 2));
}
console.log(`${outcomes.filter((r) => r.passed).length}/${outcomes.length} live E2E scenarios passed. Artifacts: ${output}`);
if (outcomes.some((r) => !r.passed)) process.exitCode = 1;
