import { ConflictException } from '@nestjs/common';
import type { PrismaTransaction } from '../../prisma/prisma.service.js';
import { averageCost, validatePool, type ValuePool } from './exact-costing.js';
import type { MovementRecord, StockRecord } from './inventory-calculations.js';
import { MOVEMENT_SIGN } from './inventory.types.js';

type CostItem = { id: string; unitCostCents: number; pooledValueCents?: number | null };
export function stockQuantity(itemId: string, stocks: readonly StockRecord[], movements: readonly MovementRecord[]) {
  return stocks.filter(s => s.itemId === itemId).reduce((s, r) => s + r.openingStock, 0)
    + movements.filter(m => m.itemId === itemId && m.type !== 'transfer').reduce((s, m) => s + MOVEMENT_SIGN[m.type] * m.quantity, 0);
}
// The first correction adopts the recorded current carrying value. It does not reconstruct history.
export function recordedPool(item: CostItem, stocks: readonly StockRecord[], movements: readonly MovementRecord[]): ValuePool {
  const quantity = stockQuantity(item.id, stocks, movements);
  const balances = new Map<string, number>();
  for (const stock of stocks.filter(s => s.itemId === item.id)) balances.set(stock.locationId, stock.openingStock);
  for (const movement of movements.filter(m => m.itemId === item.id)) {
    balances.set(movement.locationId, (balances.get(movement.locationId) ?? 0) + MOVEMENT_SIGN[movement.type] * movement.quantity);
    if (movement.type === 'transfer' && movement.destinationLocationId) balances.set(movement.destinationLocationId, (balances.get(movement.destinationLocationId) ?? 0) + movement.quantity);
  }
  if ([...balances.values()].some(q => q < 0)) throw new ConflictException('Reconcile negative stock at each place before correcting its value');
  if (quantity < 0) throw new ConflictException('Reconcile negative stock before correcting its value');
  return validatePool({ quantity, valueCents: item.pooledValueCents ?? quantity * item.unitCostCents });
}
export function prospectivePools(items: readonly CostItem[], stocks: readonly StockRecord[], movements: readonly MovementRecord[]) {
  return new Map(items.filter(i => i.pooledValueCents != null).map(i => [i.id, recordedPool(i, stocks, movements)]));
}
export async function saveRecordedPool(tx: PrismaTransaction, companyId: string, itemId: string, pool: ValuePool) {
  validatePool(pool);
  const average = averageCost(pool);
  await tx.orm.public.InventoryItem.where({ companyId, id: itemId }).update({
    pooledValueCents: pool.valueCents,
    ...(average === null ? {} : { unitCostCents: average }),
  });
}
export function movementCost(movement: Pick<MovementRecord, 'quantity' | 'unitCostCents' | 'costTotalCents'>) {
  return movement.costTotalCents ?? (movement.unitCostCents === null ? null : movement.quantity * movement.unitCostCents);
}
// Cumulative allocation makes repeated partial returns exhaust the original recorded cents.
export function originalReturnCost(total: number, quantity: number, returned: number, returning: number) {
  const q = BigInt(quantity), value = BigInt(total);
  const cumulative = (n: number) => (value * BigInt(n) + q / 2n) / q;
  return Number(cumulative(returned + returning) - cumulative(returned));
}
