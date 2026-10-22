// Explicit synthetic development setup only. Does not reset or enroll existing items.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
if (process.env.STOCKLEDGER_LOCAL_TEST_SETUP !== '1') throw Error('Explicit local test setup flag required');
const file = readFileSync('/tmp/stockledger-hybrid-test-fixture', 'utf8').trim(),
  f = JSON.parse(readFileSync(file));
const base = 'http://localhost:3000';
let token;
async function request(path, method = 'GET', body, auth = token) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.ok(r.ok, `${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
for (let n = 0; n < 30; n++) {
  try {
    if ((await fetch(`${base}/health/ready`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
const session = await request('/auth/login', 'POST', { email: f.accounts.admin, password: f.password });
assert.equal(session.user.companyId, f.ids.company);
token = session.accessToken;
assert.equal((await request('/inventory/stock-operations')).available, true);
assert.equal((await request('/inventory/sale-returns')).available, true);
if (f.phase5Ready) {
  console.log('Existing local samples retained.');
  process.exit(0);
}
assert.equal(
  (await request('/inventory/snapshot')).items.some((i) => ['RETURN-TEST', 'STOCK-OPS-TEST'].includes(i.sku)),
  false,
  'Inspect existing sample before repeating setup',
);
f.phase5Operations = [];
const save = () => writeFileSync(file, JSON.stringify(f, null, 2), { mode: 0o600 });
async function sample(name, sku) {
  const item = await request('/inventory/items', 'POST', {
    name,
    sku,
    category: 'Test',
    unit: 'pcs',
    unitCostCents: 100,
    sellingPriceCents: 200,
    openingStock: 0,
    locationId: f.ids.shop,
    reorderLevel: 0,
  });
  f.ids[sku === 'RETURN-TEST' ? 'returnItem' : 'stockOperationsItem'] = item.id;
  save();
  const operation = async (kind, extra) => {
    const c = await request(`/inventory/items/${item.id}/exact-costing`),
      key = crypto.randomUUID(),
      input = {
        kind,
        itemId: item.id,
        expectedItemUpdatedAt: c.item.updatedAt,
        expectedUnit: 'pcs',
        expectedCurrency: 'GHS',
        expectedQuantity: c.quantity,
        expectedSequence: c.sequence,
        reference: `Synthetic ${name}`,
        confirmed: true,
        freeStockConfirmed: false,
        ...extra,
      };
    f.phase5Operations.push({ key, input });
    save();
    await request('/inventory/exact-costing/requests', 'POST', { requestKey: key, input });
    await request(`/inventory/exact-costing/requests/${key}/apply`, 'POST');
  };
  await operation('checkpoint', { valueCents: 0, costReviewId: null });
  for (const [quantity, unitCostCents] of [
    [1, 100],
    [2, 101],
  ])
    await operation('receipt', {
      quantity,
      unitCostCents,
      locationId: f.ids.shop,
      movementDate: '2026-10-21',
      supplierId: null,
    });
  return item;
}
const item = await sample('Returns test item', 'RETURN-TEST');
await sample('Stock operations test item', 'STOCK-OPS-TEST');
await request(`/inventory/items/${item.id}/pricing-preview`, 'PATCH', {
  expectedVersion: 0,
  baseUnit: 'pcs',
  baseUnitVerified: true,
  previewEnabled: true,
  package: { label: 'box', size: 3, priceCents: 550 },
  bulkTiers: [],
});
const attendant = (
    await request('/auth/login', 'POST', { email: f.accounts.attendant, password: f.password })
  ).accessToken,
  quote = await request(
    '/inventory/sales/quote',
    'POST',
    {
      movementDate: '2026-10-21',
      lines: [{ itemId: item.id, quantity: 3, expectedVersion: 1, expectedRetailPriceCents: 200 }],
    },
    attendant,
  ),
  key = crypto.randomUUID();
f.phase5SaleRequest = { key, quoteToken: quote.quoteToken };
save();
const sale = await request(
  '/inventory/sales/complete',
  'POST',
  { idempotencyKey: key, quoteToken: quote.quoteToken },
  attendant,
);
f.ids.returnSampleSale = sale.id;
f.phase5Ready = true;
save();
console.log(
  JSON.stringify({
    returnItem: item.name,
    originalSaleReference: `Sale ${sale.id.slice(0, 8)}`,
    stockItem: 'Stock operations test item',
    localSyntheticOnly: true,
  }),
);
