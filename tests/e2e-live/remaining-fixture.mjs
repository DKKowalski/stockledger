import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
export const fixture = JSON.parse(readFileSync(process.env.STOCKLEDGER_TEST_FIXTURE, 'utf8'));
for (const key of ['webBase', 'apiBase'])
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(fixture[key]).hostname));
assert.match(fixture.database, /^stockledger_test_[a-f0-9]+$/);
export async function request(path, token, method = 'GET', body) {
  const r = await fetch(`${fixture.apiBase}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.ok(r.ok, `${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
const sessions = new Map();
export async function auth(role = 'administrator') {
  if (!sessions.has(role))
    sessions.set(
      role,
      request('/auth/login', null, 'POST', fixture[role]).then((s) => s.accessToken),
    );
  return sessions.get(role);
}
export async function sample(admin, name, { sold = false } = {}) {
  const snapshot = await request('/inventory/snapshot', admin),
    shop = snapshot.locations.find((p) => p.type === 'shop');
  const item = await request('/inventory/items', admin, 'POST', {
    sku: `QA-${randomUUID().slice(0, 8)}`,
    name,
    category: 'Test',
    unit: 'pcs',
    reorderLevel: 0,
    unitCostCents: 100,
    sellingPriceCents: 200,
    openingStock: 0,
    locationId: shop.id,
  });
  const operation = async (kind, extra) => {
    const c = await request(`/inventory/items/${item.id}/exact-costing`, admin),
      key = randomUUID();
    await request('/inventory/exact-costing/requests', admin, 'POST', {
      requestKey: key,
      input: {
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
      },
    });
    return request(`/inventory/exact-costing/requests/${key}/apply`, admin, 'POST');
  };
  await operation('checkpoint', { valueCents: 0, costReviewId: null });
  for (const [quantity, unitCostCents] of [
    [1, 100],
    [2, 101],
  ])
    await operation('receipt', {
      quantity,
      unitCostCents,
      locationId: shop.id,
      movementDate: '2026-10-21',
      supplierId: null,
    });
  let sale = null;
  if (sold) {
    await request(`/inventory/items/${item.id}/pricing-preview`, admin, 'PATCH', {
      expectedVersion: 0,
      baseUnit: 'pcs',
      baseUnitVerified: true,
      previewEnabled: true,
      package: { label: 'box', size: 3, priceCents: 550 },
      bulkTiers: [],
    });
    const attendant = await auth('attendant'),
      quote = await request('/inventory/sales/quote', attendant, 'POST', {
        movementDate: '2026-10-21',
        lines: [{ itemId: item.id, quantity: 3, expectedVersion: 1, expectedRetailPriceCents: 200 }],
      });
    sale = await request('/inventory/sales/complete', attendant, 'POST', {
      idempotencyKey: randomUUID(),
      quoteToken: quote.quoteToken,
    });
  }
  return { item, shop, sale };
}
