import { ConflictException } from '@nestjs/common';
import type { PrismaTransaction } from '../../prisma/prisma.service.js';
import { buildSnapshot, type MovementRecord } from './inventory-calculations.js';
import { validatePool } from './exact-costing.js';

// Caller holds the company/item locks for writes, or uses a repeatable-read snapshot for reads.
export async function valuationState(tx: PrismaTransaction, companyId: string, itemId: string) {
  const checkpoint = await tx.orm.public.InventoryValuationCheckpoint.first({ companyId, itemId });
  if (!checkpoint) return null;
  const latest = await tx.orm.public.InventoryValuationEntry.where({ companyId, itemId }).orderBy([(r) => r.sequence.desc()]).first();
  return { checkpoint, sequence: latest?.sequence ?? 0, pool: validatePool({
    quantity: latest?.quantityAfter ?? checkpoint.openingQuantity,
    valueCents: latest?.valueAfterCents ?? checkpoint.openingValueCents,
  }) };
}
export async function stockPositions(tx: PrismaTransaction, companyId: string, itemId: string) {
  const [items, locations, stocks, movements] = await Promise.all([
    tx.orm.public.InventoryItem.where({ companyId, id: itemId }).all(),
    tx.orm.public.Location.where({ companyId }).all(),
    tx.orm.public.LocationStock.where({ companyId, itemId }).all(),
    tx.orm.public.StockMovement.where({ companyId, itemId }).all(),
  ]);
  // Include zero-stock places so the first receipt has a valid receiving location.
  return locations.flatMap(location => buildSnapshot(items, locations, stocks, movements as MovementRecord[],30,location.id).positions);
}
export async function reconcileValuation(tx: PrismaTransaction, companyId: string, itemId: string, state: NonNullable<Awaited<ReturnType<typeof valuationState>>>) {
  const positions = await stockPositions(tx, companyId, itemId);
  if (positions.some((p) => p.closing < 0) || positions.reduce((sum, p) => sum + p.closing, 0) !== state.pool.quantity) {
    throw new ConflictException('Stock quantities and exact valuation do not reconcile. No transaction was recorded');
  }
  return positions;
}
export async function assertLegacyItem(tx: PrismaTransaction, companyId: string, itemId: string) {
  if (await tx.orm.public.InventoryValuationCheckpoint.first({ companyId, itemId })) {
    throw new ConflictException('This test item uses exact costing. Use its exact-cost purchase or development checkout; other stock changes require a compatible correction workflow');
  }
}
export async function valuationPools(tx: PrismaTransaction, companyId: string) {
  const checkpoints = await tx.orm.public.InventoryValuationCheckpoint.where({ companyId }).all();
  const result = new Map<string, { quantity: number; valueCents: number }>();
  for (const checkpoint of checkpoints) {
    const state = await valuationState(tx, companyId, checkpoint.itemId);
    result.set(checkpoint.itemId, state!.pool);
  }
  return result;
}
