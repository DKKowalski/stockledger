import { randomUUID } from 'node:crypto';
import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';
// Helpers enforce disposable localhost URLs and a generated test database.
import { auth, sample, request } from '../../e2e-live/remaining-fixture.mjs';
async function login(app: any, screen: any) {
  const user = credentials.user('admin');
  await app.open('/login');
  await screen.getByLabel('Email address').fill(user.username);
  await screen.getByPlaceholder('Enter your password').fill(user.password);
  await screen.getByRole('button', 'Sign in').tap();
  await expect(screen.getByRole('link', 'Overview').first()).toBeVisible();
  await app.open('/movements');
  await expect(screen.getByRole('combobox', 'Exact stock item')).toBeVisible();
}

test('admin agent returns original sale allocations without processing a payment', async ({
  app,
  screen,
  agent,
  browser,
}) => {
  if (process.env.STOCKLEDGER_TEST_REMAINING_PHASES !== '1')
    test.skip('Requires the disposable remaining-phases fixture');
  const admin = await auth(),
    suffix = randomUUID().slice(0, 8),
    name = `Return agent ${suffix}`,
    f = await sample(admin, name, { sold: true }),
    reference = `Agent return ${suffix}`;
  await login(app, screen);
  await agent.act(
    'In Customer returns choose original sale {sale}. For {product}, return quantity 1 and condition Can be resold. Set Return reference to {reference} and Return reason to Customer returned unused goods. Check that you checked the returned quantity and condition, and choose Review return. Stop before Confirm record.',
    { params: { sale: `Sale ${f.sale.id.slice(0, 8)}`, product: name, reference } },
  );
  await expect(browser.locator('.customer-returns-panel')).toContainText('1.84');
  expect((await request(`/inventory/items/${f.item.id}/exact-costing`, admin)).quantity).toBe(0);
  await agent.act(
    'In Customer returns, confirm this record once. Inspect Return recorded and the statement that the refund payment has not been processed, then choose Continue.',
  );
  const state = await request(`/inventory/items/${f.item.id}/exact-costing`, admin);
  expect(state).toMatchObject({ quantity: 1, valueCents: 101 });
  const sale = await request(`/inventory/sales/${f.sale.id}`, admin);
  expect(sale.cogsCents).toBe(302);
  expect(sale.totalCents).toBe(550);
  expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('admin agent transfers all three exact-cost units while preserving 302 cents', async ({
  app,
  screen,
  agent,
  browser,
}) => {
  if (process.env.STOCKLEDGER_TEST_REMAINING_PHASES !== '1')
    test.skip('Requires the disposable remaining-phases fixture');
  const admin = await auth(),
    suffix = randomUUID().slice(0, 8),
    name = `Transfer agent ${suffix}`,
    f = await sample(admin, name),
    warehouse = await request('/inventory/locations', admin, 'POST', {
      name: `Agent warehouse ${suffix}`,
      type: 'warehouse',
    }),
    reference = `Agent transfer ${suffix}`;
  await login(app, screen);
  await agent.act(
    'In Exact stock changes choose {product}. Transfer stock from E2E shop to {destination}, Change quantity 3, Stock change reference {reference}, Stock change reason Move to warehouse. Check that you checked the quantity and supporting records. Choose Review stock change. Stop before Confirm record.',
    { params: { product: name, destination: warehouse.name, reference } },
  );
  await expect(browser.locator('.exact-stock-panel')).toContainText('3.02');
  await agent.act(
    'In Exact stock changes, confirm this record once. Inspect Stock change recorded, then choose Continue.',
  );
  const state = await request(`/inventory/items/${f.item.id}/exact-costing`, admin);
  expect(state).toMatchObject({ quantity: 3, valueCents: 302 });
  expect(state.positions.find((p: any) => p.locationId === warehouse.id).quantity).toBe(3);
  expect(state.positions.find((p: any) => p.locationId === f.shop.id).quantity).toBe(0);
  expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
