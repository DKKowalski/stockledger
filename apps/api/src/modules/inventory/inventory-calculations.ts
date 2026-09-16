import { MOVEMENT_SIGN, type MovementVelocity, StockMovementType } from './inventory.types.js';

export type ItemRecord = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  reorderLevel: number;
  unitCostCents: number;
  openingStock: number;
  createdAt: string;
  updatedAt: string;
};

export type MovementRecord = {
  id: string;
  itemId: string;
  type: StockMovementType;
  quantity: number;
  movementDate: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
};

function sum(movements: readonly MovementRecord[], type: StockMovementType) {
  return movements
    .filter((movement) => movement.type === type)
    .reduce((total, movement) => total + movement.quantity, 0);
}

export function buildSnapshot(
  items: readonly ItemRecord[],
  movements: readonly MovementRecord[],
  days = 30,
  now = new Date(),
) {
  const periodStart = new Date(now);
  periodStart.setUTCDate(periodStart.getUTCDate() - days);
  const startDate = periodStart.toISOString().slice(0, 10);

  const base = items.map((item) => {
    const entries = movements.filter((movement) => movement.itemId === item.id);
    const purchases = sum(entries, StockMovementType.PURCHASE);
    const returnsIn = sum(entries, StockMovementType.RETURN_IN);
    const transferred = sum(entries, StockMovementType.TRANSFER);
    const returnsOut = sum(entries, StockMovementType.RETURN_OUT);
    const damaged = sum(entries, StockMovementType.DAMAGE);
    const closing = item.openingStock + purchases + returnsIn - transferred - returnsOut - damaged;
    const transfers = entries.filter((entry) => entry.type === StockMovementType.TRANSFER);
    return {
      item,
      opening: item.openingStock,
      purchases,
      returnsIn,
      transferred,
      returnsOut,
      damaged,
      closing,
      valueCents: closing * item.unitCostCents,
      outLastPeriod: transfers
        .filter((entry) => entry.movementDate >= startDate)
        .reduce((total, entry) => total + entry.quantity, 0),
      lastOutDate: transfers.map((entry) => entry.movementDate).sort().at(-1) ?? null,
      isLowStock: closing <= item.reorderLevel,
    };
  });

  const moving = [...base]
    .filter((position) => position.outLastPeriod > 0)
    .sort((left, right) => right.outLastPeriod - left.outLastPeriod);
  const fastIds = new Set(
    moving
      .slice(0, moving.length ? Math.ceil(moving.length / 3) : 0)
      .map((position) => position.item.id),
  );
  const positions = base
    .map((position) => {
      let velocity: MovementVelocity = 'none';
      if (fastIds.has(position.item.id)) velocity = 'fast';
      else if (position.outLastPeriod > 0) velocity = 'slow';
      else if (position.closing > 0) velocity = 'dead';
      return { ...position, velocity };
    })
    .sort((left, right) => left.item.name.localeCompare(right.item.name));

  return {
    periodDays: days,
    generatedAt: now.toISOString(),
    summary: {
      closingUnits: positions.reduce((total, position) => total + position.closing, 0),
      stockValueCents: positions.reduce((total, position) => total + position.valueCents, 0),
      lowStockItems: positions.filter((position) => position.isLowStock).length,
      damagedUnits: positions.reduce((total, position) => total + position.damaged, 0),
      deadStockLines: positions.filter((position) => position.velocity === 'dead').length,
    },
    positions,
    movements: [...movements]
      .sort((left, right) => right.movementDate.localeCompare(left.movementDate))
      .map((movement) => ({
        ...movement,
        item: items.find((item) => item.id === movement.itemId) ?? null,
        sign: MOVEMENT_SIGN[movement.type],
      })),
  };
}
