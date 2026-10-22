import { locationValues, type ValuePool } from './exact-costing.js';
import { MOVEMENT_SIGN, type MovementVelocity, StockMovementType } from './inventory.types.js';

export type ItemRecord = {
  preciseCosting?: boolean;
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  reorderLevel: number;
  unitCostCents: number;
  sellingPriceCents: number | null;
  isActive: boolean;
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
  saleId?: string;
  saleLineId?: string;
  pricingCategory?: string;
  id: string;
  itemId: string;
  locationId: string;
  destinationLocationId: string | null;
  type: StockMovementType;
  quantity: number;
  unitPriceCents: number | null;
  unitCostCents: number | null;
  supplierId: string | null;
  relatedMovementId: string | null;
  stockCountId: string | null;
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
  pools: ReadonlyMap<string, ValuePool> = new Map(),
) {
  const periodStart = new Date(now);
  periodStart.setUTCDate(periodStart.getUTCDate() - days);
  const startDate = periodStart.toISOString().slice(0, 10);
  const visibleLocations = locationId
    ? locations.filter((location) => location.id === locationId)
    : locations;

  // Index once so each item-and-place line does not rescan the whole ledger.
  const lineKey = (itemId: string, placeId: string) => `${itemId}:${placeId}`;
  const openingByLine = new Map(stocks.map((stock) => [lineKey(stock.itemId, stock.locationId), stock.openingStock]));
  const sourcedByLine = new Map<string, MovementRecord[]>();
  const receivedByLine = new Map<string, MovementRecord[]>();
  const touchedLines = new Set<string>();
  for (const movement of movements) {
    const source = lineKey(movement.itemId, movement.locationId);
    if (!sourcedByLine.has(source)) sourcedByLine.set(source, []);
    sourcedByLine.get(source)!.push(movement);
    touchedLines.add(source);
    if (movement.destinationLocationId) {
      const destination = lineKey(movement.itemId, movement.destinationLocationId);
      touchedLines.add(destination);
      if (movement.type === StockMovementType.TRANSFER) {
        if (!receivedByLine.has(destination)) receivedByLine.set(destination, []);
        receivedByLine.get(destination)!.push(movement);
      }
    }
  }

  const lines = locations.flatMap((location) => items.map((item) => {
    const key = lineKey(item.id, location.id);
    const opening = openingByLine.get(key) ?? 0;
    const sourced = sourcedByLine.get(key) ?? [];
    const received = receivedByLine.get(key) ?? [];
    const purchases = sum(sourced, StockMovementType.PURCHASE);
    const returnsIn = sum(sourced, StockMovementType.RETURN_IN);
    const transferredOut = sum(sourced, StockMovementType.TRANSFER);
    const returnsOut = sum(sourced, StockMovementType.RETURN_OUT);
    const damaged = sum(sourced, StockMovementType.DAMAGE);
    const sales = sum(sourced, StockMovementType.SALE);
    const adjustmentsIn = sum(sourced, StockMovementType.ADJUSTMENT_IN);
    const adjustmentsOut = sum(sourced, StockMovementType.ADJUSTMENT_OUT);
    const transferredIn = received.reduce((total, movement) => total + movement.quantity, 0);
    const closing = opening + purchases + returnsIn + transferredIn + adjustmentsIn - transferredOut - returnsOut - damaged - sales - adjustmentsOut;
    const outbound = sourced.filter((movement) => (
      movement.type === StockMovementType.TRANSFER || movement.type === StockMovementType.SALE
    ));
    const active = opening > 0 || touchedLines.has(key);
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
      adjustmentsIn,
      adjustmentsOut,
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

  for (const [itemId, pool] of pools) {
    const matching = lines.filter(line => line.item.id === itemId);
    const values = locationValues(pool,matching.map(line => ({locationId:line.location.id,quantity:line.closing})));
    for (const line of matching) line.valueCents = values.get(line.location.id)!;
  }
  const visibleIds = new Set(visibleLocations.map(location => location.id));
  const shown = lines.filter((line) => visibleIds.has(line.location.id) && line.item.isActive && (locationId !== null || line.active));
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
  const itemById = new Map(items.map((item) => [item.id, item]));
  const visibleMovements = movements.filter((movement) => (
    locationId === null || touches(movement, locationId)
  ));

  const presentMovement = (movement: MovementRecord) => ({
    ...movement,
    saleTotalCents: (movement.type === StockMovementType.SALE || movement.type === StockMovementType.RETURN_IN) && movement.unitPriceCents !== null
      ? movement.unitPriceCents * movement.quantity : null,
    costTotalCents: movement.unitCostCents === null ? null : movement.unitCostCents * movement.quantity,
    item: itemById.get(movement.itemId) ?? null,
    location: locationById.get(movement.locationId) ?? null,
    destination: movement.destinationLocationId ? locationById.get(movement.destinationLocationId) ?? null : null,
    sign: MOVEMENT_SIGN[movement.type],
  });
  const presentedMovements = [...visibleMovements]
    .sort((left, right) => right.movementDate.localeCompare(left.movementDate) || right.createdAt.localeCompare(left.createdAt))
    .map(presentMovement);

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
    movements: presentedMovements,
    periodMovements: presentedMovements.filter((movement) => movement.movementDate >= startDate),
  };
}

/**
 * Lowest end-of-day balance of one item at one place on or after `fromDate`.
 * An outbound movement dated `fromDate` reduces every one of those balances,
 * so it fits only when its quantity does not exceed this value.
 */
export function lowestBalanceFrom(
  stocks: readonly StockRecord[],
  movements: readonly MovementRecord[],
  itemId: string,
  locationId: string,
  fromDate: string,
) {
  const deltaByDate = new Map<string, number>();
  const add = (date: string, delta: number) => deltaByDate.set(date, (deltaByDate.get(date) ?? 0) + delta);
  for (const movement of movements) {
    if (movement.itemId !== itemId) continue;
    if (movement.locationId === locationId) add(movement.movementDate, MOVEMENT_SIGN[movement.type] * movement.quantity);
    if (movement.type === StockMovementType.TRANSFER && movement.destinationLocationId === locationId) {
      add(movement.movementDate, movement.quantity);
    }
  }
  let balance = stocks.find((stock) => stock.itemId === itemId && stock.locationId === locationId)?.openingStock ?? 0;
  const dates = [...deltaByDate.keys()].sort();
  for (const date of dates) if (date <= fromDate) balance += deltaByDate.get(date)!;
  let lowest = balance;
  for (const date of dates) {
    if (date <= fromDate) continue;
    balance += deltaByDate.get(date)!;
    lowest = Math.min(lowest, balance);
  }
  return lowest;
}

/** Shop attendants sell at a set price; unit costs and stock value stay with managers and owners. */
export function withoutCosts(snapshot: ReturnType<typeof buildSnapshot>) {
  const hideItemCost = <T extends ItemRecord>(item: T): T => ({ ...item, unitCostCents: 0 });
  const hideMovementCost = <T extends { unitCostCents: number | null; costTotalCents: number | null; item: ItemRecord | null }>(movement: T): T => ({
    ...movement,
    unitCostCents: null,
    costTotalCents: null,
    item: movement.item ? hideItemCost(movement.item) : null,
  });
  return {
    ...snapshot,
    items: snapshot.items.map(hideItemCost),
    summary: { ...snapshot.summary, stockValueCents: 0 },
    positions: snapshot.positions.map((position) => ({ ...position, item: hideItemCost(position.item), valueCents: 0 })),
    movements: snapshot.movements.map(hideMovementCost),
    periodMovements: snapshot.periodMovements.map(hideMovementCost),
  };
}
