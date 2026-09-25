import { describe, expect, it } from 'vitest';
import { buildSnapshot, type ItemRecord, type LocationRecord, type MovementRecord } from './inventory-calculations.js';
import { StockMovementType } from './inventory.types.js';

const warehouse: LocationRecord = { id: 'warehouse', name: 'Main warehouse', type: 'warehouse' };
const shop: LocationRecord = { id: 'shop', name: 'Main shop', type: 'shop' };
const item: ItemRecord = {
  id: 'item-1',
  sku: 'SKU-1',
  name: 'Rice',
  category: 'Grocery',
  unit: 'bag',
  reorderLevel: 10,
  unitCostCents: 1250,
  sellingPriceCents: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const movement = (
  type: StockMovementType,
  quantity: number,
  locationId = warehouse.id,
  destinationLocationId: string | null = null,
): MovementRecord => ({
  id: `${type}-${locationId}-${quantity}`,
  itemId: item.id,
  locationId,
  destinationLocationId,
  type,
  quantity,
  unitPriceCents: null,
  unitCostCents: null,
  supplierId: null,
  relatedMovementId: null,
  stockCountId: null,
  movementDate: '2026-09-10',
  reference: null,
  note: null,
  createdAt: '2026-09-10T10:00:00.000Z',
});

describe('buildSnapshot', () => {
  it('keeps a separate closing balance for each place', () => {
    const snapshot = buildSnapshot(
      [item],
      [warehouse, shop],
      [{ locationId: warehouse.id, itemId: item.id, openingStock: 20 }],
      [
        movement(StockMovementType.PURCHASE, 12),
        movement(StockMovementType.RETURN_IN, 3),
        movement(StockMovementType.TRANSFER, 8, warehouse.id, shop.id),
        movement(StockMovementType.RETURN_OUT, 2),
        movement(StockMovementType.DAMAGE, 1),
      ],
      30,
      null,
      new Date('2026-09-16T12:00:00.000Z'),
    );

    const atWarehouse = snapshot.positions.find((position) => position.location.id === warehouse.id);
    const atShop = snapshot.positions.find((position) => position.location.id === shop.id);
    expect(atWarehouse).toMatchObject({ closing: 24, valueCents: 30_000 });
    expect(atShop).toMatchObject({ closing: 8, valueCents: 10_000, opening: 0 });
    expect(snapshot.summary.closingUnits).toBe(32);
  });

  it('shows every item when a single place is selected, including an empty line', () => {
    const snapshot = buildSnapshot(
      [item],
      [warehouse, shop],
      [{ locationId: warehouse.id, itemId: item.id, openingStock: 5 }],
      [],
      30,
      shop.id,
      new Date('2026-09-16T12:00:00.000Z'),
    );

    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0]).toMatchObject({ closing: 0, isLowStock: false, location: { id: shop.id } });
  });

  it('counts only recent transfers out of the selected place', () => {
    const old = { ...movement(StockMovementType.TRANSFER, 6, warehouse.id, shop.id), movementDate: '2026-06-01' };
    const recent = movement(StockMovementType.TRANSFER, 4, warehouse.id, shop.id);
    const snapshot = buildSnapshot(
      [item],
      [warehouse],
      [{ locationId: warehouse.id, itemId: item.id, openingStock: 20 }],
      [old, recent],
      30,
      warehouse.id,
      new Date('2026-09-16T12:00:00.000Z'),
    );

    expect(snapshot.positions[0]?.transferredOut).toBe(10);
    expect(snapshot.positions[0]?.outLastPeriod).toBe(4);
  });

  it('reduces only the shop that recorded the sale', () => {
    const snapshot = buildSnapshot(
      [item],
      [warehouse, shop],
      [{ locationId: warehouse.id, itemId: item.id, openingStock: 20 }],
      [
        movement(StockMovementType.TRANSFER, 8, warehouse.id, shop.id),
        movement(StockMovementType.SALE, 3, shop.id),
      ],
      30,
      null,
      new Date('2026-09-16T12:00:00.000Z'),
    );

    const atWarehouse = snapshot.positions.find((position) => position.location.id === warehouse.id);
    const atShop = snapshot.positions.find((position) => position.location.id === shop.id);
    expect(atWarehouse).toMatchObject({ closing: 12, sales: 0 });
    expect(atShop).toMatchObject({ closing: 5, sales: 3, outLastPeriod: 3 });
    expect(snapshot.summary.closingUnits).toBe(17);
  });
});
