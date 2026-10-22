import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import postgres from '@prisma/orm-postgres/runtime';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d.js';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

const url = process.env.INVENTORY_TEST_DATABASE_URL!;
if (
  !url ||
  new URL(url).hostname !== '127.0.0.1' ||
  !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))
)
  throw new Error('Use the isolated integration runner');
const db = postgres<Contract>({ contractJson, url });
const sql = new pg.Client({ connectionString: url });
const runtimeRole = `stockledger_test_${randomUUID().replaceAll('-', '')}`;
const v = <N extends number>(s: string) => s as Varchar<N>;
let app: INestApplication, base: string, config: ConfigService, jwt: JwtService;
async function request(path: string, token: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
beforeAll(async () => {
  await sql.connect();
  await sql.query(
    `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD 'isolated-runtime-only' IN ROLE stockledger_app`,
  );
  const runtimeUrl = new URL(url);
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = 'isolated-runtime-only';
  const runtime = postgres<Contract>({ contractJson, url: runtimeUrl.toString() });
  const compiled = '../dist/app.module.js',
    prismaModule = '../dist/prisma/prisma.service.js';
  const { AppModule } = await import(compiled),
    { PrismaService } = await import(prismaModule);
  app = await NestFactory.create(AppModule, { logger: false });
  Object.assign(app.get(PrismaService), { client: runtime });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  config = app.get(ConfigService);
  jwt = app.get(JwtService);
});
afterAll(async () => {
  if (app) await app.close();
  await db.close();
  await sql.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);
  await sql.end();
});
async function fixture(opening = 0, cost = 100) {
  config.set('app.environment', 'test');
  const company = await db.orm.public.Company.create({ name: v<120>('Exact costing synthetic') });
  const shop = await db.orm.public.Location.create({
    companyId: company.id,
    name: v<120>('Shop'),
    type: 'shop',
  });
  const tokens = {} as Record<'admin' | 'attendant' | 'manager', string>,
    users = {} as Record<string, string>;
  for (const [key, role] of [
    ['admin', 'administrator'],
    ['attendant', 'shop_attendant'],
    ['manager', 'inventory_manager'],
  ] as const) {
    const user = await db.orm.public.User.create({
      companyId: company.id,
      role,
      locationId: role === 'shop_attendant' ? shop.id : null,
      fullName: v<120>(key),
      email: v<255>(`${randomUUID()}@test.invalid`),
      passwordHash: v<255>('unused'),
    });
    tokens[key] = await jwt.signAsync({ sub: user.id, companyId: company.id, role });
    users[key] = user.id;
  }
  const item = await db.orm.public.InventoryItem.create({
    companyId: company.id,
    sku: v<40>('EXACT'),
    name: v<120>('Exact item'),
    category: v<80>('Test'),
    unit: v<20>('pcs'),
    unitCostCents: cost,
    sellingPriceCents: 200,
  });
  await db.orm.public.LocationStock.create({
    companyId: company.id,
    itemId: item.id,
    locationId: shop.id,
    openingStock: opening,
  });
  for (const key of [
    'exactCostingCompanyIds',
    'costReadinessCompanyIds',
    'saleCompletionCompanyIds',
    'pricingPreviewCompanyIds',
    'saleReturnsCompanyIds',
    'stockOperationsCompanyIds',
  ])
    config.set(`app.${key}`, [company.id]);
  return { company, shop, item, tokens, users, path: `/inventory/items/${item.id}/exact-costing` };
}
type F = Awaited<ReturnType<typeof fixture>>;
const current = (f: F) => request(f.path, f.tokens.admin);
async function input(f: F, kind = 'checkpoint', extra: Record<string, unknown> = {}) {
  const { body: c } = await current(f);
  return {
    itemId: f.item.id,
    kind,
    expectedItemUpdatedAt: c.item.updatedAt,
    expectedUnit: c.item.unit,
    expectedCurrency: c.currency,
    expectedQuantity: c.quantity,
    expectedSequence: c.sequence,
    reference: 'Synthetic invoice/stock sheet',
    confirmed: true,
    ...(kind === 'receipt'
      ? {
          locationId: f.shop.id,
          quantity: 1,
          unitCostCents: 100,
          movementDate: '2026-10-21',
          freeStockConfirmed: false,
          supplierId: null,
        }
      : {
          valueCents: 0,
          freeStockConfirmed: false,
          ...(kind === 'checkpoint'
            ? { costReviewId: c.costReview.review?.id ?? null }
            : { reason: 'Verified current-value correction' }),
        }),
    ...extra,
  };
}
async function prepare(f: F, data: unknown, key = randomUUID()) {
  const r = await request('/inventory/exact-costing/requests', f.tokens.admin, 'POST', {
    requestKey: key,
    input: data,
  });
  return { ...r, key };
}
const apply = (f: F, key: string) =>
  request(`/inventory/exact-costing/requests/${key}/apply`, f.tokens.admin, 'POST');
const cancel = (f: F, key: string) =>
  request(`/inventory/exact-costing/requests/${key}/cancel`, f.tokens.admin, 'POST');
async function operation(f: F, kind: string, extra: Record<string, unknown> = {}) {
  const prepared = await prepare(f, await input(f, kind, extra));
  expect(prepared.status).toBe(201);
  const result = await apply(f, prepared.key);
  expect(result.body, JSON.stringify(result.body)).toHaveProperty('request.status', 'applied');
  return result;
}
async function enroll(f: F) {
  return operation(f, 'checkpoint');
}
async function pricing(f: F) {
  return request(`/inventory/items/${f.item.id}/pricing-preview`, f.tokens.admin, 'PATCH', {
    expectedVersion: 0,
    baseUnit: 'pcs',
    baseUnitVerified: true,
    previewEnabled: true,
    package: null,
    bulkTiers: [],
  });
}
async function quote(f: F, quantity = 1) {
  return request('/inventory/sales/quote', f.tokens.attendant, 'POST', {
    movementDate: '2026-10-21',
    lines: [
      {
        itemId: f.item.id,
        quantity,
        quantityUnit: 'base',
        expectedVersion: 1,
        expectedRetailPriceCents: 200,
      },
    ],
  });
}
async function sell(f: F, quantity = 1) {
  const q = await quote(f, quantity);
  expect(q.status, JSON.stringify(q.body)).toBe(201);
  const r = await request('/inventory/sales/complete', f.tokens.attendant, 'POST', {
    idempotencyKey: randomUUID(),
    quoteToken: q.body.quoteToken,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

async function returnInputFor(
  f: F,
  saleId: string,
  quantity = 1,
  disposition = 'resellable',
  kind = 'return',
  sourceType = 'grouped',
) {
  const source = await request(`/inventory/sale-returns/sources/${sourceType}/${saleId}`, f.tokens.admin);
  expect(source.status, JSON.stringify(source.body)).toBe(200);
  return {
    sourceType,
    sourceId: saleId,
    kind,
    expectedRevision: source.body.revision,
    movementDate: '2026-10-21',
    reason: 'Documented synthetic customer return',
    reference: 'RETURN-TEST',
    confirmed: true,
    lines: [{ itemId: f.item.id, quantity, disposition }],
  };
}
async function prepareReturn(f: F, data: unknown, key = randomUUID()) {
  const r = await request('/inventory/sale-returns/requests', f.tokens.admin, 'POST', {
    requestKey: key,
    input: data,
  });
  return { ...r, key };
}
const applyReturn = (f: F, key: string) =>
  request(`/inventory/sale-returns/requests/${key}/apply`, f.tokens.admin, 'POST');
async function returned(
  f: F,
  saleId: string,
  quantity = 1,
  disposition = 'resellable',
  kind = 'return',
  sourceType = 'grouped',
) {
  const prepared = await prepareReturn(
    f,
    await returnInputFor(f, saleId, quantity, disposition, kind, sourceType),
  );
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
  const result = await applyReturn(f, prepared.key);
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  expect(result.body.request.status).toBe('applied');
  return result;
}
async function stocked() {
  const f = await fixture();
  await enroll(f);
  await operation(f, 'receipt');
  await operation(f, 'receipt', { quantity: 2, unitCostCents: 101 });
  return f;
}
async function stockInput(f: F, operation: string, extra: Record<string, unknown> = {}) {
  const c = (await current(f)).body;
  const data = await input(f, 'stock_operation', {
    operation,
    locationId: f.shop.id,
    destinationLocationId: null,
    quantity: 1,
    expectedLocationQuantity: c.positions.find((p: { locationId: string }) => p.locationId === f.shop.id)
      .quantity,
    unitCostCents: null,
    originalMovementId: null,
    supplierCreditCents: null,
    reason: 'Documented synthetic stock change',
    movementDate: '2026-10-21',
    ...extra,
  });
  const { valueCents: _value, ...result } = data as typeof data & { valueCents?: unknown };
  return result;
}
async function stockOperation(f: F, op: string, extra: Record<string, unknown> = {}, token = f.tokens.admin) {
  const key = randomUUID(),
    data = await stockInput(f, op, extra);
  const p = await request('/inventory/exact-costing/requests', token, 'POST', {
    requestKey: key,
    input: data,
  });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  const r = await request(`/inventory/exact-costing/requests/${key}/apply`, token, 'POST');
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { ...r, key };
}

describe('original-allocation returns and complete exact stock operations', () => {
  it('restores original cents after a cost increase, accounts for damaged returns without sellable stock, and preserves the sale', async () => {
    const f = await stocked();
    await request(`/inventory/items/${f.item.id}/pricing-preview`, f.tokens.admin, 'PATCH', {
      expectedVersion: 0,
      baseUnit: 'pcs',
      baseUnitVerified: true,
      previewEnabled: true,
      package: { label: 'box', size: 3, priceCents: 550 },
      bulkTiers: [],
    });
    const sale = await sell(f, 3),
      original = await db.orm.public.Sale.first({ id: sale.id });
    await operation(f, 'receipt', { quantity: 3, unitCostCents: 300 });
    const first = await returned(f, sale.id, 1);
    expect(first.body.result).toMatchObject({
      refundCents: 184,
      cogsCents: 101,
      refundStatus: 'not_processed',
    });
    expect((await current(f)).body).toMatchObject({ quantity: 4, valueCents: 1001 });
    const rest = await returned(f, sale.id, 2, 'damaged');
    expect(rest.body.result).toMatchObject({ refundCents: 366, cogsCents: 201 });
    expect((await current(f)).body).toMatchObject({ quantity: 4, valueCents: 1001 });
    expect(await db.orm.public.Sale.first({ id: sale.id })).toEqual(original);
    const profit = (await request(`/inventory/profitability?itemId=${f.item.id}`, f.tokens.admin)).body
      .summary;
    expect(profit).toMatchObject({ netSalesCents: 0, cogsCents: 0, inventoryLossCents: 201 });
    expect((await prepareReturn(f, await returnInputFor(f, sale.id, 1))).status).toBe(409);
    for (const allocation of rest.body.result.allocations)
      for (const id of [allocation.returnMovementId, allocation.lossMovementId])
        expect((await request(`/inventory/movements/${id}`, f.tokens.admin, 'DELETE')).status).toBe(409);
  });
  it('concurrent same-key preparation/application deduplicates; different keys cannot return the same units twice', async () => {
    const f = await stocked();
    await pricing(f);
    const sale = await sell(f, 3),
      data = await returnInputFor(f, sale.id, 3),
      key = randomUUID();
    const preparations = await Promise.all([1, 2].map(() => prepareReturn(f, data, key)));
    expect(preparations.map((r) => r.status)).toEqual([201, 201]);
    const other = await prepareReturn(f, data);
    const results = await Promise.all([applyReturn(f, key), applyReturn(f, key), applyReturn(f, other.key)]);
    expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
    expect(await db.orm.public.SaleReturn.where({ companyId: f.company.id }).all()).toHaveLength(1);
    expect((await current(f)).body).toMatchObject({ quantity: 3, valueCents: 302 });
  });
  it('reverses only remaining allocations after a partial return and retains readable results after flag-off', async () => {
    const f = await stocked();
    await pricing(f);
    const sale = await sell(f, 3);
    await returned(f, sale.id);
    const p = await prepareReturn(f, await returnInputFor(f, sale.id, 2, 'resellable', 'reversal'));
    const r = await applyReturn(f, p.key);
    expect(r.body.result).toMatchObject({ kind: 'reversal', refundCents: 400, cogsCents: 201 });
    config.set('app.saleReturnsCompanyIds', []);
    expect((await request('/inventory/sale-returns', f.tokens.admin)).body).toMatchObject({
      available: false,
      sources: [],
    });
    expect((await applyReturn(f, p.key)).body.result.id).toBe(r.body.result.id);
    expect((await current(f)).body).toMatchObject({ quantity: 3, valueCents: 302 });
  });
  it('caps known-cost legacy returns using existing returns and refuses missing original costs', async () => {
    const f = await fixture(5);
    const legacy = await db.orm.public.StockMovement.create({
      companyId: f.company.id,
      itemId: f.item.id,
      locationId: f.shop.id,
      type: 'sale',
      quantity: 3,
      unitPriceCents: 123,
      unitCostCents: 77,
      movementDate: '2026-10-21',
    });
    expect(
      (
        await request('/inventory/movements', f.tokens.admin, 'POST', {
          itemId: f.item.id,
          locationId: f.shop.id,
          type: 'return_in',
          quantity: 1,
          relatedMovementId: legacy.id,
          movementDate: '2026-10-21',
        })
      ).status,
    ).toBe(201);
    const r = await returned(f, legacy.id, 2, 'resellable', 'return', 'legacy');
    expect(r.body.result).toMatchObject({ refundCents: 246, cogsCents: 154 });
    expect(await db.orm.public.StockMovement.first({ id: legacy.id })).toEqual(legacy);
    const unknown = await db.orm.public.StockMovement.create({
      companyId: f.company.id,
      itemId: f.item.id,
      locationId: f.shop.id,
      type: 'sale',
      quantity: 1,
      unitPriceCents: 123,
      unitCostCents: null,
      movementDate: '2026-10-21',
    });
    expect(
      (await prepareReturn(f, await returnInputFor(f, unknown.id, 1, 'resellable', 'return', 'legacy')))
        .status,
    ).toBe(409);
  });
  it('fences cancelled/unknown requests and rejects invalid roles, tenants, production and manipulated refund fields', async () => {
    const f = await stocked();
    await pricing(f);
    const sale = await sell(f, 1),
      data = await returnInputFor(f, sale.id),
      key = randomUUID();
    const path = `/inventory/sale-returns/requests/${key}`;
    expect((await request(`${path}/cancel`, f.tokens.admin, 'POST')).body.request.status).toBe('cancelled');
    expect((await prepareReturn(f, data, key)).body.request.status).toBe('cancelled');
    expect((await applyReturn(f, key)).body.request.status).toBe('cancelled');
    for (const token of [f.tokens.manager, f.tokens.attendant])
      expect((await request('/inventory/sale-returns', token)).status).toBe(403);
    const foreign = await fixture();
    expect(
      (await request(`/inventory/sale-returns/sources/grouped/${sale.id}`, foreign.tokens.admin)).status,
    ).toBe(404);
    config.set('app.saleReturnsCompanyIds', [f.company.id]);
    expect((await prepareReturn(f, { ...data, refundCents: 1 })).status).toBe(400);
    config.set('app.environment', 'production');
    expect((await prepareReturn(f, data)).status).toBe(403);
  });
  it('transfers preserve exact company value and supplier returns separate carrying cost from supplier credit', async () => {
    const f = await stocked();
    const warehouse = await db.orm.public.Location.create({
      companyId: f.company.id,
      name: v<120>('Warehouse'),
      type: 'warehouse',
    });
    const moved = await stockOperation(
      f,
      'transfer',
      { destinationLocationId: warehouse.id },
      f.tokens.manager,
    );
    expect(moved.body.entries).toHaveLength(1);
    expect((await current(f)).body).toMatchObject({ quantity: 3, valueCents: 302 });
    const purchase = await db.orm.public.StockMovement.first({
      companyId: f.company.id,
      type: 'purchase',
      quantity: 2,
    });
    const r = await stockOperation(f, 'supplier_return', {
      quantity: 2,
      originalMovementId: purchase!.id,
      supplierCreditCents: 202,
    });
    expect(
      r.body.entries.reduce((sum: number, e: { valueDeltaCents: number }) => sum + e.valueDeltaCents, 0),
    ).toBe(-201);
    expect((await current(f)).body).toMatchObject({ quantity: 1, valueCents: 101 });
    const event = await db.orm.public.AuditEvent.first({
      companyId: f.company.id,
      action: v<80>('inventory.valuation_stock_operation'),
    });
    expect(event).not.toBeNull();
  });
  it('damage and count shortages split fractional averages into exact losses', async () => {
    const f = await stocked();
    const r = await stockOperation(f, 'damage', { quantity: 3 });
    expect(
      r.body.entries.reduce((s: number, e: { valueDeltaCents: number }) => s + e.valueDeltaCents, 0),
    ).toBe(-302);
    expect((await current(f)).body).toMatchObject({ quantity: 0, valueCents: 0 });
    expect((await request('/inventory/profitability', f.tokens.admin)).body.summary.inventoryLossCents).toBe(
      302,
    );
    const counted = await stocked();
    await stockOperation(counted, 'count', { quantity: 5, unitCostCents: 200 });
    expect((await current(counted)).body).toMatchObject({ quantity: 5, valueCents: 702 });
    const shortage = await stockOperation(counted, 'count', { quantity: 3 });
    expect(
      shortage.body.entries.reduce((s: number, e: { valueDeltaCents: number }) => s + e.valueDeltaCents, 0),
    ).toBe(-281);
    expect((await current(counted)).body).toMatchObject({ quantity: 3, valueCents: 421 });
    const countHistory = (await request('/inventory/stock-counts', counted.tokens.admin)).body;
    expect(countHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ varianceQuantity: 2, valueImpactCents: 400 }),
        expect.objectContaining({ varianceQuantity: -2, valueImpactCents: -281 }),
      ]),
    );
    await stockOperation(counted, 'count', { quantity: 3 });
  });
  it('refuses transfer previews from empty places and invalid destinations without reserving a request', async () => {
    const f = await stocked(),
      warehouse = await db.orm.public.Location.create({
        companyId: f.company.id,
        name: v<120>('Empty warehouse'),
        type: 'warehouse',
      });
    for (const extra of [
      {
        locationId: warehouse.id,
        expectedLocationQuantity: 0,
        destinationLocationId: f.shop.id,
        quantity: 1,
      },
      { destinationLocationId: f.shop.id },
      { destinationLocationId: randomUUID() },
    ]) {
      const p = await prepare(f, await stockInput(f, 'transfer', extra));
      expect([400, 409]).toContain(p.status);
      expect(
        await db.orm.public.InventoryValuationRequest.first({ companyId: f.company.id, requestKey: p.key }),
      ).toBeNull();
    }
    expect((await current(f)).body).toMatchObject({ quantity: 3, valueCents: 302 });
  });
  it('reverses an untouched receipt at original cost and refuses a receipt with later dependent activity', async () => {
    const f = await stocked();
    const receipt = await db.orm.public.StockMovement.first({
      companyId: f.company.id,
      type: 'purchase',
      quantity: 2,
    });
    await stockOperation(f, 'receipt_reversal', { quantity: 2, originalMovementId: receipt!.id });
    expect((await current(f)).body).toMatchObject({ quantity: 1, valueCents: 100 });
    expect(await db.orm.public.StockMovement.first({ id: receipt!.id })).toEqual(receipt);
    const active = await stocked();
    await pricing(active);
    const prior = await db.orm.public.StockMovement.first({
      companyId: active.company.id,
      type: 'purchase',
      quantity: 2,
    });
    const p = await prepare(
      active,
      await stockInput(active, 'receipt_reversal', { quantity: 2, originalMovementId: prior!.id }),
    );
    expect(p.status).toBe(201);
    await sell(active, 1);
    expect((await apply(active, p.key)).status).toBe(409);
    expect(
      (
        await prepare(
          active,
          await stockInput(active, 'receipt_reversal', { quantity: 2, originalMovementId: prior!.id }),
        )
      ).status,
    ).toBe(409);
  });
  it('requires documented costs for count gains and separate stock-operation activation without exposing admin requests to managers', async () => {
    const f = await stocked();
    const p = await prepare(f, await stockInput(f, 'count', { quantity: 4, unitCostCents: 0 }));
    expect((await apply(f, p.key)).status).toBe(409);
    config.set('app.stockOperationsCompanyIds', []);
    expect((await prepare(f, await stockInput(f, 'damage'))).status).toBe(403);
    const cost = await prepare(f, await input(f, 'value_adjustment', { valueCents: 300 }));
    expect((await request(`/inventory/exact-costing/requests/${cost.key}`, f.tokens.manager)).status).toBe(
      409,
    );
    await db.orm.public.User.where({ id: f.users.admin! }).update({ role: 'inventory_manager' });
    for (const [method, suffix] of [
      ['GET', ''],
      ['POST', '/apply'],
      ['POST', '/cancel'],
    ])
      expect(
        (await request(`/inventory/exact-costing/requests/${cost.key}${suffix}`, f.tokens.admin, method))
          .status,
      ).toBe(401);
    const changedRoleToken = await jwt.signAsync({
      sub: f.users.admin!,
      companyId: f.company.id,
      role: 'inventory_manager',
    });
    for (const [method, suffix] of [
      ['GET', ''],
      ['POST', '/apply'],
      ['POST', '/cancel'],
    ])
      expect(
        (await request(`/inventory/exact-costing/requests/${cost.key}${suffix}`, changedRoleToken, method))
          .status,
      ).toBe(403);
  });
  it('archives immutable return records in v5, enforces runtime grants, and deletes them only with verified owner confirmation', async () => {
    const f = await stocked();
    await pricing(f);
    const sale = await sell(f, 3);
    const r = await returned(f, sale.id, 1, 'damaged');
    expect(JSON.stringify((await request('/settings/exports/workspace-v5', f.tokens.admin)).body)).toContain(
      r.body.result.id,
    );
    expect(
      (await request('/settings/exports/workspace-v4', f.tokens.admin)).body.saleReturns,
    ).toBeUndefined();
    for (const table of ['sale_returns', 'sale_return_allocations', 'sale_return_requests']) {
      await sql.query('BEGIN');
      try {
        await sql.query(`SET LOCAL ROLE "${runtimeRole}"`);
        await sql.query("SELECT set_config('app.current_company_id',$1,true)", [f.company.id]);
        await expect(sql.query(`UPDATE ${table} SET company_id=company_id`)).rejects.toHaveProperty(
          'code',
          '42501',
        );
      } finally {
        await sql.query('ROLLBACK');
      }
    }
    await db.orm.public.User.where({ id: f.users.admin! }).update({
      passwordHash: v<255>(await argon2.hash('Synthetic-only-delete-password')),
    });
    expect(
      (
        await request('/settings/account', f.tokens.admin, 'DELETE', {
          confirmation: f.company.name,
          currentPassword: 'Synthetic-only-delete-password',
        })
      ).status,
    ).toBe(200);
  });
});
