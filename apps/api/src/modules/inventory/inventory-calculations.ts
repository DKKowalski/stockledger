import { movementCost, prospectivePools } from './prospective-costing.js';
import { locationValues, type ValuePool } from './exact-costing.js';
import { MOVEMENT_SIGN, type MovementVelocity, StockMovementType } from './inventory.types.js';

export type ItemRecord = {
  preciseCosting?: boolean;
  pooledValueCents?: number | null;
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
  costTotalCents?: number | null;
  correctsMovementId?: string | null;
  correctedByMovementId?: string | null;
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

export type LineAggregate = {
  /** Quantity leaving this line, by movement type. */
  sourced: Partial<Record<StockMovementType, number>>;
  transferredIn: number;
  outLastPeriod: number;
  lastOutDate: string | null;
};
export type LineAggregates = ReadonlyMap<string, LineAggregate>;
export const lineKey = (itemId: string, placeId: string) => `${itemId}:${placeId}`;
const isOutbound = (type: StockMovementType) => type === StockMovementType.TRANSFER || type === StockMovementType.SALE;

/** Folds a movement list into per-line totals. The SQL snapshot path produces the same shape. */
export function aggregateMovements(movements: readonly MovementRecord[], startDate: string, endDate: string): Map<string, LineAggregate> {
  const lines = new Map<string, LineAggregate>();
  const line = (key: string) => {
    let value = lines.get(key);
    if (!value) lines.set(key, value = { sourced: {}, transferredIn: 0, outLastPeriod: 0, lastOutDate: null });
    return value;
  };
  for (const movement of movements) {
    const source = line(lineKey(movement.itemId, movement.locationId));
    source.sourced[movement.type] = (source.sourced[movement.type] ?? 0) + movement.quantity;
    if (isOutbound(movement.type)) {
      if (movement.movementDate >= startDate && movement.movementDate <= endDate) source.outLastPeriod += movement.quantity;
      if (source.lastOutDate === null || movement.movementDate > source.lastOutDate) source.lastOutDate = movement.movementDate;
    }
    if (movement.destinationLocationId) {
      const destination = line(lineKey(movement.itemId, movement.destinationLocationId));
      if (movement.type === StockMovementType.TRANSFER) destination.transferredIn += movement.quantity;
    }
  }
  return lines;
}

export function presentMovement(
  movement: MovementRecord,
  itemById: ReadonlyMap<string, ItemRecord>,
  locationById: ReadonlyMap<string, LocationRecord>,
) {
  return {
    ...movement,
    saleTotalCents: (movement.type === StockMovementType.SALE || movement.type === StockMovementType.RETURN_IN) && movement.unitPriceCents !== null
      ? movement.unitPriceCents * movement.quantity : null,
    costTotalCents: movementCost(movement),
    item: itemById.get(movement.itemId) ?? null,
    location: locationById.get(movement.locationId) ?? null,
    destination: movement.destinationLocationId ? locationById.get(movement.destinationLocationId) ?? null : null,
    sign: MOVEMENT_SIGN[movement.type],
  };
}

function touches(movement: MovementRecord, locationId: string) {
  return movement.locationId === locationId || movement.destinationLocationId === locationId;
}

export function snapshotPeriod(days: number, now: Date, range?: { from: string; to: string }) {
  const periodStart = new Date(now);
  periodStart.setUTCDate(periodStart.getUTCDate() - days);
  return { startDate: range?.from ?? periodStart.toISOString().slice(0, 10), endDate: range?.to ?? now.toISOString().slice(0, 10) };
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
  range?: { from: string; to: string },
  /** Supply when `movements` is only the displayed subset; totals then come from SQL. */
  precomputed?: { lines: LineAggregates; poolMovements: readonly MovementRecord[] },
) {
  const { startDate, endDate } = snapshotPeriod(days, now, range);
  const visibleLocations = locationId
    ? locations.filter((location) => location.id === locationId)
    : locations;

  const openingByLine = new Map(stocks.map((stock) => [lineKey(stock.itemId, stock.locationId), stock.openingStock]));
  const aggregates = precomputed?.lines ?? aggregateMovements(movements, startDate, endDate);

  const lines = locations.flatMap((location) => items.map((item) => {
    const key = lineKey(item.id, location.id);
    const opening = openingByLine.get(key) ?? 0;
    const aggregate = aggregates.get(key);
    const sourced = aggregate?.sourced ?? {};
    const purchases = sourced[StockMovementType.PURCHASE] ?? 0;
    const returnsIn = sourced[StockMovementType.RETURN_IN] ?? 0;
    const transferredOut = sourced[StockMovementType.TRANSFER] ?? 0;
    const returnsOut = sourced[StockMovementType.RETURN_OUT] ?? 0;
    const damaged = sourced[StockMovementType.DAMAGE] ?? 0;
    const sales = sourced[StockMovementType.SALE] ?? 0;
    const adjustmentsIn = sourced[StockMovementType.ADJUSTMENT_IN] ?? 0;
    const adjustmentsOut = sourced[StockMovementType.ADJUSTMENT_OUT] ?? 0;
    const transferredIn = aggregate?.transferredIn ?? 0;
    const closing = opening + purchases + returnsIn + transferredIn + adjustmentsIn - transferredOut - returnsOut - damaged - sales - adjustmentsOut;
    const active = opening > 0 || aggregate !== undefined;
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
      outLastPeriod: aggregate?.outLastPeriod ?? 0,
      lastOutDate: aggregate?.lastOutDate ?? null,
      isLowStock: active && closing <= item.reorderLevel,
      active,
    };
  }));

  for (const [itemId, pool] of new Map([...prospectivePools(items, stocks, precomputed?.poolMovements ?? movements), ...pools])) {
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

  const presentedMovements = [...visibleMovements]
    .sort((left, right) => right.movementDate.localeCompare(left.movementDate) || right.createdAt.localeCompare(left.createdAt))
    .map((movement) => presentMovement(movement, itemById, locationById));

  return {
    items,
    periodDays: days,
    periodStart: startDate,
    periodEnd: endDate,
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
    periodMovements: presentedMovements.filter((movement) => movement.movementDate >= startDate && movement.movementDate <= endDate),
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
  const hideItemCost = <T extends ItemRecord>(item: T): T => ({ ...item, unitCostCents: 0, pooledValueCents: null });
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
