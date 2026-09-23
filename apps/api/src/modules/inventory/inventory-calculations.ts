import { MOVEMENT_SIGN, type MovementVelocity, StockMovementType } from './inventory.types.js';

export type ItemRecord = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  reorderLevel: number;
  unitCostCents: number;
  sellingPriceCents: number | null;
  createdAt: string;
  updatedAt: string;
};

export type LocationRecord = {
  id: string;
  name: string;
  type: 'warehouse' | 'shop';
};

export type StockRecord = {
  locationId: string;
  itemId: string;
  openingStock: number;
};

export type MovementRecord = {
  id: string;
  itemId: string;
  locationId: string;
  destinationLocationId: string | null;
  type: StockMovementType;
  quantity: number;
  unitPriceCents: number | null;
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

function touches(movement: MovementRecord, locationId: string) {
  return movement.locationId === locationId || movement.destinationLocationId === locationId;
}

export function buildSnapshot(
  items: readonly ItemRecord[],
  locations: readonly LocationRecord[],
  stocks: readonly StockRecord[],
  movements: readonly MovementRecord[],
  days = 30,
  locationId: string | null = null,
  now = new Date(),
) {
  const periodStart = new Date(now);
  periodStart.setUTCDate(periodStart.getUTCDate() - days);
  const startDate = periodStart.toISOString().slice(0, 10);
  const visibleLocations = locationId
    ? locations.filter((location) => location.id === locationId)
    : locations;

  const lines = visibleLocations.flatMap((location) => items.map((item) => {
    const opening = stocks.find((stock) => stock.itemId === item.id && stock.locationId === location.id)?.openingStock ?? 0;
    const sourced = movements.filter((movement) => movement.itemId === item.id && movement.locationId === location.id);
    const received = movements.filter((movement) => (
      movement.itemId === item.id
      && movement.type === StockMovementType.TRANSFER
      && movement.destinationLocationId === location.id
    ));
    const purchases = sum(sourced, StockMovementType.PURCHASE);
    const returnsIn = sum(sourced, StockMovementType.RETURN_IN);
    const transferredOut = sum(sourced, StockMovementType.TRANSFER);
    const returnsOut = sum(sourced, StockMovementType.RETURN_OUT);
    const damaged = sum(sourced, StockMovementType.DAMAGE);
    const sales = sum(sourced, StockMovementType.SALE);
    const transferredIn = received.reduce((total, movement) => total + movement.quantity, 0);
    const closing = opening + purchases + returnsIn + transferredIn - transferredOut - returnsOut - damaged - sales;
    const outbound = sourced.filter((movement) => (
      movement.type === StockMovementType.TRANSFER || movement.type === StockMovementType.SALE
    ));
    const active = opening > 0 || movements.some((movement) => movement.itemId === item.id && touches(movement, location.id));
    return {
      item,
      location,
      opening,
      purchases,
      returnsIn,
      transferredIn,
      transferredOut,
      returnsOut,
      damaged,
      sales,
      closing,
      valueCents: closing * item.unitCostCents,
      outLastPeriod: outbound
        .filter((movement) => movement.movementDate >= startDate)
        .reduce((total, movement) => total + movement.quantity, 0),
      lastOutDate: outbound.map((movement) => movement.movementDate).sort().at(-1) ?? null,
      isLowStock: active && closing <= item.reorderLevel,
      active,
    };
  }));

  const shown = lines.filter((line) => locationId !== null || line.active);
  const moving = [...shown]
    .filter((position) => position.outLastPeriod > 0)
    .sort((left, right) => right.outLastPeriod - left.outLastPeriod);
  const fastIds = new Set(
    moving
      .slice(0, moving.length ? Math.ceil(moving.length / 3) : 0)
      .map((position) => `${position.location.id}:${position.item.id}`),
  );
  const positions = shown
    .map((position) => {
      let velocity: MovementVelocity = 'none';
      const key = `${position.location.id}:${position.item.id}`;
      if (fastIds.has(key)) velocity = 'fast';
      else if (position.outLastPeriod > 0) velocity = 'slow';
      else if (position.closing > 0) velocity = 'dead';
      return { ...position, velocity };
    })
    .sort((left, right) => left.item.name.localeCompare(right.item.name) || left.location.name.localeCompare(right.location.name));

  const locationById = new Map(locations.map((location) => [location.id, location]));
  const visibleMovements = movements.filter((movement) => (
    locationId === null || touches(movement, locationId)
  ));

  return {
    items,
    periodDays: days,
    generatedAt: now.toISOString(),
    locationId,
    locations,
    summary: {
      closingUnits: positions.reduce((total, position) => total + position.closing, 0),
      stockValueCents: positions.reduce((total, position) => total + position.valueCents, 0),
      lowStockItems: positions.filter((position) => position.isLowStock).length,
      damagedUnits: positions.reduce((total, position) => total + position.damaged, 0),
      deadStockLines: positions.filter((position) => position.velocity === 'dead').length,
    },
    positions,
    movements: [...visibleMovements]
      .sort((left, right) => right.movementDate.localeCompare(left.movementDate) || right.createdAt.localeCompare(left.createdAt))
      .map((movement) => ({
        ...movement,
        saleTotalCents: movement.type === StockMovementType.SALE && movement.unitPriceCents !== null
          ? movement.unitPriceCents * movement.quantity : null,
        item: items.find((item) => item.id === movement.itemId) ?? null,
        location: locationById.get(movement.locationId) ?? null,
        destination: movement.destinationLocationId ? locationById.get(movement.destinationLocationId) ?? null : null,
        sign: MOVEMENT_SIGN[movement.type],
      })),
  };
}
