import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import postgres from '@prisma/orm-postgres/runtime';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { afterAll, describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d.js';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/modules/inventory/inventory.service.js';
import { StockMovementType as Type } from '../src/modules/inventory/inventory.types.js';

const url = process.env.INVENTORY_TEST_DATABASE_URL;
if (!url || !/^stockledger_test_[a-f0-9]{32}$/.test(new URL(url).pathname.slice(1))
  || new URL(url).hostname !== '127.0.0.1') {
  throw new Error('Run npm run api:test:integration to provision an isolated local database');
}

// Separate pools model requests handled by separate API processes.
const db = postgres<Contract>({ contractJson, url });
const otherDb = postgres<Contract>({ contractJson, url });
const service = new InventoryService({ client: db } as PrismaService);
const otherService = new InventoryService({ client: otherDb } as PrismaService);
const varchar = <N extends number>(value: string) => value as Varchar<N>;
const movementDate = '2026-09-23';

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
  const item = await service.createItem(admin.id, {
    sku: 'TEST-ITEM', name: 'Test item', category: 'Test', unit: 'pcs',
    unitCostCents: 100, reorderLevel: 0, openingStock, locationId: warehouse.id,
  });
  return { company, warehouse, shop, admin, attendant, item };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function balance(f: Fixture, locationId: string) {
  const snapshot = await service.snapshot(f.admin.id, 30, locationId);
  return snapshot.positions.find((position) => position.item.id === f.item.id)?.closing ?? 0;
}

async function transfer(f: Fixture, quantity: number) {
  return service.createMovement(f.admin.id, {
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
  it('allows only one of two sales competing for the last units', async () => {
    const f = await fixture();
    await transfer(f, 5);
    const sale = {
      itemId: f.item.id, locationId: f.shop.id, type: Type.SALE, quantity: 4, movementDate,
    };
    const results = await race(f.item.id, [
      () => service.createMovement(f.attendant.id, sale),
      () => otherService.createMovement(f.attendant.id, sale),
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
      () => service.createMovement(f.admin.id, body),
      () => otherService.createMovement(f.admin.id, body),
    ]));
    expect(await balance(f, f.warehouse.id)).toBe(1);
    expect(await balance(f, f.shop.id)).toBe(4);
  });

  it('prevents deleting two receipts when remaining stock depends on one', async () => {
    const f = await fixture(0);
    const receipt = {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE, quantity: 5, movementDate,
    };
    const first = await service.createMovement(f.admin.id, receipt);
    const second = await service.createMovement(f.admin.id, receipt);
    await service.createMovement(f.admin.id, { ...receipt, type: Type.DAMAGE });
    expectOneConflict(await race(f.item.id, [
      () => service.deleteMovement(f.admin.id, first.id),
      () => otherService.deleteMovement(f.admin.id, second.id),
    ]));
    expect(await balance(f, f.warehouse.id)).toBe(0);
  });

  it('serializes removal of a transfer against a sale at its destination', async () => {
    const f = await fixture();
    const moved = await transfer(f, 5);
    const results = await race(f.item.id, [
      () => service.deleteMovement(f.admin.id, moved.id),
      () => otherService.createMovement(f.attendant.id, {
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
      () => service.deleteMovement(f.admin.id, moved.id),
      () => otherService.deleteMovement(f.admin.id, moved.id),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(NotFoundException);
    expect(await balance(f, f.warehouse.id)).toBe(5);
  });

  it('releases the lock after rejecting an overdraw, allowing a valid movement', async () => {
    const f = await fixture();
    const body = { itemId: f.item.id, locationId: f.warehouse.id, type: Type.DAMAGE, quantity: 6, movementDate };
    await expect(service.createMovement(f.admin.id, body)).rejects.toBeInstanceOf(ConflictException);
    await otherService.createMovement(f.admin.id, { ...body, quantity: 5 });
    expect(await balance(f, f.warehouse.id)).toBe(0);
  });

  it('does not permit another company to write or delete item movements', async () => {
    const f = await fixture();
    const stranger = await fixture();
    const moved = await transfer(f, 5);
    await expect(service.createMovement(stranger.admin.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.PURCHASE, quantity: 10, movementDate,
    })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteMovement(stranger.admin.id, moved.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await balance(f, f.shop.id)).toBe(5);
  });

  it('keeps an attendant sale at their assigned shop and forbids deleting movements', async () => {
    const f = await fixture();
    await transfer(f, 5);
    const sold = await service.createMovement(f.attendant.id, {
      itemId: f.item.id, locationId: f.warehouse.id, type: Type.SALE, quantity: 1, movementDate,
    });
    expect(sold.locationId).toBe(f.shop.id);
    await expect(service.deleteMovement(f.attendant.id, sold.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await balance(f, f.shop.id)).toBe(4);
  });

  it('rolls back the item if its opening balance fails database validation', async () => {
    const f = await fixture();
    await expect(service.createItem(f.admin.id, {
      sku: 'ROLLBACK-ITEM', name: 'Invalid opening stock', category: 'Test', unit: 'pcs',
      unitCostCents: 100, reorderLevel: 0, openingStock: -1, locationId: f.warehouse.id,
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
      await otherService.createMovement(f.admin.id, {
        itemId: f.item.id, locationId: f.warehouse.id, type: Type.DAMAGE, quantity: 1, movementDate,
      });
    });
    expect(await balance(f, f.warehouse.id)).toBe(4);
  });
});
