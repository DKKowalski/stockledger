import { StockMovementType } from './inventory.types.js';
import type { ItemRecord, LocationRecord, MovementRecord } from './inventory-calculations.js';

type ProfitLine = {
  itemId: string;
  itemName: string;
  locationId: string;
  locationName: string;
  unitsSold: number;
  unitsReturned: number;
  netSalesCents: number;
  costedRevenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  marginPercent: number | null;
  uncostedSaleUnits: number;
};

export type ProfitabilityFilters = {
  days: number;
  locationId: string | null;
  locationType: LocationRecord['type'] | null;
  itemId: string | null;
  category: string | null;
};

export function buildProfitability(
  items: readonly ItemRecord[],
  locations: readonly LocationRecord[],
  movements: readonly MovementRecord[],
  filters: ProfitabilityFilters,
  now = new Date(),
) {
  const { days, locationId, locationType, itemId, category } = filters;
  const periodStart = new Date(now);
  periodStart.setUTCDate(periodStart.getUTCDate() - days);
  const startDate = periodStart.toISOString().slice(0, 10);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const relevant = movements.filter((movement) => {
    const item = itemById.get(movement.itemId);
    const location = locationById.get(movement.locationId);
    return movement.movementDate >= startDate
      && (!locationId || movement.locationId === locationId)
      && (!locationType || location?.type === locationType)
      && (!itemId || movement.itemId === itemId)
      && (!category || item?.category === category);
  });
  const lines = new Map<string, ProfitLine>();

  const lineFor = (movement: MovementRecord) => {
    const key = `${movement.locationId}:${movement.itemId}`;
    const existing = lines.get(key);
    if (existing) return existing;
    const line: ProfitLine = {
      itemId: movement.itemId,
      itemName: itemById.get(movement.itemId)?.name ?? 'Deleted item',
      locationId: movement.locationId,
      locationName: locationById.get(movement.locationId)?.name ?? 'Unknown place',
      unitsSold: 0,
      unitsReturned: 0,
      netSalesCents: 0,
      costedRevenueCents: 0,
      cogsCents: 0,
      grossProfitCents: 0,
      marginPercent: null,
      uncostedSaleUnits: 0,
    };
    lines.set(key, line);
    return line;
  };

  for (const movement of relevant) {
    if (movement.type !== StockMovementType.SALE && movement.type !== StockMovementType.RETURN_IN) continue;
    const line = lineFor(movement);
    const direction = movement.type === StockMovementType.SALE ? 1 : -1;
    if (direction === 1) line.unitsSold += movement.quantity;
    else line.unitsReturned += movement.quantity;
    if (movement.unitPriceCents !== null) line.netSalesCents += direction * movement.unitPriceCents * movement.quantity;
    if (movement.unitPriceCents !== null && movement.unitCostCents !== null) {
      line.costedRevenueCents += direction * movement.unitPriceCents * movement.quantity;
      line.cogsCents += direction * movement.unitCostCents * movement.quantity;
    } else if (direction === 1) {
      line.uncostedSaleUnits += movement.quantity;
    }
  }

  const presentedLines = [...lines.values()].map((line) => {
    const grossProfitCents = line.costedRevenueCents - line.cogsCents;
    return {
      ...line,
      grossProfitCents,
      marginPercent: line.costedRevenueCents > 0 ? Math.round((grossProfitCents / line.costedRevenueCents) * 10_000) / 100 : null,
    };
  }).sort((left, right) => right.grossProfitCents - left.grossProfitCents || left.itemName.localeCompare(right.itemName));

  const totalSaleUnits = presentedLines.reduce((total, line) => total + line.unitsSold, 0);
  const uncostedSaleUnits = presentedLines.reduce((total, line) => total + line.uncostedSaleUnits, 0);
  const netSalesCents = presentedLines.reduce((total, line) => total + line.netSalesCents, 0);
  const costedRevenueCents = presentedLines.reduce((total, line) => total + line.costedRevenueCents, 0);
  const cogsCents = presentedLines.reduce((total, line) => total + line.cogsCents, 0);
  const grossProfitCents = costedRevenueCents - cogsCents;
  const inventoryLossCents = relevant
    .filter((movement) => movement.type === StockMovementType.DAMAGE || movement.type === StockMovementType.ADJUSTMENT_OUT)
    .reduce((total, movement) => total + (movement.unitCostCents === null ? 0 : movement.unitCostCents * movement.quantity), 0);

  const profitMovements = relevant.filter((movement) => movement.type === StockMovementType.SALE || movement.type === StockMovementType.RETURN_IN);
  const trend = [...new Set(profitMovements.map((movement) => movement.movementDate))].sort().map((date) => {
    const day = relevant.filter((movement) => movement.movementDate === date);
    let sales = 0;
    let costedRevenue = 0;
    let cost = 0;
    for (const movement of day) {
      if (movement.type !== StockMovementType.SALE && movement.type !== StockMovementType.RETURN_IN) continue;
      const direction = movement.type === StockMovementType.SALE ? 1 : -1;
      if (movement.unitPriceCents !== null) sales += direction * movement.unitPriceCents * movement.quantity;
      if (movement.unitPriceCents !== null && movement.unitCostCents !== null) {
        costedRevenue += direction * movement.unitPriceCents * movement.quantity;
        cost += direction * movement.unitCostCents * movement.quantity;
      }
    }
    return { date, netSalesCents: sales, grossProfitCents: costedRevenue - cost };
  });

  return {
    periodDays: days,
    startDate,
    endDate: now.toISOString().slice(0, 10),
    locationId,
    locationType,
    itemId,
    category,
    summary: {
      netSalesCents,
      costedRevenueCents,
      cogsCents,
      grossProfitCents,
      marginPercent: costedRevenueCents > 0 ? Math.round((grossProfitCents / costedRevenueCents) * 10_000) / 100 : null,
      inventoryLossCents,
      costCoveragePercent: totalSaleUnits > 0 ? Math.round(((totalSaleUnits - uncostedSaleUnits) / totalSaleUnits) * 10_000) / 100 : 100,
      unitsSold: totalSaleUnits,
      unitsReturned: presentedLines.reduce((total, line) => total + line.unitsReturned, 0),
    },
    lines: presentedLines,
    trend,
  };
}
