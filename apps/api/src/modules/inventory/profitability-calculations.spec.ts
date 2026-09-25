import { describe, expect, it } from 'vitest';
import type { ItemRecord, LocationRecord, MovementRecord } from './inventory-calculations.js';
import { buildProfitability } from './profitability-calculations.js';
import { StockMovementType } from './inventory.types.js';

const item: ItemRecord = {
  id: 'item-1',
  sku: 'RICE-1',
  name: 'Rice',
  category: 'Food',
  unit: 'bag',
  reorderLevel: 5,
  unitCostCents: 1_200,
  sellingPriceCents: 2_000,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const shop: LocationRecord = { id: 'shop-1', name: 'Main shop', type: 'shop' };

function movement(
  type: StockMovementType,
  quantity: number,
  overrides: Partial<MovementRecord> = {},
): MovementRecord {
  return {
    id: `${type}-${quantity}-${overrides.movementDate ?? '2026-09-20'}`,
    itemId: item.id,
    locationId: shop.id,
    destinationLocationId: null,
    type,
    quantity,
    unitPriceCents: null,
    unitCostCents: null,
    supplierId: null,
    relatedMovementId: null,
    stockCountId: null,
    movementDate: '2026-09-20',
    reference: null,
    note: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('buildProfitability', () => {
  it('subtracts linked customer returns from sales and cost of goods', () => {
    const report = buildProfitability(
      [item],
      [shop],
      [
        movement(StockMovementType.SALE, 5, { unitPriceCents: 2_000, unitCostCents: 1_200 }),
        movement(StockMovementType.RETURN_IN, 2, { unitPriceCents: 2_000, unitCostCents: 1_200, relatedMovementId: 'sale-1' }),
      ],
      30,
      null,
      new Date('2026-09-25T12:00:00.000Z'),
    );

    expect(report.summary).toMatchObject({
      netSalesCents: 6_000,
      cogsCents: 3_600,
      grossProfitCents: 2_400,
      marginPercent: 40,
      unitsSold: 5,
      unitsReturned: 2,
      costCoveragePercent: 100,
    });
  });

  it('reports uncosted legacy sales without inventing gross profit', () => {
    const report = buildProfitability(
      [item],
      [shop],
      [movement(StockMovementType.SALE, 4, { unitPriceCents: 2_000 })],
      30,
      null,
      new Date('2026-09-25T12:00:00.000Z'),
    );

    expect(report.summary).toMatchObject({
      netSalesCents: 8_000,
      costedRevenueCents: 0,
      cogsCents: 0,
      grossProfitCents: 0,
      marginPercent: null,
      costCoveragePercent: 0,
    });
    expect(report.lines[0]?.uncostedSaleUnits).toBe(4);
  });

  it('tracks damage and negative count adjustments as inventory losses', () => {
    const report = buildProfitability(
      [item],
      [shop],
      [
        movement(StockMovementType.DAMAGE, 2, { unitCostCents: 1_200 }),
        movement(StockMovementType.ADJUSTMENT_OUT, 1, { unitCostCents: 1_200, stockCountId: 'count-1' }),
      ],
      30,
      null,
      new Date('2026-09-25T12:00:00.000Z'),
    );

    expect(report.summary.inventoryLossCents).toBe(3_600);
  });
});
