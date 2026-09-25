import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import postgres from '@prisma/orm-postgres/runtime';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import * as argon2 from 'argon2';
import { afterAll, describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d.js';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/modules/inventory/inventory.service.js';
import { StockMovementType as Type } from '../src/modules/inventory/inventory.types.js';
import { DataExportService } from '../src/modules/settings/data-export.service.js';
import { DataExportType } from '../src/modules/settings/data-export.types.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';

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
  return {
    client,
    withCompany: async <T>(companyId: string, work: (tx: TestTransaction) => Promise<T>) =>
      client.transaction(async (tx) => {
        await tx.query(client.raw.sql`
          SELECT set_config('app.current_company_id', ${companyId}, true) AS company_id
        `.returnsRow({ company_id: 'pg/text@1' }).build());
        return work(tx);
      }),
  } as PrismaService;
}
const service = new InventoryService(tenantPrisma(db));
const otherService = new InventoryService(tenantPrisma(otherDb));
const exportsService = new DataExportService(tenantPrisma(db));
const varchar = <N extends number>(value: string) => value as Varchar<N>;
const movementDate = '2026-09-23';

async function asApplicationRole<T>(companyId: string | null, work: (tx: TestTransaction) => Promise<T>) {
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

describe('inventory transactions with PostgreSQL', () => {
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
    expect(snapshot.items.find((item) => item.id === f.item.id)?.unitCostCents).toBe(100);
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
      itemId: f.item.id, locationId: f.warehouse.id, countedQuantity: 0, countedAt: movementDate,
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
    await service.createMovement(f.admin.id, f.company.id, { ...receipt, type: Type.DAMAGE });
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
    const body = { itemId: f.item.id, locationId: f.warehouse.id, type: Type.DAMAGE, quantity: 6, movementDate };
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
      name: 'Test item', category: 'Test', unit: 'pcs', unitCostCents: 100,
      reorderLevel: 0, openingStock: 1, locationId: f.warehouse.id,
    });
    expect(manuallyAdded.sku).toBe('TEST-ITEM-2');

    await service.importItems(f.admin.id, f.company.id, {
      locationId: f.warehouse.id,
      rows: [
        { name: 'Fresh tomatoes', category: 'Produce', unit: 'crate', reorderLevel: 2, unitCostCents: 500, openingStock: 4 },
        { name: 'Fresh tomatoes', category: 'Produce', unit: 'basket', reorderLevel: 1, unitCostCents: 300, openingStock: 2 },
      ],
    });
    const items = await db.orm.public.InventoryItem.where({ companyId: f.company.id }).all();
    expect(items.map((item) => item.sku)).toEqual(expect.arrayContaining(['FRESH-TOMATOES', 'FRESH-TOMATOES-2']));
  });

  it('serializes automatic item codes created at the same time', async () => {
    const f = await fixture();
    const body = {
      name: 'Cooking oil', category: 'Grocery', unit: 'bottle', unitCostCents: 700,
      reorderLevel: 3, openingStock: 8, locationId: f.warehouse.id,
    };

    const [first, second] = await Promise.all([
      service.createItem(f.admin.id, f.company.id, body),
      otherService.createItem(f.admin.id, f.company.id, body),
    ]);
    expect(new Set([first.sku, second.sku])).toEqual(new Set(['COOKING-OIL', 'COOKING-OIL-2']));
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
        itemId: f.item.id, locationId: f.warehouse.id, type: Type.DAMAGE, quantity: 1, movementDate,
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
    expect(exported.csv).toContain('TEST-ITEM');
    expect(exported.csv).not.toContain('SECOND-ONLY');
    expect(await db.orm.public.AuditEvent.first({
      companyId: firstCompany.company.id,
      action: varchar<80>('data.exported'),
    })).toMatchObject({ metadata: { type: 'inventory', rowCount: 1 } });
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
    expect(await asApplicationRole(secondCompany.company.id, (tx) => tx.orm.public.AuditEvent.all())).toEqual([]);
    await asApplicationRole(firstCompany.company.id, (tx) => tx.orm.public.AuditEvent.where({ companyId: firstCompany.company.id }).delete());
    expect(await db.orm.public.AuditEvent.first({
      companyId: firstCompany.company.id,
      action: varchar<80>('test.created'),
    })).not.toBeNull();
  });

  it('deletes a populated workspace through the restricted application role', async () => {
    const f = await fixture(10);
    const other = await fixture();
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
    expect(await db.orm.public.Supplier.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.LocationStock.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.StockMovement.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.StockCount.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.RefreshSession.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.AuditEvent.where({ companyId: f.company.id }).all()).toEqual([]);
    expect(await db.orm.public.Company.first({ id: other.company.id })).not.toBeNull();
  });
});
