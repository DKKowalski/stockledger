import { describe, expect, it } from 'vitest';
import { buildSnapshot, type ItemRecord, type MovementRecord } from './inventory-calculations.js';
import { StockMovementType } from './inventory.types.js';

const item: ItemRecord = {
  id: 'item-1',
  sku: 'SKU-1',
  name: 'Rice',
  category: 'Grocery',
  unit: 'bag',
  reorderLevel: 10,
  unitCostCents: 1250,
  openingStock: 20,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const movement = (type: StockMovementType, quantity: number): MovementRecord => ({
  id: `${type}-${quantity}`,
  itemId: item.id,
  type,
  quantity,
  movementDate: '2026-09-10',
  reference: null,
  note: null,
  createdAt: '2026-09-10T10:00:00.000Z',
});

describe('buildSnapshot', () => {
  it('derives the closing balance from the immutable ledger', () => {
    const snapshot = buildSnapshot(
      [item],
      [
        movement(StockMovementType.PURCHASE, 12),
        movement(StockMovementType.RETURN_IN, 3),
        movement(StockMovementType.TRANSFER, 8),
        movement(StockMovementType.RETURN_OUT, 2),
        movement(StockMovementType.DAMAGE, 1),
      ],
      30,
      new Date('2026-09-16T12:00:00.000Z'),
    );

    expect(snapshot.positions[0]).toMatchObject({ closing: 24, valueCents: 30_000 });
  });

  it('excludes old shop transfers from the selected report period', () => {
    const old = { ...movement(StockMovementType.TRANSFER, 6), movementDate: '2026-06-01' };
    const recent = movement(StockMovementType.TRANSFER, 4);
    const snapshot = buildSnapshot(
      [item],
      [old, recent],
      30,
      new Date('2026-09-16T12:00:00.000Z'),
    );
    expect(snapshot.positions[0]?.transferred).toBe(10);
    expect(snapshot.positions[0]?.outLastPeriod).toBe(4);
  });
});
