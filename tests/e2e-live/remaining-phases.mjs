import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { fixture, auth, request, sample } from './remaining-fixture.mjs';
const output = new URL('../../test-results/phase5-final/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }),
  results = [];
async function select(page, label, name) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}
async function login(page) {
  await page.goto(`${fixture.webBase}/login`);
  await page.getByLabel('Email address', { exact: true }).fill(fixture.administrator.email);
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(fixture.administrator.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Overview', exact: true }).first()).toBeVisible();
  await page.goto(`${fixture.webBase}/movements`);
}
try {
  for (const width of [1440, 390]) {
    const admin = await auth(),
      name = `Return browser ${width} ${randomUUID().slice(0, 6)}`,
      f = await sample(admin, name, { sold: true });
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' }),
      page = await context.newPage();
    await login(page);
    const returns = page.locator('.customer-returns-panel');
    await select(page, 'Return original sale', `Sale ${f.sale.id.slice(0, 8)} · 2026-10-21`);
    await returns.getByLabel(`Return quantity — ${name}`, { exact: true }).fill('1');
    await returns.getByLabel('Return reference', { exact: true }).fill(`Browser return ${width}`);
    await returns.getByLabel('Return reason', { exact: true }).fill('Unused goods returned');
    await returns.getByLabel('I checked the returned quantity and condition.').check();
    await returns.getByRole('button', { name: 'Review return', exact: true }).click();
    await expect(returns).toContainText('1.84');
    await page.route(
      '**/inventory/sale-returns/requests/*/apply',
      async (route) => {
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        await route.abort('failed');
      },
      { times: 1 },
    );
    await returns.getByRole('button', { name: 'Confirm record', exact: true }).click();
    await expect(returns.getByRole('alert')).toBeVisible();
    const stored = await page.evaluate(() =>
      Object.entries(localStorage).filter(([k]) => k.startsWith('stockledger:return-request:')),
    );
    assert.equal(stored.length, 1);
    assert.match(stored[0][1], /^[a-f0-9-]{36}$/);
    await page.reload();
    await expect(returns.getByRole('status')).toContainText('Return recorded');
    await expect(returns).toContainText('not been processed');
    await returns.getByRole('button', { name: 'Continue', exact: true }).click();
    let state = await request(`/inventory/items/${f.item.id}/exact-costing`, admin);
    assert.equal(state.quantity, 1);
    assert.equal(state.valueCents, 101);
    await select(page, 'Return original sale', `Sale ${f.sale.id.slice(0, 8)} · 2026-10-21`);
    await select(page, 'Return action', 'Reverse remaining sale');
    await select(page, `Return condition ${name}`, 'Damaged — do not restock');
    await returns.getByLabel('Return reference', { exact: true }).fill('Damaged remainder');
    await returns.getByLabel('Return reason', { exact: true }).fill('Remaining goods damaged');
    await returns.getByLabel('I checked the returned quantity and condition.').check();
    await returns.getByRole('button', { name: 'Review return', exact: true }).click();
    await expect(returns).toContainText('3.66');
    await returns.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -80));
    await returns.screenshot({
      path: new URL(`return-review-${width}.png`, output).pathname,
      animations: 'disabled',
    });
    await returns.getByRole('button', { name: 'Confirm record', exact: true }).click();
    await expect(returns.getByRole('status')).toContainText('Return recorded');
    await returns.getByRole('button', { name: 'Continue', exact: true }).click();
    state = await request(`/inventory/items/${f.item.id}/exact-costing`, admin);
    assert.equal(state.quantity, 1);
    assert.equal(state.valueCents, 101);
    const profit = await request(`/inventory/profitability?itemId=${f.item.id}`, admin);
    assert.equal(profit.summary.netSalesCents, 0);
    assert.equal(profit.summary.cogsCents, 0);
    assert.equal(profit.summary.inventoryLossCents, 201);
    const stock = await sample(admin, `Stock browser ${width} ${randomUUID().slice(0, 6)}`),
      warehouse = await request('/inventory/locations', admin, 'POST', {
        name: `QA warehouse ${width} ${randomUUID().slice(0, 4)}`,
        type: 'warehouse',
      });
    await page.reload();
    const panel = page.locator('.exact-stock-panel');
    await select(page, 'Exact stock item', stock.item.name);
    await select(page, 'Exact stock destination', warehouse.name);
    await panel.getByLabel('Change quantity', { exact: true }).fill('3');
    await panel.getByLabel('Stock change reference', { exact: true }).fill('Transfer all stock');
    await panel.getByLabel('Stock change reason', { exact: true }).fill('Move to warehouse');
    await panel.getByLabel('I checked the quantity and supporting records.').check();
    await panel.getByRole('button', { name: 'Review stock change', exact: true }).click();
    await expect(panel).toContainText('3.02');
    await panel.screenshot({
      path: new URL(`stock-review-${width}.png`, output).pathname,
      animations: 'disabled',
    });
    await panel.getByRole('button', { name: 'Confirm record', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText('Stock change recorded.');
    await panel.getByRole('button', { name: 'Continue', exact: true }).click();
    state = await request(`/inventory/items/${stock.item.id}/exact-costing`, admin);
    assert.equal(state.valueCents, 302);
    assert.equal(state.positions.find((p) => p.locationId === warehouse.id).quantity, 3);
    await select(page, 'Exact stock change', 'Record a stock count');
    await select(page, 'Exact stock place', `${warehouse.name} · 3 pcs`);
    await panel.getByLabel('Counted quantity', { exact: true }).fill('1');
    await panel.getByLabel('Stock change reference', { exact: true }).fill('Count shortage');
    await panel.getByLabel('Stock change reason', { exact: true }).fill('Two units missing at count');
    await panel.getByLabel('I checked the quantity and supporting records.').check();
    await panel.getByRole('button', { name: 'Review stock change', exact: true }).click();
    await expect(panel).toContainText('1.01');
    await panel.getByRole('button', { name: 'Confirm record', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText('Stock change recorded.');
    state = await request(`/inventory/items/${stock.item.id}/exact-costing`, admin);
    assert.equal(state.quantity, 1);
    assert.equal(state.valueCents, 101);
    const countHistory = await request('/inventory/stock-counts', admin);
    assert.equal(countHistory.find((count) => count.itemId === stock.item.id).valueImpactCents, -201);
    await page.goto(`${fixture.webBase}/stock-counts`);
    const countRow = page.getByRole('row').filter({ hasText: stock.item.name });
    await expect(countRow).toContainText('2.01');
    await countRow.screenshot({
      path: new URL(`count-history-${width}.png`, output).pathname,
      animations: 'disabled',
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();
    results.push({
      width,
      returnRefundCents: 184,
      reversalRefundCents: 366,
      damagedLossCents: 201,
      returnRemainingQuantity: 1,
      returnRemainingValueCents: 101,
      transferValueCents: 302,
      countRemainingQuantity: 1,
      countRemainingValueCents: 101,
    });
    console.log(`PASS original returns, damaged reversal, exact transfer and count at ${width}`);
  }
} finally {
  await browser.close();
  await writeFile(new URL('browser-proof.json', output), JSON.stringify(results, null, 2));
}
assert.equal(results.length, 2);
