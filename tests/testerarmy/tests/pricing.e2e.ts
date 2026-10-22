import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';
import { fixture, token, get } from '../fixture';
async function login(app, screen, role) {
  const user = credentials.user(role);
  await app.open('/login');
  await screen.getByLabel('Email address').fill(user.username);
  await screen.getByPlaceholder('Enter your password').fill(user.password);
  await screen.getByRole('button','Sign in').tap();
  await expect(screen.getByRole('link','Overview').first()).toBeVisible();
}
const quantities = [[2,'30.00'],[7,'91.00'],[10,'120.00'],[11,'135.00'],[15,'185.00'],[19,'237.00'],[20,'240.00'],[23,'285.00'],[25,'305.00']];

test('administrator saves a real configuration and previews all nine quantities without stock writes', async ({app,screen,agent,browser}) => {
  const auth = await token();
  const before = await get('/inventory/snapshot?days=30',auth);
  const configBefore = await get(`/inventory/items/${fixture.item}/pricing-preview`,auth);
  await login(app,screen,'admin');
  await agent.act('Navigate to the Items screen.');
  await expect(screen.getByRole('heading','Selling prices')).toBeVisible();
  await agent.act('Select {product} in the Pricing item dropdown.',{params:{product:'Live preview product'}});
  await expect(screen.getByLabel('Price for one box or carton')).toHaveValue('120.00');
  await agent.act('Save the currently displayed pricing without changing any values, using Save pricing. Stock units have already been confirmed for this product.');
  await expect.poll(async () => (await get(`/inventory/items/${fixture.item}/pricing-preview`,auth)).configuration.version).toBe(configBefore.configuration.version+1);
  await agent.act('Use Try a quantity to calculate the total for {quantity} pcs using the saved pricing.',{params:{quantity:'15'}});
  await expect(browser.locator('.pricing-quote-result')).toContainText('185.00');
  for (const [quantity,total] of quantities) {
    await screen.getByLabel('Test quantity').fill(String(quantity));
    await screen.getByRole('button','Calculate total').tap();
    await expect(browser.locator('.pricing-quote-result strong')).toContainText(String(total));
  }
  const after = await get('/inventory/snapshot?days=30',auth);
  expect(after.positions).toEqual(before.positions);
  expect(after.movements).toEqual(before.movements);
  expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('attendant agent records one sale at the unchanged retail price and deducts stock once', async ({app,screen,agent,browser}) => {
  const auth = await token('attendant');
  const before = await get('/inventory/snapshot?days=30',auth);
  const closing = before.positions.find(p => p.item.id===fixture.item).closing;
  await login(app,screen,'attendant');
  await app.open('/sell');
  await agent.act('Prepare a sale of {quantity} pcs of {product}. Select the item and enter the quantity. Leave it ready for review without submitting.',{params:{quantity:'5',product:'Live preview product'}});
  await expect(screen.getByLabel('Quantity')).toHaveValue('5');
  await expect(browser.locator('.sale-total')).toContainText('75.00');
  await agent.act('Submit the prepared sale exactly once using Sell.');
  await expect(screen.getByLabel('Quantity')).toHaveValue('');
  await expect.poll(async () => (await get('/inventory/snapshot?days=30',auth)).positions.find(p => p.item.id===fixture.item).closing).toBe(closing-5);
  const after = await get('/inventory/snapshot?days=30',auth);
  const oldIds = new Set(before.movements.map(m => m.id));
  const added = after.movements.filter(m => !oldIds.has(m.id));
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({type:'sale',quantity:5,unitPriceCents:1500,saleTotalCents:7500});
  expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
