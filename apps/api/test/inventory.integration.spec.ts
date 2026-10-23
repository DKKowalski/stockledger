import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import postgres from '@prisma/orm-postgres/runtime';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import * as argon2 from 'argon2';
import { afterAll, describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d.js';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/modules/inventory/inventory.service.js';
import { StockMovementType as Type } from '../src/modules/inventory/inventory.types.js';
import { DataExportService } from '../src/modules/settings/data-export.service.js';
import { DataExportType } from '../src/modules/settings/data-export.types.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import type { ConfigService } from '@nestjs/config';
import { PricingPreviewService } from '../src/modules/inventory/pricing-preview.service.js';

const url = process.env.INVENTORY_TEST_DATABASE_URL;
if (!url || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))
  || new URL(url).hostname !== '127.0.0.1') {
  throw new Error('Run npm run api:test:integration to provision an isolated local database');
}

// Separate pools model requests handled by separate API processes.
const db = postgres<Contract>({ contractJson, url });
const otherDb = postgres<Contract>({ contractJson, url });
type TestTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function tenantPrisma(client: typeof db) {
  return Object.assign(new PrismaService(), { client });
}
const service = new InventoryService(tenantPrisma(db));
const otherService = new InventoryService(tenantPrisma(otherDb));
const exportsService = new DataExportService(tenantPrisma(db));
const varchar = <N extends number>(value: string) => value as Varchar<N>;
const movementDate = '2026-09-23';

async function asApplicationRole<T>(companyId: string | null, work: (tx: TestTransaction) => PromiseLike<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(db.raw.sql`SET LOCAL ROLE stockledger_app`.affectedCount().build());
    if (companyId) {
      await tx.query(db.raw.sql`
        SELECT set_config('app.current_company_id', ${companyId}, true) AS company_id
      `.returnsRow({ company_id: 'pg/text@1' }).build());
    }
    return work(tx);
  });
}

afterAll(async () => {
  await Promise.all([db.close(), otherDb.close()]);
});

async function fixture(openingStock = 5) {
  const company = await db.orm.public.Company.create({ name: varchar<120>('Concurrency test') });
  const warehouse = await db.orm.public.Location.create({
    companyId: company.id, name: varchar<120>('Warehouse'), type: 'warehouse',
  });
  const shop = await db.orm.public.Location.create({
    companyId: company.id, name: varchar<120>('Shop'), type: 'shop',
  });
  const admin = await db.orm.public.User.create({
    companyId: company.id, fullName: varchar<120>('Admin'),
    email: varchar<255>(`${randomUUID()}@test.invalid`), passwordHash: varchar<255>('unused'),
    role: 'administrator',
  });
  const attendant = await db.orm.public.User.create({
    companyId: company.id, locationId: shop.id, fullName: varchar<120>('Attendant'),
    email: varchar<255>(`${randomUUID()}@test.invalid`), passwordHash: varchar<255>('unused'),
    role: 'shop_attendant',
  });
  const item = await service.createItem(admin.id, company.id, {
    sku: 'TEST-ITEM', name: 'Test item', category: 'Test', unit: 'pcs',
    unitCostCents: 100, sellingPriceCents: 175, reorderLevel: 0, openingStock, locationId: warehouse.id,
  });
  return { company, warehouse, shop, admin, attendant, item };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function balance(f: Fixture, locationId: string) {
  const snapshot = await service.snapshot(f.admin.id, f.company.id, 30, locationId);
  return snapshot.positions.find((position) => position.item.id === f.item.id)?.closing ?? 0;
}

async function transfer(f: Fixture, quantity: number) {
  return service.createMovement(f.admin.id, f.company.id, {
    itemId: f.item.id, locationId: f.warehouse.id, destinationLocationId: f.shop.id,
    type: Type.TRANSFER, quantity, movementDate,
  });
}

// Hold the shared item lock until both API calls are visibly blocked inside
// PostgreSQL. This avoids relying on network timing to reproduce the race.
async function race(itemId: string, actions: [() => Promise<unknown>, () => Promise<unknown>]) {
  let markLocked!: () => void;
  let rejectLocked!: (error: unknown) => void;
  let releaseLock!: () => void;
  const locked = new Promise<void>((resolve, reject) => { markLocked = resolve; rejectLocked = reject; });
  const release = new Promise<void>((resolve) => { releaseLock = resolve; });
  const holder = db.transaction(async (tx) => {
    await tx.query(db.raw.sql`
      SELECT id FROM public.inventory_items WHERE id = ${itemId}::uuid FOR UPDATE
    `.returnsRow({ id: 'pg/uuid@1' }).build());
    markLocked();
    await release;
  });
  void holder.catch(rejectLocked);
  await locked;
  const results = Promise.allSettled(actions.map((action) => action()));
  try {
    await expect.poll(async () => {
      const rows = await otherDb.runtime().query(otherDb.raw.sql`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      `.returnsRow({ waiting: 'pg/int4@1' }).build());
      return rows[0]!.waiting;
    }, { timeout: 5_000, interval: 20 }).toBeGreaterThanOrEqual(2);
  } finally {
    releaseLock();
    await holder;
    await results;
  }
  return results;
}

function expectOneConflict(results: PromiseSettledResult<unknown>[]) {
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const failure = results.find((result) => result.status === 'rejected');
  expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(ConflictException);
}

function pricingPreview(companyIds: string[] = [], client = db) {
  return new PricingPreviewService(tenantPrisma(client), { get: () => companyIds } as unknown as ConfigService);
}

const previewConfig = {
  expectedVersion: 0, previewEnabled: true, baseUnit: 'pcs', baseUnitVerified: true,
  package: { label: 'box', size: 10, priceCents: 12000 },
  bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1300 }],
};

describe('optional pricing previews with PostgreSQL', () => {
  it('defaults off and keeps legacy sales, stock, and historical financial records unchanged', async () => {
    const f = await fixture(30);
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 1500 });
    await transfer(f, 30);
    const saleBody = { itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 2, movementDate };
    const original = await service.createMovement(f.attendant.id, f.company.id, saleBody);
    const before = await service.snapshot(f.admin.id, f.company.id);
    const off = pricingPreview();
    expect(await off.status(f.admin.id, f.company.id)).toMatchObject({ available: false });
    await expect(off.update(f.admin.id, f.company.id, f.item.id, previewConfig)).rejects.toBeInstanceOf(ForbiddenException);
    await pricingPreview([f.company.id]).update(f.admin.id, f.company.id, f.item.id, previewConfig);
    const quote = await off.quote(f.attendant.id, f.company.id, { lines: [{ itemId: f.item.id, quantity: 15 }] });
    expect(quote).toMatchObject({ previewOnly: true, canComplete: false, totalCents: 22500 });
    const after = await service.snapshot(f.admin.id, f.company.id);
    expect(after.items).toEqual(before.items);
    expect(after.positions).toEqual(before.positions);
    expect(after.movements).toEqual(before.movements);
    const nextSale = await service.createMovement(f.attendant.id, f.company.id, saleBody);
    expect(nextSale).toMatchObject({ unitPriceCents: 1500, quantity: 2 });
    expect(await db.orm.public.StockMovement.first({ id: original.id })).toEqual(original);
  });

  it('aggregates duplicate products, converts package inputs, and quotes without deducting stock', async () => {
    const f = await fixture(5);
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 1500 });
    const preview = pricingPreview([f.company.id]);
    await preview.update(f.admin.id, f.company.id, f.item.id, previewConfig);
    const quote = await preview.quote(f.attendant.id, f.company.id, { lines: [
      { itemId: f.item.id, quantity: 1, quantityUnit: 'package' }, { itemId: f.item.id, quantity: 5 },
    ] });
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]).toMatchObject({ quantity: 15, pricingVersion: 1, packageCount: 1, totalCents: 18500 });
    expect(quote.totalCents).toBe(18500);
    expect(await balance(f, f.warehouse.id)).toBe(5);
    expect(await db.orm.public.StockMovement.where({ companyId: f.company.id }).all()).toHaveLength(0);
    // Even an enabled preview cannot activate actual discounted selling in this stage.
    await transfer(f, 5);
    const sale = await service.createMovement(f.attendant.id, f.company.id, {
      itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 5, movementDate,
    });
    expect(sale.unitPriceCents).toBe(1500);
  });

  it('retains immutable versions and rejects concurrent or stale editor saves', async () => {
    const f = await fixture();
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 1500 });
    const preview = pricingPreview([f.company.id]);
    expectOneConflict(await race(f.item.id, [
      () => preview.update(f.admin.id, f.company.id, f.item.id, previewConfig),
      () => pricingPreview([f.company.id], otherDb).update(f.admin.id, f.company.id, f.item.id, previewConfig),
    ]));
    const first = (await preview.get(f.admin.id, f.company.id, f.item.id)).configuration!;
    const next = await preview.update(f.admin.id, f.company.id, f.item.id, { ...previewConfig, expectedVersion: 1, previewEnabled: false });
    expect(next.configuration.version).toBe(2);
    expect(await db.orm.public.ItemPricingVersion.first({ id: first.id })).toEqual(first);
    expect((await preview.quote(f.attendant.id, f.company.id, { lines: [{ itemId: f.item.id, quantity: 7 }] })).totalCents).toBe(10500);
    await expect(preview.update(f.admin.id, f.company.id, f.item.id, previewConfig)).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires administrator configuration and rejects changed units and other-company items', async () => {
    const f = await fixture();
    const stranger = await fixture();
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 1500 });
    const preview = pricingPreview([f.company.id]);
    await expect(preview.update(f.attendant.id, f.company.id, f.item.id, previewConfig)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(preview.get(f.attendant.id, f.company.id, f.item.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(preview.quote(f.attendant.id, f.company.id, { lines: [{ itemId: stranger.item.id, quantity: 1 }] })).rejects.toBeInstanceOf(NotFoundException);
    await preview.update(f.admin.id, f.company.id, f.item.id, previewConfig);
    await service.updateItem(f.admin.id, f.company.id, f.item.id, { unit: 'carton' });
    await expect(preview.quote(f.attendant.id, f.company.id, { lines: [{ itemId: f.item.id, quantity: 7 }] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets an administrator disable a preview even when a retail price change invalidates its tiers', async () => {
    const f = await fixture();
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 1500 });
    const preview = pricingPreview([f.company.id]);
    await preview.update(f.admin.id, f.company.id, f.item.id, previewConfig);
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 1000 });
    await expect(preview.quote(f.attendant.id, f.company.id, { lines: [{ itemId: f.item.id, quantity: 7 }] })).rejects.toBeInstanceOf(BadRequestException);
    await preview.update(f.admin.id, f.company.id, f.item.id, { ...previewConfig, expectedVersion: 1, previewEnabled: false });
    expect((await preview.quote(f.attendant.id, f.company.id, { lines: [{ itemId: f.item.id, quantity: 7 }] })).totalCents).toBe(7000);
  });

  it('enforces runtime grants, tenant isolation and append-only configuration history', async () => {
    const f = await fixture();
    const stranger = await fixture();
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 1500 });
    const runtime = { client: db, withCompany: asApplicationRole } as PrismaService;
    const preview = new PricingPreviewService(runtime, { get: () => [f.company.id] } as unknown as ConfigService);
    const version = (await preview.update(f.admin.id, f.company.id, f.item.id, previewConfig)).configuration;
    expect(await asApplicationRole(stranger.company.id, (tx) => tx.orm.public.ItemPricingVersion.all())).toEqual([]);
    expect(await asApplicationRole(null, (tx) => tx.orm.public.ItemPricingVersion.all())).toEqual([]);
    await expect(asApplicationRole(f.company.id, (tx) => tx.orm.public.ItemPricingVersion.where({ id: version.id }).update({ previewEnabled: false }))).rejects.toThrow();
    await asApplicationRole(f.company.id, (tx) => tx.orm.public.ItemPricingVersion.where({ id: version.id }).delete());
    expect(await db.orm.public.ItemPricingVersion.first({ id: version.id })).toEqual(version);
    await expect(asApplicationRole(stranger.company.id, (tx) => tx.orm.public.ItemPricingVersion.create({
      ...version, id: randomUUID(), version: 2,
    }))).rejects.toThrow();
    await expect(db.orm.public.ItemPricingVersion.create({ ...version, id: randomUUID(), version: 2, itemId: stranger.item.id })).rejects.toThrow();
    expect((await preview.quote(f.attendant.id, f.company.id, { lines: [{ itemId: f.item.id, quantity: 7 }] })).totalCents).toBe(9100);
  });

  it('exports pricing history only in the new archive format, preserving the legacy contract', async () => {
    const f = await fixture();
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 1500 });
    await pricingPreview([f.company.id]).update(f.admin.id, f.company.id, f.item.id, previewConfig);
    const legacy = JSON.parse((await exportsService.create(f.admin.id, f.company.id, DataExportType.WORKSPACE)).content);
    expect(legacy.format).toBe('stockledger-workspace-v1');
    expect(legacy.itemPricingVersions).toBeUndefined();
    const archive = JSON.parse((await exportsService.create(f.admin.id, f.company.id, DataExportType.WORKSPACE_V2)).content);
    expect(archive.format).toBe('stockledger-workspace-v2');
    expect(archive.itemPricingVersions).toHaveLength(1);
    expect(archive.itemPricingVersions[0]).toMatchObject({ itemId: f.item.id, version: 1 });
  });
});

describe('inventory transactions with PostgreSQL', () => {
  it('sets tenant context and explicit Read Committed isolation on the actual transaction wrapper', async () => {
    const f = await fixture();
    const rows = await tenantPrisma(db).withCompany(f.company.id, (tx) => tx.query(db.raw.sql`
      SELECT current_setting('transaction_isolation') AS isolation,
        current_setting('app.current_company_id') AS company
    `.returnsRow({ isolation: 'pg/text@1', company: 'pg/text@1' }).build()));
    expect(rows).toEqual([{ isolation: 'read committed', company: f.company.id }]);
  });

  it('preserves the lock-read contract even if a connection defaults to Serializable isolation', async () => {
    const f = await fixture();
    const connection = new URL(url!);
    connection.searchParams.set('options', '-cdefault_transaction_isolation=serializable');
    const serializableDb = postgres<Contract>({ contractJson, url: connection.toString() });
    try {
      const defaults = await serializableDb.runtime().query(serializableDb.raw.sql`
        SELECT current_setting('default_transaction_isolation') AS isolation
      `.returnsRow({ isolation: 'pg/text@1' }).build());
      expect(defaults[0]?.isolation).toBe('serializable');
      const rows = await tenantPrisma(serializableDb).withCompany(f.company.id, (tx) => tx.query(serializableDb.raw.sql`
        SELECT current_setting('transaction_isolation') AS isolation
      `.returnsRow({ isolation: 'pg/text@1' }).build()));
      expect(rows[0]?.isolation).toBe('read committed');
    } finally { await serializableDb.close(); }
  });
  it('returns the original price and cost after later purchases and retail price edits', async () => {
    const f = await fixture(10);
    await transfer(f, 10);
    const sale = await service.createMovement(f.attendant.id, f.company.id, {
      itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 3, movementDate,
    });
    await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE,
      quantity: 7, unitCostCents: 300, movementDate,
    });
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 500 });
    const returned = await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.shop.id, type: Type.RETURN_IN,
      relatedMovementId: sale.id, quantity: 1, movementDate,
    });
    expect(returned).toMatchObject({ unitPriceCents: 175, unitCostCents: 100 });
    expect(await db.orm.public.StockMovement.first({ id: sale.id })).toMatchObject({
      quantity: 3, unitPriceCents: 175, unitCostCents: 100,
    });
    expect(await balance(f, f.shop.id)).toBe(8);
    expect((await service.snapshot(f.admin.id, f.company.id)).items[0]?.unitCostCents).toBe(200);
  });

  it('serializes competing customer returns against the original sold quantity', async () => {
    const f = await fixture(3);
    await transfer(f, 3);
    const sale = await service.createMovement(f.attendant.id, f.company.id, {
      itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 3, movementDate,
    });
    const body = {
      itemId: f.item.id, locationId: f.shop.id, type: Type.RETURN_IN,
      relatedMovementId: sale.id, quantity: 2, movementDate,
    };
    expectOneConflict(await race(f.item.id, [
      () => service.createMovement(f.admin.id, f.company.id, body),
      () => otherService.createMovement(f.admin.id, f.company.id, body),
    ]));
    expect(await balance(f, f.shop.id)).toBe(2);
    expect(await db.orm.public.StockMovement.where({ relatedMovementId: sale.id }).all()).toHaveLength(1);
  });

  it('leaves stock, purchase history, and current cost unchanged after a rejected purchase', async () => {
    const f = await fixture(5);
    const before = await db.orm.public.StockMovement.where({ companyId: f.company.id }).all();
    await expect(service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE,
      quantity: 5, unitCostCents: 900, supplierId: randomUUID(), movementDate,
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(await balance(f, f.warehouse.id)).toBe(5);
    expect(await db.orm.public.StockMovement.where({ companyId: f.company.id }).all()).toEqual(before);
    expect(await db.orm.public.InventoryItem.first({ id: f.item.id })).toMatchObject({ unitCostCents: 100 });
  });

  it('stores the catalog price on each sale and preserves earlier sale totals', async () => {
    const f = await fixture();
    await transfer(f, 5);
    const body = { itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 2, movementDate };
    const first = await service.createMovement(f.attendant.id, f.company.id, body);
    expect(first.unitPriceCents).toBe(175);
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 250 });
    const second = await service.createMovement(f.attendant.id, f.company.id, body);
    expect(second.unitPriceCents).toBe(250);
    const snapshot = await service.snapshot(f.attendant.id, f.company.id);
    expect(snapshot.movements.find((movement) => movement.id === first.id)).toMatchObject({ unitPriceCents: 175, saleTotalCents: 350 });
    expect(snapshot.movements.find((movement) => movement.id === second.id)).toMatchObject({ unitPriceCents: 250, saleTotalCents: 500 });
    // Attendants sell at the catalog price; unit cost stays with managers and owners.
    expect(snapshot.items.find((item) => item.id === f.item.id)?.unitCostCents).toBe(0);
    expect(snapshot.summary.stockValueCents).toBe(0);
  });

  it('allows only the company administrator to set prices', async () => {
    const f = await fixture();
    const stranger = await fixture();
    const manager = await db.orm.public.User.create({
      companyId: f.company.id, fullName: varchar<120>('Manager'), role: 'inventory_manager',
      email: varchar<255>(`${randomUUID()}@test.invalid`), passwordHash: varchar<255>('unused'),
    });
    for (const user of [f.attendant, manager]) {
      await expect(service.updateSellingPrice(user.id, f.company.id, f.item.id, { sellingPriceCents: 200 }))
        .rejects.toBeInstanceOf(ForbiddenException);
    }
    await expect(service.updateSellingPrice(stranger.admin.id, stranger.company.id, f.item.id, { sellingPriceCents: 200 }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect((await db.orm.public.InventoryItem.first({ id: f.item.id }))?.sellingPriceCents).toBe(175);
  });

  it('rejects sales without a price but supports an explicit zero price', async () => {
    const f = await fixture();
    const item = await service.createItem(f.admin.id, f.company.id, {
      sku: 'UNPRICED', name: 'Unpriced', category: 'Test', unit: 'pcs',
      unitCostCents: 100, reorderLevel: 0, openingStock: 3, locationId: f.shop.id,
    });
    expect(item.sellingPriceCents).toBeNull();
    const sale = { itemId: item.id, locationId: f.shop.id, type: Type.SALE, quantity: 1, movementDate };
    await expect(service.createMovement(f.attendant.id, f.company.id, sale)).rejects.toBeInstanceOf(ConflictException);
    expect(await db.orm.public.StockMovement.where({ itemId: item.id }).all()).toHaveLength(0);
    await service.updateSellingPrice(f.admin.id, f.company.id, item.id, { sellingPriceCents: 0 });
    const sold = await service.createMovement(f.attendant.id, f.company.id, { ...sale, expectedUnitPriceCents: 0 });
    expect(sold.unitPriceCents).toBe(0);
    expect((await service.snapshot(f.attendant.id, f.company.id)).movements.find((movement) => movement.id === sold.id)?.saleTotalCents).toBe(0);
  });

  it('rejects a stale displayed price without consuming stock', async () => {
    const f = await fixture();
    await transfer(f, 5);
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 250 });
    await expect(service.createMovement(f.attendant.id, f.company.id, {
      itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 1,
      expectedUnitPriceCents: 175, movementDate,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(await balance(f, f.shop.id)).toBe(5);
  });

  it('serializes price changes with sales and never charges a different quoted price', async () => {
    const f = await fixture();
    await transfer(f, 5);
    const results = await race(f.item.id, [
      () => service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 250 }),
      () => otherService.createMovement(f.attendant.id, f.company.id, {
        itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 1,
        expectedUnitPriceCents: 175, movementDate,
      }),
    ]);
    expect(results[0]!.status).toBe('fulfilled');
    const sales = await db.orm.public.StockMovement.where({ itemId: f.item.id, type: 'sale' }).all();
    if (results[1]!.status === 'fulfilled') {
      expect(sales).toHaveLength(1);
      expect(sales[0]!.unitPriceCents).toBe(175);
      expect(await balance(f, f.shop.id)).toBe(4);
    } else {
      expect(results[1]!.reason).toBeInstanceOf(ConflictException);
      expect(sales).toHaveLength(0);
      expect(await balance(f, f.shop.id)).toBe(5);
    }
    expect((await db.orm.public.InventoryItem.first({ id: f.item.id }))?.sellingPriceCents).toBe(250);
  });

  it('leaves old unpriced sales and non-sale movements without a recorded price', async () => {
    const f = await fixture();
    const moved = await transfer(f, 5);
    expect(moved.unitPriceCents).toBeNull();
    const legacySale = await db.orm.public.StockMovement.create({
      companyId: f.company.id, itemId: f.item.id, locationId: f.shop.id, type: 'sale', quantity: 1, movementDate,
    });
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 250 });
    const snapshot = await service.snapshot(f.admin.id, f.company.id);
    expect(snapshot.movements.find((movement) => movement.id === legacySale.id))
      .toMatchObject({ unitPriceCents: null, saleTotalCents: null });
    expect(snapshot.movements.find((movement) => movement.id === moved.id)?.saleTotalCents).toBeNull();
  });

  it('includes zero-stock items in the catalog so an administrator can price them', async () => {
    const f = await fixture(0);
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 350 });
    expect((await service.snapshot(f.admin.id, f.company.id)).items.find((item) => item.id === f.item.id)?.sellingPriceCents).toBe(350);
  });

  it('records purchase cost and supplier while updating weighted average cost', async () => {
    const f = await fixture(5);
    const supplier = await service.createSupplier(f.admin.id, f.company.id, {
      name: 'Northern Foods', email: 'orders@northern.test',
    });
    const purchase = await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE,
      quantity: 5, unitCostCents: 200, supplierId: supplier.id, movementDate,
    });

    expect(purchase).toMatchObject({ unitCostCents: 200, supplierId: supplier.id });
    expect((await service.snapshot(f.admin.id, f.company.id)).items.find((entry) => entry.id === f.item.id)?.unitCostCents).toBe(150);
  });

  it('records a physical count as a protected adjustment', async () => {
    const f = await fixture(5);
    const count = await service.createStockCount(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, countedQuantity: 3,
      countedAt: movementDate, note: 'Two units missing',
    });
    const snapshot = await service.snapshot(f.admin.id, f.company.id, 30, f.warehouse.id);
    const adjustment = snapshot.movements.find((entry) => entry.stockCountId === count.id);

    expect(count).toMatchObject({ expectedQuantity: 5, countedQuantity: 3, varianceQuantity: -2 });
    expect(adjustment).toMatchObject({ type: Type.ADJUSTMENT_OUT, quantity: 2, unitCostCents: 100 });
    expect(snapshot.positions[0]?.closing).toBe(3);
    await expect(service.deleteMovement(f.admin.id, f.company.id, adjustment!.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('links customer returns to the original sale and subtracts them from profit', async () => {
    const f = await fixture(5);
    await transfer(f, 5);
    const sale = await service.createMovement(f.attendant.id, f.company.id, {
      itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 3, movementDate,
    });
    const returned = await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.shop.id, type: Type.RETURN_IN, quantity: 1,
      relatedMovementId: sale.id, movementDate,
    });
    const report = await service.profitability(f.admin.id, f.company.id, {
      days: 30, locationType: 'shop', locationId: f.shop.id,
    });
    const warehouseReport = await service.profitability(f.admin.id, f.company.id, {
      days: 30, locationType: 'warehouse', locationId: f.warehouse.id,
    });

    expect(returned).toMatchObject({ relatedMovementId: sale.id, unitPriceCents: 175, unitCostCents: 100 });
    expect(report.summary).toMatchObject({ netSalesCents: 350, cogsCents: 200, grossProfitCents: 150, unitsSold: 3, unitsReturned: 1 });
    expect(warehouseReport.summary).toMatchObject({ netSalesCents: 0, grossProfitCents: 0 });
    expect(warehouseReport.lines).toEqual([]);
    await expect(service.profitability(f.admin.id, f.company.id, {
      days: 30, locationType: 'warehouse', locationId: f.shop.id,
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.shop.id, type: Type.RETURN_IN, quantity: 3,
      relatedMovementId: sale.id, movementDate,
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('archives only zero-stock items and keeps archived items out of balances', async () => {
    const f = await fixture(2);
    await expect(service.updateItem(f.admin.id, f.company.id, f.item.id, { isActive: false }))
      .rejects.toBeInstanceOf(ConflictException);
    await service.createStockCount(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, countedQuantity: 0, countedAt: movementDate, note: 'Cleared during archive count',
    });
    const archived = await service.updateItem(f.admin.id, f.company.id, f.item.id, { isActive: false });
    expect(archived?.isActive).toBe(false);
    expect((await service.snapshot(f.admin.id, f.company.id)).positions).toHaveLength(0);
  });

  it('allows only one of two sales competing for the last units', async () => {
    const f = await fixture();
    await transfer(f, 5);
    const sale = {
      itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 4, movementDate,
    };
    const results = await race(f.item.id, [
      () => service.createMovement(f.attendant.id, f.company.id, sale),
      () => otherService.createMovement(f.attendant.id, f.company.id, sale),
    ]);
    expectOneConflict(results);
    expect(await balance(f, f.shop.id)).toBe(1);
    expect(await db.orm.public.StockMovement.where({ itemId: f.item.id, type: 'sale' }).all()).toHaveLength(1);
  });

  it('prevents concurrent transfers from overdrawing their source', async () => {
    const f = await fixture();
    const body = {
      itemId: f.item.id, locationId: f.warehouse.id, destinationLocationId: f.shop.id,
      type: Type.TRANSFER, quantity: 4, movementDate,
    };
    expectOneConflict(await race(f.item.id, [
      () => service.createMovement(f.admin.id, f.company.id, body),
      () => otherService.createMovement(f.admin.id, f.company.id, body),
    ]));
    expect(await balance(f, f.warehouse.id)).toBe(1);
    expect(await balance(f, f.shop.id)).toBe(4);
  });

  it('prevents deleting two receipts when remaining stock depends on one', async () => {
    const f = await fixture(0);
    const receipt = {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE, quantity: 5, unitCostCents: 100, movementDate,
    };
    const first = await service.createMovement(f.admin.id, f.company.id, receipt);
    const second = await service.createMovement(f.admin.id, f.company.id, receipt);
    await service.createMovement(f.admin.id, f.company.id, { ...receipt, type: Type.DAMAGE, note: 'Damaged in storage' });
    expectOneConflict(await race(f.item.id, [
      () => service.deleteMovement(f.admin.id, f.company.id, first.id),
      () => otherService.deleteMovement(f.admin.id, f.company.id, second.id),
    ]));
    expect(await balance(f, f.warehouse.id)).toBe(0);
  });

  it('serializes removal of a transfer against a sale at its destination', async () => {
    const f = await fixture();
    const moved = await transfer(f, 5);
    const results = await race(f.item.id, [
      () => service.deleteMovement(f.admin.id, f.company.id, moved.id),
      () => otherService.createMovement(f.attendant.id, f.company.id, {
        itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 5, movementDate,
      }),
    ]);
    expectOneConflict(results);
    expect(await balance(f, f.shop.id)).toBe(0);
    expect(await balance(f, f.warehouse.id)).toBe(results[0]!.status === 'fulfilled' ? 5 : 0);
  });

  it('reports a second deletion as missing after waiting for the first', async () => {
    const f = await fixture();
    const moved = await transfer(f, 5);
    const results = await race(f.item.id, [
      () => service.deleteMovement(f.admin.id, f.company.id, moved.id),
      () => otherService.deleteMovement(f.admin.id, f.company.id, moved.id),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(NotFoundException);
    expect(await balance(f, f.warehouse.id)).toBe(5);
  });

  it('releases the lock after rejecting an overdraw, allowing a valid movement', async () => {
    const f = await fixture();
    const body = { itemId: f.item.id, locationId: f.warehouse.id, type: Type.DAMAGE, quantity: 6, movementDate, note: 'Damaged in storage' };
    await expect(service.createMovement(f.admin.id, f.company.id, body)).rejects.toBeInstanceOf(ConflictException);
    await otherService.createMovement(f.admin.id, f.company.id, { ...body, quantity: 5 });
    expect(await balance(f, f.warehouse.id)).toBe(0);
  });

  it('does not permit another company to write or delete item movements', async () => {
    const f = await fixture();
    const stranger = await fixture();
    const moved = await transfer(f, 5);
    await expect(service.createMovement(stranger.admin.id, stranger.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE, quantity: 10, movementDate,
    })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteMovement(stranger.admin.id, stranger.company.id, moved.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await balance(f, f.shop.id)).toBe(5);
  });

  it('keeps an attendant sale at their assigned shop and forbids deleting movements', async () => {
    const f = await fixture();
    await transfer(f, 5);
    const sold = await service.createMovement(f.attendant.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.SALE, quantity: 1, movementDate,
    });
    expect(sold.locationId).toBe(f.shop.id);
    await expect(service.deleteMovement(f.attendant.id, f.company.id, sold.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await balance(f, f.shop.id)).toBe(4);
  });

  it('rolls back the item if its opening balance fails database validation', async () => {
    const f = await fixture();
    await expect(service.createItem(f.admin.id, f.company.id, {
      sku: 'ROLLBACK-ITEM', name: 'Invalid opening stock', category: 'Test', unit: 'pcs',
      unitCostCents: 100, reorderLevel: 0, openingStock: -1, locationId: f.warehouse.id,
    })).rejects.toThrow();
    expect(await db.orm.public.InventoryItem.where({ companyId: f.company.id }).all()).toHaveLength(1);
  });

  it('imports a spreadsheet catalog and its opening balances together', async () => {
    const f = await fixture();
    const result = await service.importItems(f.admin.id, f.company.id, {
      locationId: f.warehouse.id,
      rows: [
        { sku: ' bulk-1 ', name: 'Imported rice', category: 'Grocery', unit: 'bag', reorderLevel: 10, unitCostCents: 1250, sellingPriceCents: 1800, openingStock: 24 },
        { sku: 'BULK-2', name: 'Imported oil', category: 'Grocery', unit: 'bottle', reorderLevel: 8, unitCostCents: 700, openingStock: 16 },
      ],
    });
    expect(result).toEqual({ imported: 2 });
    const snapshot = await service.snapshot(f.admin.id, f.company.id, 30, f.warehouse.id);
    expect(snapshot.positions.find((position) => position.item.sku === 'BULK-1')).toMatchObject({
      closing: 24,
      item: { name: 'Imported rice', sellingPriceCents: 1800 },
    });
    expect(snapshot.positions.find((position) => position.item.sku === 'BULK-2')).toMatchObject({
      closing: 16,
      item: { name: 'Imported oil', sellingPriceCents: null },
    });
  });

  it('creates readable unique item codes when an owner does not supply them', async () => {
    const f = await fixture();
    const manuallyAdded = await service.createItem(f.admin.id, f.company.id, {
      name: 'Manual item', category: 'Test', unit: 'pcs', unitCostCents: 100,
      reorderLevel: 0, openingStock: 1, locationId: f.warehouse.id,
    });
    expect(manuallyAdded.sku).toBe('SKU-0001');

    await service.importItems(f.admin.id, f.company.id, {
      locationId: f.warehouse.id,
      rows: [
        { name: 'Fresh tomatoes crate', category: 'Produce', unit: 'crate', reorderLevel: 2, unitCostCents: 500, openingStock: 4 },
        { name: 'Fresh tomatoes basket', category: 'Produce', unit: 'basket', reorderLevel: 1, unitCostCents: 300, openingStock: 2 },
      ],
    });
    const items = await db.orm.public.InventoryItem.where({ companyId: f.company.id }).all();
    expect(items.map((item) => item.sku)).toEqual(expect.arrayContaining(['SKU-0002', 'SKU-0003']));
  });

  it('applies workspace defaults when a new item omits optional inventory fields', async () => {
    const f = await fixture();
    await db.orm.public.Company.where({ id: f.company.id }).update({
      defaultLocationId: f.shop.id,
      defaultUnit: varchar<20>('carton'),
      defaultReorderLevel: 6,
      skuPrefix: varchar<12>('PRD'),
      nextSkuNumber: 42,
    });

    const item = await service.createItem(f.admin.id, f.company.id, {
      name: 'Defaulted product', category: 'Test', unitCostCents: 250, openingStock: 3,
    });
    const company = await db.orm.public.Company.first({ id: f.company.id });
    const stock = await db.orm.public.LocationStock.first({ companyId: f.company.id, itemId: item.id });

    expect(item).toMatchObject({ sku: 'PRD-0042', unit: 'carton', reorderLevel: 6 });
    expect(stock).toMatchObject({ locationId: f.shop.id, openingStock: 3 });
    expect(company?.nextSkuNumber).toBe(43);
  });

  it('enforces purchase, adjustment, and negative-stock policies in the ledger', async () => {
    const f = await fixture(2);
    await db.orm.public.Company.where({ id: f.company.id }).update({
      requirePurchaseSource: true,
      requireAdjustmentReason: true,
      allowNegativeStock: false,
    });

    await expect(service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE,
      quantity: 1, unitCostCents: 100, movementDate,
    })).rejects.toThrow('Choose a supplier or add a purchase reference');
    await expect(service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.DAMAGE, quantity: 1, movementDate,
    })).rejects.toThrow('Add a reason for damaged stock');
    await expect(service.createStockCount(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, countedQuantity: 1, countedAt: movementDate,
    })).rejects.toThrow('Add a reason for this stock adjustment');
    await expect(service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.DAMAGE,
      quantity: 3, movementDate, note: 'Spoiled',
    })).rejects.toBeInstanceOf(ConflictException);

    await db.orm.public.Company.where({ id: f.company.id }).update({ allowNegativeStock: true });
    await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.DAMAGE,
      quantity: 3, movementDate, note: 'Spoiled',
    });
    expect(await balance(f, f.warehouse.id)).toBe(-1);
  });

  it('serializes automatic item codes created at the same time', async () => {
    const f = await fixture();
    const body = {
      name: 'Cooking oil', category: 'Grocery', unit: 'bottle', unitCostCents: 700,
      reorderLevel: 3, openingStock: 8, locationId: f.warehouse.id,
    };

    const [first, second] = await Promise.all([
      service.createItem(f.admin.id, f.company.id, body),
      otherService.createItem(f.admin.id, f.company.id, { ...body, name: 'Cooking oil 5L' }),
    ]);
    expect(new Set([first.sku, second.sku])).toEqual(new Set(['SKU-0001', 'SKU-0002']));
  });

  it('keeps one active item per name so a top-up does not split stock', async () => {
    const f = await fixture();
    const item = { category: 'Test', unit: 'pcs', unitCostCents: 100, reorderLevel: 0, openingStock: 1, locationId: f.warehouse.id };
    await expect(service.createItem(f.admin.id, f.company.id, { ...item, name: '  test   ITEM ' }))
      .rejects.toThrow('Test item already exists (TEST-ITEM). To add more of it, record a purchase.');
    await expect(service.importItems(f.admin.id, f.company.id, {
      locationId: f.warehouse.id,
      rows: [{ name: 'Test item', category: 'Test', unit: 'pcs', reorderLevel: 0, unitCostCents: 10, openingStock: 1 }],
    })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.importItems(f.admin.id, f.company.id, {
      locationId: f.warehouse.id,
      rows: [
        { name: 'Rice', category: 'Test', unit: 'bag', reorderLevel: 0, unitCostCents: 10, openingStock: 1 },
        { name: 'rice', category: 'Test', unit: 'bag', reorderLevel: 0, unitCostCents: 10, openingStock: 1 },
      ],
    })).rejects.toThrow('Rice appears more than once in the spreadsheet');

    const other = await service.createItem(f.admin.id, f.company.id, { ...item, name: 'Test item 5L' });
    await expect(service.updateItem(f.admin.id, f.company.id, other.id, { name: 'Test Item' })).rejects.toBeInstanceOf(ConflictException);
    await service.updateItem(f.admin.id, f.company.id, other.id, { name: 'test item 5l', category: 'Renamed' });

    // An archived item no longer blocks its name, but bringing it back would make a pair.
    await service.createMovement(f.admin.id, f.company.id, { itemId: other.id, locationId: f.warehouse.id, type: Type.DAMAGE, quantity: 1, movementDate, note: 'Gone' });
    await service.updateItem(f.admin.id, f.company.id, other.id, { isActive: false });
    const replacement = await service.createItem(f.admin.id, f.company.id, { ...item, name: 'Test item 5L' });
    await expect(service.updateItem(f.admin.id, f.company.id, other.id, { isActive: true })).rejects.toBeInstanceOf(ConflictException);
    expect(replacement.name).toBe('Test item 5L');
  });

  it('rejects duplicate spreadsheet SKUs before writing any rows', async () => {
    const f = await fixture();
    await expect(service.importItems(f.admin.id, f.company.id, {
      locationId: f.warehouse.id,
      rows: [
        { sku: 'DUPLICATE', name: 'First', category: 'Test', unit: 'pcs', reorderLevel: 0, unitCostCents: 10, openingStock: 1 },
        { sku: 'duplicate', name: 'Second', category: 'Test', unit: 'pcs', reorderLevel: 0, unitCostCents: 10, openingStock: 1 },
      ],
    })).rejects.toBeInstanceOf(ConflictException);
    expect(await db.orm.public.InventoryItem.where({ companyId: f.company.id }).all()).toHaveLength(1);
  });

  it('keeps spreadsheet import under administrator control', async () => {
    const f = await fixture();
    await expect(service.importItems(f.attendant.id, f.company.id, {
      locationId: f.shop.id,
      rows: [{ sku: 'STAFF-BULK', name: 'Staff item', category: 'Test', unit: 'pcs', reorderLevel: 0, unitCostCents: 10, openingStock: 1 }],
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(await db.orm.public.InventoryItem.where({ companyId: f.company.id }).all()).toHaveLength(1);
  });

  it('rolls back the whole spreadsheet when an opening balance fails', async () => {
    const f = await fixture();
    await expect(service.importItems(f.admin.id, f.company.id, {
      locationId: f.warehouse.id,
      rows: [
        { sku: 'ROLLBACK-BULK-1', name: 'Valid first row', category: 'Test', unit: 'pcs', reorderLevel: 0, unitCostCents: 10, openingStock: 1 },
        { sku: 'ROLLBACK-BULK-2', name: 'Invalid second row', category: 'Test', unit: 'pcs', reorderLevel: 0, unitCostCents: 10, openingStock: -1 },
      ],
    })).rejects.toThrow();
    expect(await db.orm.public.InventoryItem.where({ companyId: f.company.id }).all()).toHaveLength(1);
  });

  it('lets a different item change while another item is locked', async () => {
    const lockedFixture = await fixture();
    const f = await fixture();
    await db.transaction(async (tx) => {
      await tx.query(db.raw.sql`
        SELECT id FROM public.inventory_items WHERE id = ${lockedFixture.item.id}::uuid FOR UPDATE
      `.returnsRow({ id: 'pg/uuid@1' }).build());
      await otherService.createMovement(f.admin.id, f.company.id, {
        itemId: f.item.id, locationId: f.warehouse.id, type: Type.DAMAGE, quantity: 1, movementDate, note: 'Damaged in storage',
      });
    });
    expect(await balance(f, f.warehouse.id)).toBe(4);
  });

  it('lets the application role see only the company set on its transaction', async () => {
    const firstCompany = await fixture();
    const secondCompany = await fixture();

    const withoutContext = await asApplicationRole(null, (tx) => tx.orm.public.InventoryItem.all());
    expect(withoutContext).toEqual([]);

    const firstItems = await asApplicationRole(firstCompany.company.id, (tx) => tx.orm.public.InventoryItem.all());
    expect(firstItems.map((item) => item.id)).toEqual([firstCompany.item.id]);

    const secondItems = await asApplicationRole(secondCompany.company.id, (tx) => tx.orm.public.InventoryItem.all());
    expect(secondItems.map((item) => item.id)).toEqual([secondCompany.item.id]);
  });

  it('applies tenant isolation to suppliers and stock counts', async () => {
    const firstCompany = await fixture();
    const secondCompany = await fixture();
    const firstSupplier = await service.createSupplier(firstCompany.admin.id, firstCompany.company.id, { name: 'First supplier' });
    await service.createSupplier(secondCompany.admin.id, secondCompany.company.id, { name: 'Second supplier' });
    const firstCount = await service.createStockCount(firstCompany.admin.id, firstCompany.company.id, {
      itemId: firstCompany.item.id, locationId: firstCompany.warehouse.id,
      countedQuantity: 5, countedAt: movementDate,
    });
    await service.createStockCount(secondCompany.admin.id, secondCompany.company.id, {
      itemId: secondCompany.item.id, locationId: secondCompany.warehouse.id,
      countedQuantity: 5, countedAt: movementDate,
    });

    const suppliers = await asApplicationRole(firstCompany.company.id, (tx) => tx.orm.public.Supplier.all());
    const counts = await asApplicationRole(firstCompany.company.id, (tx) => tx.orm.public.StockCount.all());
    expect(suppliers.map((entry) => entry.id)).toEqual([firstSupplier.id]);
    expect(counts.map((entry) => entry.id)).toEqual([firstCount.id]);
  });

  it('rejects an application-role write for another company', async () => {
    const firstCompany = await fixture();
    const secondCompany = await fixture();

    await expect(asApplicationRole(firstCompany.company.id, (tx) => tx.orm.public.InventoryItem.create({
      companyId: secondCompany.company.id,
      sku: varchar<40>('CROSS-TENANT'),
      name: varchar<120>('Cross tenant item'),
      category: varchar<80>('Test'),
      unit: varchar<20>('pcs'),
      reorderLevel: 0,
      unitCostCents: 1,
      sellingPriceCents: null,
    }))).rejects.toThrow();

    expect(await db.orm.public.InventoryItem.where({ sku: varchar<40>('CROSS-TENANT') }).all()).toHaveLength(0);
  });

  it('rejects mixed-company stock, movement, and staff location relationships', async () => {
    const firstCompany = await fixture();
    const secondCompany = await fixture();

    await expect(db.orm.public.LocationStock.create({
      companyId: firstCompany.company.id,
      locationId: secondCompany.shop.id,
      itemId: firstCompany.item.id,
      openingStock: 1,
    })).rejects.toThrow();

    await expect(db.orm.public.StockMovement.create({
      companyId: firstCompany.company.id,
      itemId: firstCompany.item.id,
      locationId: firstCompany.warehouse.id,
      destinationLocationId: secondCompany.shop.id,
      type: 'transfer',
      quantity: 1,
      movementDate,
    })).rejects.toThrow();

    await expect(db.orm.public.User.create({
      companyId: firstCompany.company.id,
      locationId: secondCompany.shop.id,
      fullName: varchar<120>('Cross tenant attendant'),
      email: varchar<255>(`${randomUUID()}@test.invalid`),
      passwordHash: varchar<255>('unused'),
      role: 'shop_attendant',
    })).rejects.toThrow();
  });

  it('records price, import, and movement-deletion audit events in the same tenant', async () => {
    const f = await fixture();
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 225 });
    await service.importItems(f.admin.id, f.company.id, {
      locationId: f.warehouse.id,
      rows: [{ sku: 'AUDIT-IMPORT', name: 'Audited item', category: 'Test', unit: 'pcs', reorderLevel: 0, unitCostCents: 10, openingStock: 2 }],
    });
    const receipt = await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE, quantity: 1, unitCostCents: 100, movementDate,
    });
    await service.deleteMovement(f.admin.id, f.company.id, receipt.id);

    const events = await db.orm.public.AuditEvent.where({ companyId: f.company.id }).all();
    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining([
      'inventory.selling_price_changed',
      'inventory.items_imported',
      'inventory.movement_deleted',
    ]));
    expect(events.find((event) => event.action === 'inventory.selling_price_changed')?.metadata)
      .toEqual({ previousSellingPriceCents: 175, sellingPriceCents: 225 });
  });

  it('exports only the administrator company data and audits the download', async () => {
    const firstCompany = await fixture();
    const secondCompany = await fixture();
    await service.createItem(secondCompany.admin.id, secondCompany.company.id, {
      sku: 'SECOND-ONLY', name: 'Other company item', category: 'Private', unit: 'pcs',
      unitCostCents: 800, sellingPriceCents: 1000, reorderLevel: 2, openingStock: 4,
      locationId: secondCompany.warehouse.id,
    });

    const exported = await exportsService.create(
      firstCompany.admin.id,
      firstCompany.company.id,
      DataExportType.INVENTORY,
    );

    expect(exported.filename).toMatch(/^stockledger-inventory-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(exported.content).toContain('TEST-ITEM');
    expect(exported.content).not.toContain('SECOND-ONLY');
    expect(await db.orm.public.AuditEvent.first({
      companyId: firstCompany.company.id,
      action: varchar<80>('data.exported'),
    })).toMatchObject({ metadata: { type: 'inventory', rowCount: 1 } });
  });

  it('exports a portable workspace archive without password or session secrets', async () => {
    const f = await fixture();
    await db.orm.public.RefreshSession.create({
      companyId: f.company.id,
      userId: f.admin.id,
      tokenHash: varchar<64>('e'.repeat(64)),
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const exported = await exportsService.create(f.admin.id, f.company.id, DataExportType.WORKSPACE);
    const archive = JSON.parse(exported.content) as Record<string, unknown>;

    expect(exported).toMatchObject({
      filename: expect.stringMatching(/^stockledger-workspace-\d{4}-\d{2}-\d{2}\.json$/),
      contentType: 'application/json; charset=utf-8',
    });
    expect(archive).toMatchObject({ format: 'stockledger-workspace-v1', company: { id: f.company.id } });
    expect(exported.content).not.toContain('passwordHash');
    expect(exported.content).not.toContain('tokenHash');
  });

  it('keeps data exports under administrator control', async () => {
    const f = await fixture();

    await expect(exportsService.create(f.attendant.id, f.company.id, DataExportType.MOVEMENTS))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(await db.orm.public.AuditEvent.where({
      companyId: f.company.id,
      action: varchar<80>('data.exported'),
    }).all()).toEqual([]);
  });

  it('isolates refresh sessions and audit records under the application role', async () => {
    const firstCompany = await fixture();
    const secondCompany = await fixture();
    await asApplicationRole(firstCompany.company.id, async (tx) => {
      await tx.orm.public.RefreshSession.create({
        companyId: firstCompany.company.id,
        userId: firstCompany.admin.id,
        tokenHash: varchar<64>('a'.repeat(64)),
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
      await tx.orm.public.AuditEvent.create({
        companyId: firstCompany.company.id,
        actorUserId: firstCompany.admin.id,
        action: varchar<80>('test.created'),
        entityType: varchar<80>('test'),
        entityId: null,
        metadata: { source: 'integration' },
      });
    });

    expect(await asApplicationRole(secondCompany.company.id, (tx) => tx.orm.public.RefreshSession.all())).toEqual([]);
    const visibleAudit = await asApplicationRole(secondCompany.company.id, (tx) => tx.orm.public.AuditEvent.all());
    expect(visibleAudit.every((event) => event.companyId === secondCompany.company.id)).toBe(true);
    expect(visibleAudit.some((event) => event.action === 'test.created')).toBe(false);
    await asApplicationRole(firstCompany.company.id, (tx) => tx.orm.public.AuditEvent.where({ companyId: firstCompany.company.id }).delete());
    expect(await db.orm.public.AuditEvent.first({
      companyId: firstCompany.company.id,
      action: varchar<80>('test.created'),
    })).not.toBeNull();
  });

  it('deletes a populated workspace through the restricted application role', async () => {
    const f = await fixture(10);
    const other = await fixture();
    await service.updateSellingPrice(f.admin.id, f.company.id, f.item.id, { sellingPriceCents: 1500 });
    await pricingPreview([f.company.id]).update(f.admin.id, f.company.id, f.item.id, previewConfig);
    const passwordHash = await argon2.hash('DeleteThisWorkspace123!');
    await db.orm.public.User.where({ id: f.admin.id, companyId: f.company.id }).update({
      passwordHash: varchar<255>(passwordHash),
    });
    const supplier = await service.createSupplier(f.admin.id, f.company.id, { name: 'Deletion supplier' });
    await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id,
      locationId: f.warehouse.id,
      type: Type.PURCHASE,
      quantity: 2,
      unitCostCents: 110,
      supplierId: supplier.id,
      movementDate,
    });
    await service.createStockCount(f.admin.id, f.company.id, {
      itemId: f.item.id,
      locationId: f.warehouse.id,
      countedQuantity: 12,
      countedAt: movementDate,
    });
    await db.orm.public.RefreshSession.create({
      companyId: f.company.id,
      userId: f.admin.id,
      tokenHash: varchar<64>('d'.repeat(64)),
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const runtimeSettings = new SettingsService({
      client: db,
      withCompany: <T>(companyId: string, work: (tx: TestTransaction) => Promise<T>) => asApplicationRole(companyId, work),
    } as PrismaService);
    await expect(runtimeSettings.deleteWorkspace(f.admin.id, f.company.id, {
      currentPassword: 'DeleteThisWorkspace123!',
      confirmation: 'Concurrency test',
    })).resolves.toEqual({ deleted: true });

    expect(await db.orm.public.Company.first({ id: f.company.id })).toBeNull();
    expect(await db.orm.public.Location.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.User.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.InventoryItem.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.ItemPricingVersion.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.Supplier.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.LocationStock.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.StockMovement.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.StockCount.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.RefreshSession.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.AuditEvent.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.Company.first({ id: other.company.id })).not.toBeNull();
  });
});

describe('legacy valuation baseline before prospective costing enrollment', () => {
  it('preserves existing cent-rounded receipt valuation and original sale costs', async () => {
    const f = await fixture(1);
    const purchase = await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE,
      quantity: 2, unitCostCents: 101, movementDate,
    });
    const snapshot = await service.snapshot(f.admin.id, f.company.id);
    expect(purchase.unitCostCents).toBe(101);
    expect(snapshot.items[0]?.unitCostCents).toBe(101);
    expect(snapshot.positions.reduce((sum, p) => sum + p.closing, 0)).toBe(3);
    // Characterize the existing one-cent difference; future precision must be opt-in.
    expect(snapshot.positions.reduce((sum, p) => sum + p.valueCents, 0)).toBe(303);
    await transfer(f, 3);
    const sale = await service.createMovement(f.attendant.id, f.company.id, {
      itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 3, movementDate,
    });
    expect(sale.unitCostCents).toBe(101);
    expect(await balance(f, f.shop.id)).toBe(0);
    expect(await db.orm.public.StockMovement.first({ id: purchase.id })).toEqual(purchase);
    expect(await db.orm.public.StockMovement.first({ id: sale.id })).toEqual(sale);
  });

  it('preserves the legacy average after an original-cost return following a more expensive receipt', async () => {
    const f = await fixture(2); await transfer(f, 2);
    const sale = await service.createMovement(f.attendant.id, f.company.id, {
      itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 1, movementDate,
    });
    await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE,
      quantity: 1, unitCostCents: 300, movementDate,
    });
    const returned = await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.shop.id, type: Type.RETURN_IN,
      relatedMovementId: sale.id, quantity: 1, movementDate,
    });
    const snapshot = await service.snapshot(f.admin.id, f.company.id);
    expect(returned.unitCostCents).toBe(100);
    expect(snapshot.items[0]?.unitCostCents).toBe(200);
    expect(snapshot.positions.reduce((sum, p) => sum + p.closing, 0)).toBe(3);
    expect(snapshot.positions.reduce((sum, p) => sum + p.valueCents, 0)).toBe(600);
    expect(await db.orm.public.StockMovement.first({ id: sale.id })).toEqual(sale);
  });

  it('preserves the legacy current average when an unconsumed receipt is removed', async () => {
    const f = await fixture(1);
    const purchase = await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE,
      quantity: 1, unitCostCents: 300, movementDate,
    });
    await service.deleteMovement(f.admin.id, f.company.id, purchase.id);
    const snapshot = await service.snapshot(f.admin.id, f.company.id);
    expect(await db.orm.public.StockMovement.first({ id: purchase.id })).toBeNull();
    expect(snapshot.items[0]?.unitCostCents).toBe(200);
    expect(snapshot.positions.reduce((sum, p) => sum + p.closing, 0)).toBe(1);
    expect(snapshot.positions.reduce((sum, p) => sum + p.valueCents, 0)).toBe(200);
  });
});

describe('dated stock checks with PostgreSQL', () => {
  const outbound = (f: Awaited<ReturnType<typeof fixture>>, quantity: number, date: string) => service.createMovement(f.admin.id, f.company.id, {
    itemId: f.item.id, locationId: f.warehouse.id, type: Type.DAMAGE, quantity, movementDate: date, note: 'Dated check',
  });
  const purchase = (f: Awaited<ReturnType<typeof fixture>>, quantity: number, date: string) => service.createMovement(f.admin.id, f.company.id, {
    itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE, quantity, unitCostCents: 100, movementDate: date,
  });

  it('rejects a backdated outbound movement that only fits because of a later receipt', async () => {
    const f = await fixture(0);
    await purchase(f, 5, '2026-09-20');
    await expect(outbound(f, 3, '2026-09-10')).rejects.toThrow('Only 0 pcs available');
    await expect(outbound(f, 3, '2026-09-21')).resolves.toMatchObject({ quantity: 3 });
  });

  it('refuses to delete a receipt that an earlier outbound movement relied on', async () => {
    const f = await fixture(0);
    const first = await purchase(f, 5, '2026-09-01');
    await outbound(f, 3, '2026-09-05');
    await purchase(f, 5, '2026-09-10');
    await expect(service.deleteMovement(f.admin.id, f.company.id, first.id)).rejects.toThrow('Later movements depend on this stock');
  });

  it('compares a backdated count with the ledger on its own date', async () => {
    const f = await fixture(5);
    await purchase(f, 4, '2026-09-20');
    const count = await service.createStockCount(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, countedQuantity: 5, countedAt: '2026-09-15',
    });
    expect(count).toMatchObject({ expectedQuantity: 5, varianceQuantity: 0 });
  });
});

describe('paged movement ledger with PostgreSQL', () => {
  it('pages the full history and filters by movement type', async () => {
    const f = await fixture(10);
    for (const quantity of [1, 2, 3]) {
      await service.createMovement(f.admin.id, f.company.id, {
        itemId: f.item.id, locationId: f.warehouse.id, type: Type.DAMAGE, quantity, movementDate, note: 'Ledger page',
      });
    }
    const first = await service.movementLedger(f.admin.id, f.company.id, { offset: 0, limit: 2 });
    expect(first.total).toBe(3);
    expect(first.movements.map((movement) => movement.quantity)).toEqual([3, 2]);
    const rest = await service.movementLedger(f.admin.id, f.company.id, { offset: 2, limit: 2 });
    expect(rest.movements.map((movement) => movement.quantity)).toEqual([1]);
    expect((await service.movementLedger(f.admin.id, f.company.id, { type: Type.PURCHASE, offset: 0, limit: 50 })).total).toBe(0);
    await expect(service.movementLedger(f.attendant.id, f.company.id, { offset: 0, limit: 50 })).rejects.toThrow('Shop attendants cannot manage inventory operations');
  });

  it('lists only sales that still have units to return', async () => {
    const f = await fixture(10);
    await service.createMovement(f.admin.id, f.company.id, {
      itemId: f.item.id, locationId: f.warehouse.id, destinationLocationId: f.shop.id, type: Type.TRANSFER, quantity: 5, movementDate,
    });
    const body = { itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 2, movementDate };
    const partly = await service.createMovement(f.attendant.id, f.company.id, body);
    const fully = await service.createMovement(f.attendant.id, f.company.id, body);
    for (const [sale, quantity] of [[partly, 1], [fully, 2]] as const) {
      await service.createMovement(f.admin.id, f.company.id, {
        itemId: f.item.id, locationId: f.shop.id, type: Type.RETURN_IN, relatedMovementId: sale.id, quantity, movementDate,
      });
    }
    const returnable = await service.returnableSales(f.admin.id, f.company.id);
    expect(returnable.map((sale) => [sale.id, sale.returnableQuantity])).toEqual([[partly.id, 1]]);
  });
});
