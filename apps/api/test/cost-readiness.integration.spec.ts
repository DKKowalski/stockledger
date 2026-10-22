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
if (!url || new URL(url).hostname !== '127.0.0.1' || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))) throw new Error('Use the isolated integration runner');
const db = postgres<Contract>({ contractJson, url });
const sql = new pg.Client({ connectionString: url });
const runtimeRole = `stockledger_test_${randomUUID().replaceAll('-', '')}`;
const varchar = <N extends number>(value: string) => value as Varchar<N>;
let app: INestApplication, base: string, config: ConfigService, jwt: JwtService;

async function request(path: string, token?: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  await sql.connect();
  await sql.query(`CREATE ROLE "${runtimeRole}" LOGIN PASSWORD 'isolated-runtime-only' IN ROLE stockledger_app`);
  const runtimeUrl = new URL(url); runtimeUrl.username = runtimeRole; runtimeUrl.password = 'isolated-runtime-only';
  const runtime = postgres<Contract>({ contractJson, url: runtimeUrl.toString() });
  const compiled = '../dist/app.module.js', prismaModule = '../dist/prisma/prisma.service.js';
  const { AppModule } = await import(compiled);
  const { PrismaService } = await import(prismaModule);
  app = await NestFactory.create(AppModule, { logger: false });
  Object.assign(app.get(PrismaService), { client: runtime });
  await app.listen(0, '127.0.0.1'); base = await app.getUrl(); config = app.get(ConfigService); jwt = app.get(JwtService);
});
afterAll(async () => { if (app) await app.close(); await db.close(); await sql.query(`DROP ROLE IF EXISTS "${runtimeRole}"`); await sql.end(); });

async function fixture(cost = 1000) {
  config.set('app.environment', 'test');
  const company = await db.orm.public.Company.create({ name: varchar<120>('Cost review synthetic business') });
  const shop = await db.orm.public.Location.create({ companyId: company.id, name: varchar<120>('Shop'), type: 'shop' });
  const tokens = {} as Record<'admin' | 'attendant' | 'manager', string>;
  for (const [key, role] of [['admin', 'administrator'], ['attendant', 'shop_attendant'], ['manager', 'inventory_manager']] as const) {
    const user = await db.orm.public.User.create({ companyId: company.id, locationId: role === 'shop_attendant' ? shop.id : null, role,
      fullName: varchar<120>(key), email: varchar<255>(`${randomUUID()}@test.invalid`), passwordHash: varchar<255>('unused') });
    tokens[key] = await jwt.signAsync({ sub: user.id, companyId: company.id, role });
  }
  const item = await db.orm.public.InventoryItem.create({ companyId: company.id, sku: varchar<40>('COST'), name: varchar<120>('Cost test item'), category: varchar<80>('Test'), unit: varchar<20>('pcs'), unitCostCents: cost, sellingPriceCents: 1500 });
  await db.orm.public.LocationStock.create({ companyId: company.id, itemId: item.id, locationId: shop.id, openingStock: 30 });
  config.set('app.costReadinessCompanyIds', [company.id]);
  return { company, shop, item, tokens, path: `/inventory/items/${item.id}/cost-review` };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const input = (f: Fixture, reference = 'Opening record TEST-1') => ({ expectedCostCents: f.item.unitCostCents, expectedUnit: f.item.unit, expectedCurrency: 'GHS', expectedItemUpdatedAt: f.item.updatedAt, source: 'opening_records', reference, confirmed: true });
const events = (f: Fixture) => db.orm.public.AuditEvent.where({ companyId: f.company.id, action: varchar<80>('inventory.cost_reviewed') }).all();
async function businessRows(f: Fixture) {
  return {
    item: await db.orm.public.InventoryItem.first({ id: f.item.id }),
    stocks: await db.orm.public.LocationStock.where({ companyId: f.company.id }).all(),
    movements: await db.orm.public.StockMovement.where({ companyId: f.company.id }).all(),
    sales: await db.orm.public.Sale.where({ companyId: f.company.id }).all(),
  };
}

describe('administrator current-cost review without financial rewrites', () => {
  it('is default-off and production refuses writes even when allowlisted', async () => {
    const f = await fixture(); config.set('app.costReadinessCompanyIds', []);
    expect((await request('/inventory/cost-review', f.tokens.admin)).body.available).toBe(false);
    expect((await request(f.path, f.tokens.admin, 'POST', input(f))).status).toBe(403);
    config.set('app.costReadinessCompanyIds', [f.company.id]); config.set('app.environment', 'production');
    expect((await request('/inventory/cost-review', f.tokens.admin)).body.available).toBe(false);
    expect((await request(f.path, f.tokens.admin, 'POST', input(f))).status).toBe(403);
    expect(await events(f)).toHaveLength(0);
  });

  it('requires an active administrator, isolates tenants and validates input before writing', async () => {
    const f = await fixture(); const foreign = await fixture(); config.set('app.costReadinessCompanyIds', [f.company.id, foreign.company.id]);
    expect((await request(f.path)).status).toBe(401);
    for (const token of [f.tokens.attendant, f.tokens.manager]) {
      expect((await request(f.path, token)).status).toBe(403);
      expect((await request(f.path, token, 'POST', input(f))).status).toBe(403);
    }
    expect((await request(f.path, foreign.tokens.admin)).status).toBe(404);
    expect((await request(f.path, foreign.tokens.admin, 'POST', input(f))).status).toBe(404);
    for (const invalid of [{ ...input(f), expectedCostCents: '1000' }, { ...input(f), confirmed: false }, { ...input(f), reference: '  ' }, { ...input(f), historicalCostCents: 1000 }, { ...input(f), source: 'guessed' }]) {
      expect((await request(f.path, f.tokens.admin, 'POST', invalid)).status).toBe(400);
    }
    expect(await events(f)).toHaveLength(0);
  });

  it('appends one current review, deduplicates concurrent retries and leaves every business row unchanged', async () => {
    const f = await fixture(); const before = await businessRows(f);
    expect((await request(f.path, f.tokens.admin)).body.state).toBe('unconfirmed');
    const results = await Promise.all([1, 2, 3].map(() => request(f.path, f.tokens.admin, 'POST', input(f))));
    expect(results.map(r => r.status)).toEqual([201, 201, 201]);
    expect(new Set(results.map(r => r.body.review.id)).size).toBe(1);
    expect(results[0]!.body).toMatchObject({ state: 'confirmed', item: { unitCostCents: 1000 }, review: { costCents: 1000, source: 'opening_records', reference: 'Opening record TEST-1' } });
    expect(await events(f)).toHaveLength(1); expect(await businessRows(f)).toEqual(before);
  });

  it('requires an intentional free acquisition for zero rather than treating missing cost as free', async () => {
    const f = await fixture(0);
    expect((await request(f.path, f.tokens.admin)).body).toMatchObject({ state: 'unconfirmed', item: { unitCostCents: 0 }, review: null });
    expect((await request(f.path, f.tokens.admin, 'POST', input(f))).status).toBe(409);
    expect(await events(f)).toHaveLength(0);
    const reviewed = await request(f.path, f.tokens.admin, 'POST', { ...input(f), source: 'free_acquisition', reference: 'Supplier free sample note' });
    expect(reviewed.body).toMatchObject({ state: 'confirmed', review: { costCents: 0, source: 'free_acquisition' } });
    const positive = await fixture();
    expect((await request(positive.path, positive.tokens.admin, 'POST', { ...input(positive), source: 'free_acquisition' })).status).toBe(409);
  });

  it('invalidates a review after a real purchase changes the moving average without changing old reviews or sale snapshots', async () => {
    const f = await fixture();
    const legacy = await db.orm.public.StockMovement.create({ companyId: f.company.id, itemId: f.item.id, locationId: f.shop.id, type: 'sale', quantity: 2, unitPriceCents: 1500, unitCostCents: null, movementDate: '2026-10-20' });
    const first = await request(f.path, f.tokens.admin, 'POST', input(f));
    expect(first.body.state).toBe('confirmed');
    const purchase = await request('/inventory/movements', f.tokens.admin, 'POST', { itemId: f.item.id, locationId: f.shop.id, type: 'purchase', quantity: 10, unitCostCents: 2000, movementDate: '2026-10-21' });
    expect(purchase.status).toBe(201);
    const current = await request(f.path, f.tokens.admin);
    expect(current.body.state).toBe('changed'); expect(current.body.item.unitCostCents).toBe(1263);
    expect(current.body.review).toEqual(first.body.review);
    expect((await request(f.path, f.tokens.admin, 'POST', input(f))).status).toBe(409);
    const refreshed = await request(f.path, f.tokens.admin, 'POST', { ...input(f), expectedCostCents: current.body.item.unitCostCents, expectedItemUpdatedAt: current.body.item.updatedAt, source: 'purchase_records', reference: 'Receipt TEST-2 and opening record' });
    expect(refreshed.body.state).toBe('confirmed'); expect(await events(f)).toHaveLength(2);
    expect(await db.orm.public.StockMovement.first({ id: legacy.id })).toEqual(legacy);
    const profitBefore = await request(`/inventory/profitability?itemId=${f.item.id}`, f.tokens.admin);
    await request(f.path, f.tokens.admin, 'POST', { ...input(f), expectedCostCents: current.body.item.unitCostCents, expectedItemUpdatedAt: current.body.item.updatedAt, source: 'purchase_records', reference: 'Receipt TEST-2 and opening record' });
    expect((await request(`/inventory/profitability?itemId=${f.item.id}`, f.tokens.admin)).body).toEqual(profitBefore.body);
  });

  it('rejects stale unit/revision and archives, including a cost changed away and back to the same amount', async () => {
    const f = await fixture(); await request(f.path, f.tokens.admin, 'POST', input(f));
    await db.orm.public.InventoryItem.where({ id: f.item.id }).update({ unitCostCents: 1200 });
    await db.orm.public.InventoryItem.where({ id: f.item.id }).update({ unitCostCents: 1000 });
    expect((await request(f.path, f.tokens.admin)).body.state).toBe('changed');
    expect((await request(f.path, f.tokens.admin, 'POST', input(f))).status).toBe(409);
    await db.orm.public.InventoryItem.where({ id: f.item.id }).update({ unit: varchar<20>('bottle') });
    expect((await request(f.path, f.tokens.admin, 'POST', input(f))).status).toBe(409);
    const current = await db.orm.public.InventoryItem.first({ id: f.item.id });
    await db.orm.public.InventoryItem.where({ id: f.item.id }).update({ isActive: false });
    expect((await request(f.path, f.tokens.admin, 'POST', { ...input(f), expectedUnit: current!.unit, expectedItemUpdatedAt: current!.updatedAt })).status).toBe(409);
    expect(await events(f)).toHaveLength(1);
  });

  it('rechecks after waiting behind a purchase item lock and writes no stale confirmation', async () => {
    const f = await fixture(); const blocker = new pg.Client({ connectionString: url }); await blocker.connect();
    let pending: ReturnType<typeof request> | undefined;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM inventory_items WHERE id=$1 FOR UPDATE', [f.item.id]);
      pending = request(f.path, f.tokens.admin, 'POST', input(f));
      const deadline = Date.now() + 5000; let waiting = false;
      while (Date.now() < deadline) {
        const rows = await sql.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%inventory_items%FOR UPDATE%'");
        if (rows.rowCount) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await blocker.query('UPDATE inventory_items SET unit_cost_cents=1100,updated_at=clock_timestamp() WHERE id=$1', [f.item.id]); await blocker.query('COMMIT');
      expect((await pending).status).toBe(409); expect(await events(f)).toHaveLength(0);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); if (pending) await pending; }
  });

  it('invalidates a confirmation when currency changes, preserving its original currency', async () => {
    const f = await fixture(); const first = await request(f.path, f.tokens.admin, 'POST', input(f));
    expect(first.body.review.currency).toBe('GHS');
    await db.orm.public.Company.where({ id: f.company.id }).update({ currency: varchar<3>('USD') });
    expect((await request(f.path, f.tokens.admin)).body).toMatchObject({ state: 'changed', currency: 'USD', review: { currency: 'GHS' } });
    expect((await request(f.path, f.tokens.admin, 'POST', input(f))).status).toBe(409);
    const second = await request(f.path, f.tokens.admin, 'POST', { ...input(f), expectedCurrency: 'USD' });
    expect(second.body).toMatchObject({ state: 'confirmed', review: { currency: 'USD' } });
    expect(await events(f)).toHaveLength(2);
  });

  it('keeps review append order even when the older recorded timestamp is ahead of the current wall clock', async () => {
    const f = await fixture(); const first = await request(f.path, f.tokens.admin, 'POST', input(f));
    await sql.query("UPDATE audit_events SET created_at=clock_timestamp()+interval '1 second' WHERE id=$1", [first.body.review.id]);
    const second = await request(f.path, f.tokens.admin, 'POST', input(f, 'Reviewed record TEST-2'));
    expect(second.status).toBe(201); expect(second.body.review.reference).toBe('Reviewed record TEST-2');
    expect((await request(f.path, f.tokens.admin)).body.review.id).toBe(second.body.review.id);
    expect(await events(f)).toHaveLength(2);
  });

  it('waits behind a currency edit and rejects the old-currency confirmation without an audit write', async () => {
    const f = await fixture(); const blocker = new pg.Client({ connectionString: url }); await blocker.connect();
    let pending: ReturnType<typeof request> | undefined;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM companies WHERE id=$1 FOR UPDATE', [f.company.id]);
      pending = request(f.path, f.tokens.admin, 'POST', input(f));
      const deadline = Date.now() + 5000; let waiting = false;
      while (Date.now() < deadline) {
        const rows = await sql.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%companies%FOR SHARE%'");
        if (rows.rowCount) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await blocker.query("UPDATE companies SET currency='USD' WHERE id=$1", [f.company.id]); await blocker.query('COMMIT');
      expect((await pending).status).toBe(409); expect(await events(f)).toHaveLength(0);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); if (pending) await pending; }
  });

  it('retains reviews in the complete archive and preserves readable history after disabling writes', async () => {
    const f = await fixture(); const first = await request(f.path, f.tokens.admin, 'POST', input(f));
    const archive = await request('/settings/exports/workspace-v3', f.tokens.admin);
    expect(archive.status).toBe(200);
    expect(JSON.stringify(archive.body)).toContain(first.body.review.id);
    config.set('app.costReadinessCompanyIds', []);
    expect((await request(f.path, f.tokens.admin)).body).toMatchObject({ available: false, state: 'confirmed', review: { id: first.body.review.id } });
    expect((await request(f.path, f.tokens.admin, 'POST', input(f))).status).toBe(403);
  });
});
