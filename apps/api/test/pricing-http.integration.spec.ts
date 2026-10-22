import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import postgres from '@prisma/orm-postgres/runtime';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Contract } from '../src/prisma/contract.d.js';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

const url = process.env.INVENTORY_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) {
  throw new Error('HTTP integration tests require the isolated test database runner');
}
const db = postgres<Contract>({ contractJson, url });
const companyId = randomUUID();
const adminId = randomUUID();
const attendantId = randomUUID();
const shopId = randomUUID();
const warehouseId = randomUUID();
const itemId = randomUUID();
const varchar = <N extends number>(value: string) => value as Varchar<N>;
const date = new Date().toISOString().slice(0, 10);
let app: INestApplication;
let base: string;
let adminToken: string;
let attendantToken: string;

async function request(path: string, token?: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: {
    'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  vi.stubEnv('PRICING_PREVIEW_COMPANY_IDS', companyId);
  await db.orm.public.Company.create({ id: companyId, name: varchar<120>('HTTP pricing fixture') });
  for (const [id, name, type] of [[shopId, 'Shop', 'shop'], [warehouseId, 'Warehouse', 'warehouse']] as const) {
    await db.orm.public.Location.create({ id, companyId, name: varchar<120>(name), type });
  }
  for (const [id, role] of [[adminId, 'administrator'], [attendantId, 'shop_attendant']] as const) {
    await db.orm.public.User.create({ id, companyId, role, locationId: role === 'shop_attendant' ? shopId : null,
      fullName: varchar<120>(role), email: varchar<255>(`${id}@test.invalid`), passwordHash: varchar<255>('unused') });
  }
  await db.orm.public.InventoryItem.create({ id: itemId, companyId, sku: varchar<40>('HTTP'),
    name: varchar<120>('Preview product'), category: varchar<80>('Test'), unit: varchar<20>('pcs'),
    unitCostCents: 1000, sellingPriceCents: 1500 });
  await db.orm.public.LocationStock.create({ companyId, itemId, locationId: shopId, openingStock: 30 });
  // Build first in run-integration.mjs; use compiled metadata rather than Vitest's TS transform.
  const compiledModule = '../dist/app.module.js';
  const { AppModule } = await import(compiledModule);
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const jwt = app.get(JwtService);
  adminToken = await jwt.signAsync({ sub: adminId, companyId, role: 'administrator' });
  attendantToken = await jwt.signAsync({ sub: attendantId, companyId, role: 'shop_attendant' });
});

afterAll(async () => {
  if (app) await app.close();
  await db.close();
  vi.unstubAllEnvs();
});

describe('pricing preview HTTP contract and existing sales workflow', () => {
  it('requires authentication and validates nested input before configuration writes', async () => {
    expect((await request('/inventory/pricing-preview')).status).toBe(401);
    const body = { expectedVersion: 0, previewEnabled: true, baseUnit: 'pcs', baseUnitVerified: true,
      package: { label: 'box', size: 10, priceCents: 12000 }, bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1300 }] };
    expect((await request(`/inventory/items/${itemId}/pricing-preview`, attendantToken, 'PATCH', body)).status).toBe(403);
    expect((await request(`/inventory/items/${itemId}/pricing-preview`, adminToken, 'PATCH', {
      ...body, package: { ...body.package, priceCents: '12000' },
    })).status).toBe(400);
    expect(await db.orm.public.ItemPricingVersion.where({ companyId }).all()).toHaveLength(0);
    expect((await request(`/inventory/items/${itemId}/pricing-preview`, adminToken, 'PATCH', body)).status).toBe(200);
  });

  it('quotes the configured price without changing stock and rejects stale or manipulated quotes', async () => {
    const before = await db.orm.public.StockMovement.where({ companyId }).all();
    const quote = await request('/inventory/pricing-preview/quote', attendantToken, 'POST', {
      lines: [{ itemId, quantity: 15, expectedVersion: 1 }],
    });
    expect(quote.status).toBe(201);
    expect(quote.body).toMatchObject({ previewOnly: true, canComplete: false, totalCents: 18500 });
    expect(await db.orm.public.StockMovement.where({ companyId }).all()).toEqual(before);
    expect((await request('/inventory/pricing-preview/quote', attendantToken, 'POST', {
      lines: [{ itemId, quantity: 15, expectedVersion: 0 }],
    })).status).toBe(409);
    expect((await request('/inventory/pricing-preview/quote', attendantToken, 'POST', {
      lines: [{ itemId, quantity: 15, totalCents: 1 }],
    })).status).toBe(400);
  });

  it('keeps actual sales at retail and rejects stale prices or discount injection with no extra deductions', async () => {
    const sale = { itemId, locationId: shopId, type: 'sale', quantity: 7, movementDate: date, expectedUnitPriceCents: 1500 };
    const result = await request('/inventory/movements', attendantToken, 'POST', sale);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ quantity: 7, unitPriceCents: 1500, unitCostCents: 1000 });
    expect((await request('/inventory/movements', attendantToken, 'POST', { ...sale, expectedUnitPriceCents: 1300 })).status).toBe(409);
    expect((await request('/inventory/movements', attendantToken, 'POST', { ...sale, manualDiscountCents: 100 })).status).toBe(400);
    expect(await db.orm.public.StockMovement.where({ companyId, itemId, type: 'sale' }).all()).toHaveLength(1);
    const snapshot = await request('/inventory/snapshot', attendantToken);
    expect(snapshot.body.positions.find((position: { item: { id: string } }) => position.item.id === itemId).closing).toBe(23);
  });

  it('preserves purchase → transfer → sale → original-price return → profitability over HTTP', async () => {
    const created = await request('/inventory/items', adminToken, 'POST', { sku: 'JOURNEY', name: 'Journey product', category: 'Test',
      unit: 'pcs', unitCostCents: 0, sellingPriceCents: 1500, openingStock: 0, locationId: warehouseId });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const movement = { itemId: id, locationId: warehouseId, quantity: 10, movementDate: date };
    expect((await request('/inventory/movements', adminToken, 'POST', { ...movement, type: 'purchase', unitCostCents: 1000 })).status).toBe(201);
    expect((await request('/inventory/movements', adminToken, 'POST', { ...movement, type: 'transfer', destinationLocationId: shopId })).status).toBe(201);
    const sale = await request('/inventory/movements', attendantToken, 'POST', { ...movement, locationId: shopId, type: 'sale', quantity: 2, expectedUnitPriceCents: 1500 });
    expect(sale.status).toBe(201);
    const returned = await request('/inventory/movements', adminToken, 'POST', { ...movement, locationId: shopId, type: 'return_in', quantity: 1, relatedMovementId: sale.body.id });
    expect(returned.status).toBe(201);
    expect(returned.body).toMatchObject({ unitPriceCents: 1500, unitCostCents: 1000 });
    const profit = await request(`/inventory/profitability?itemId=${id}`, adminToken);
    expect(profit.status).toBe(200);
    expect(profit.body.summary).toMatchObject({ netSalesCents: 1500, cogsCents: 1000, grossProfitCents: 500, unitsSold: 2, unitsReturned: 1 });
  });
});
