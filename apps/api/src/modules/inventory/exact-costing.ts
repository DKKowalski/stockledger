import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PricingComponent } from './pricing-calculations.js';

export const EXACT_LIMIT = 2147483647;
export type ValuePool = { quantity: number; valueCents: number };
function integer(value: number, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum || value > EXACT_LIMIT) throw new BadRequestException('Exact costing requires whole quantities and amounts up to 2147483647 cents');
}
function bounded(value: bigint) {
  if (value < 0n || value > BigInt(EXACT_LIMIT)) throw new BadRequestException('The exact stock value or quantity is too large');
  return Number(value);
}
export function validatePool(pool: ValuePool): ValuePool {
  integer(pool.quantity); integer(pool.valueCents);
  if (pool.quantity === 0 && pool.valueCents !== 0) throw new ConflictException('Empty stock must have zero remaining value');
  return pool;
}
export function averageCost(pool: ValuePool): number | null {
  validatePool(pool);
  return pool.quantity === 0 ? null : Number((BigInt(pool.valueCents) + BigInt(pool.quantity) / 2n) / BigInt(pool.quantity));
}
export function receiveValue(pool: ValuePool, quantity: number, unitCostCents: number) {
  validatePool(pool); integer(quantity, 1); integer(unitCostCents);
  const receivedValueCents = bounded(BigInt(quantity) * BigInt(unitCostCents));
  return { receivedValueCents, pool: validatePool({ quantity: bounded(BigInt(pool.quantity) + BigInt(quantity)), valueCents: bounded(BigInt(pool.valueCents) + BigInt(receivedValueCents)) }) };
}
export function issueValue(pool: ValuePool, quantity: number) {
  validatePool(pool); integer(quantity, 1);
  if (quantity > pool.quantity) throw new ConflictException(`Only ${pool.quantity} units are available for exact costing`);
  const costCents = Number((BigInt(pool.valueCents) * BigInt(quantity) + BigInt(pool.quantity) / 2n) / BigInt(pool.quantity));
  const after = validatePool({ quantity: pool.quantity - quantity, valueCents: pool.valueCents - costCents });
  return { costCents, pool: after };
}
// Split only the submitted quantities. Each movement keeps a truthful integer unit cost,
// so existing reports/exports continue to sum price × quantity and cost × quantity exactly.
export function splitCostComponents(components: readonly PricingComponent[], costCents: number) {
  integer(costCents);
  const quantity = components.reduce((sum, part) => sum + part.quantity, 0); integer(quantity, 1);
  for (const part of components) integer(part.quantity, 1);
  const base = Math.floor(costCents / quantity); let extra = costCents % quantity;
  const result: Array<PricingComponent & { unitCostCents: number }> = [];
  for (const part of components) {
    const higher = Math.min(extra, part.quantity); extra -= higher;
    if (higher) result.push({ ...part, quantity: higher, totalCents: bounded(BigInt(higher) * BigInt(part.unitPriceCents)), unitCostCents: base + 1 });
    const lower = part.quantity - higher;
    if (lower) result.push({ ...part, quantity: lower, totalCents: bounded(BigInt(lower) * BigInt(part.unitPriceCents)), unitCostCents: base });
  }
  return result;
}
export function locationValues(pool: ValuePool, positions: readonly { locationId: string; quantity: number }[]) {
  validatePool(pool);
  const sorted = [...positions].sort((a, b) => a.locationId.localeCompare(b.locationId));
  for (const position of sorted) integer(position.quantity);
  if (sorted.reduce((sum, p) => sum + p.quantity, 0) !== pool.quantity) throw new ConflictException('Stock quantities and exact valuation do not reconcile');
  const base = pool.quantity ? Math.floor(pool.valueCents / pool.quantity) : 0; let extra = pool.quantity ? pool.valueCents % pool.quantity : 0;
  return new Map(sorted.map((position) => {
    const higher = Math.min(extra, position.quantity); extra -= higher;
    return [position.locationId, bounded(BigInt(base) * BigInt(position.quantity) + BigInt(higher))] as const;
  }));
}
