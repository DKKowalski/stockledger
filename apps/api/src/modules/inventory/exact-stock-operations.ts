import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import type { PrismaTransaction } from '../../prisma/prisma.service.js';
import { averageCost, issueValue, receiveValue, splitCostComponents, validatePool } from './exact-costing.js';
import { reconcileValuation, valuationState } from './valuation-ledger.js';
import type { ValuationInput } from './dto/valuation.dto.js';
const v = <N extends number>(s: string) => s as Varchar<N>;
export type StockOperationInput = Extract<ValuationInput, { kind: 'stock_operation' }>;
function validateStockSource(
  positions: Awaited<ReturnType<typeof reconcileValuation>>,
  input: StockOperationInput,
) {
  const source = positions.find((p) => p.location.id === input.locationId);
  if (!source) throw new NotFoundException('Receiving place not found');
  if (source.closing !== input.expectedLocationQuantity)
    throw new ConflictException('Stock at this place changed. Cancel this request and review it again');
  const op = input.operation;
  if (op === 'transfer') {
    if (
      !input.destinationLocationId ||
      input.destinationLocationId === input.locationId ||
      !positions.some((p) => p.location.id === input.destinationLocationId)
    )
      throw new BadRequestException('Choose a different destination in this business');
  } else if (input.destinationLocationId) throw new BadRequestException('Only transfers have a destination');
  if (
    !['supplier_return', 'receipt_reversal'].includes(op) &&
    (input.originalMovementId || input.supplierCreditCents !== null)
  )
    throw new BadRequestException(
      'A purchase reference and supplier credit are only used for a supplier return or receipt reversal',
    );
  if (op !== 'count' && input.unitCostCents !== null)
    throw new BadRequestException('Only a count gain accepts a newly verified cost');
  const delta = op === 'count' ? input.quantity - source.closing : -input.quantity;
  const quantity = Math.abs(delta);
  if (op !== 'count' && quantity === 0) throw new BadRequestException('Enter a positive quantity');
  if (delta < 0 && quantity > source.closing)
    throw new ConflictException(`Only ${source.closing} units are available at this place`);
  return { source, delta, quantity };
}
export async function applyStockOperation(
  tx: PrismaTransaction,
  companyId: string,
  userId: string,
  requestId: string,
  input: StockOperationInput,
) {
  const state = await valuationState(tx, companyId, input.itemId);
  if (!state) throw new ConflictException('Verify an exact opening value first');
  const positions = await reconcileValuation(tx, companyId, input.itemId, state);
  const { source, delta, quantity } = validateStockSource(positions, input),
    op = input.operation;
  let pool = { ...state.pool },
    removedCost = 0,
    addedCost = 0;
  if (op === 'receipt_reversal' || op === 'supplier_return') {
    if (!input.originalMovementId) throw new BadRequestException('Choose the original purchase');
    const purchase = await tx.orm.public.StockMovement.first({
      companyId,
      id: input.originalMovementId,
      itemId: input.itemId,
      type: 'purchase',
    });
    if (!purchase || (op === 'receipt_reversal' && purchase.locationId !== input.locationId))
      throw new ConflictException('Choose an original purchase for this item and place');
    const requests = await tx.orm.public.InventoryValuationRequest.where({
      companyId,
      itemId: input.itemId,
      status: v<12>('applied'),
    }).all();
    let alreadyReturned = 0;
    for (const request of requests) {
      const prior = request.inputJson as Record<string, unknown> | null;
      if (
        prior?.kind === 'stock_operation' &&
        ['supplier_return', 'receipt_reversal'].includes(String(prior.operation)) &&
        prior.originalMovementId === purchase.id
      )
        alreadyReturned += Number(prior.quantity);
    }
    if (quantity > purchase.quantity - alreadyReturned)
      throw new ConflictException('This purchase has too few unreturned units');
    if (op === 'receipt_reversal') {
      const entry = await tx.orm.public.InventoryValuationEntry.first({ companyId, movementId: purchase.id });
      if (
        !entry ||
        entry.kind !== 'receipt' ||
        entry.sequence !== state.sequence ||
        alreadyReturned ||
        quantity !== purchase.quantity ||
        purchase.unitCostCents === null
      )
        throw new ConflictException(
          'Later valuation activity depends on this receipt. Use a documented current-period correction instead',
        );
      removedCost = quantity * purchase.unitCostCents;
      pool = { quantity: pool.quantity - quantity, valueCents: pool.valueCents - removedCost };
    }
  }
  if (op === 'count' && delta > 0) {
    if (input.unitCostCents === null)
      throw new BadRequestException('Enter the documented unit cost for added stock');
    if (input.unitCostCents === 0 && !input.freeStockConfirmed)
      throw new ConflictException('Confirm that added stock was acquired free of charge');
    const received = receiveValue(pool, quantity, input.unitCostCents);
    pool = received.pool;
    addedCost = received.receivedValueCents;
  } else if (op !== 'transfer' && op !== 'receipt_reversal' && delta < 0) {
    const issued = issueValue(pool, quantity);
    pool = issued.pool;
    removedCost = issued.costCents;
  }
  let countId: string | null = null;
  if (op === 'count') {
    const count = await tx.orm.public.StockCount.create({
      companyId,
      itemId: input.itemId,
      locationId: input.locationId,
      countedByUserId: userId,
      expectedQuantity: source.closing,
      countedQuantity: input.quantity,
      varianceQuantity: delta,
      unitCostCents: delta > 0 ? input.unitCostCents! : (averageCost(state.pool) ?? 0),
      countedAt: input.movementDate,
      note: v<500>(`${input.reason}; ${input.reference}`),
    });
    countId = count.id;
  }
  const portions = quantity
    ? splitCostComponents(
        [{ category: 'retail', quantity, unitPriceCents: 0, totalCents: 0 }],
        op === 'transfer' ? issueValue(state.pool, quantity).costCents : removedCost + addedCost,
      )
    : [];
  if (!portions.length) {
    await tx.orm.public.InventoryValuationEntry.create({
      companyId,
      itemId: input.itemId,
      checkpointId: state.checkpoint.id,
      requestId,
      createdByUserId: userId,
      sequence: ++state.sequence,
      kind: v<20>('count_check'),
      quantityDelta: 0,
      valueDeltaCents: 0,
      quantityAfter: pool.quantity,
      valueAfterCents: pool.valueCents,
      reference: v<200>(input.reference),
    });
  }
  let progressive = { ...state.pool };
  for (const part of portions) {
    const type =
      op === 'transfer'
        ? 'transfer'
        : op === 'damage'
          ? 'damage'
          : op === 'count'
            ? delta > 0
              ? 'adjustment_in'
              : 'adjustment_out'
            : 'return_out';
    const movement = await tx.orm.public.StockMovement.create({
      companyId,
      itemId: input.itemId,
      locationId: input.locationId,
      destinationLocationId: op === 'transfer' ? input.destinationLocationId : null,
      type,
      quantity: part.quantity,
      unitCostCents: part.unitCostCents,
      stockCountId: countId,
      movementDate: input.movementDate,
      reference: v<80>(input.reference.slice(0, 80)),
      note: v<500>(`${op}: ${input.reason}`),
    });
    const sign = op === 'transfer' ? 0 : delta > 0 ? 1 : -1;
    progressive = {
      quantity: progressive.quantity + sign * part.quantity,
      valueCents: progressive.valueCents + sign * part.quantity * part.unitCostCents,
    };
    await tx.orm.public.InventoryValuationEntry.create({
      companyId,
      itemId: input.itemId,
      checkpointId: state.checkpoint.id,
      requestId,
      movementId: movement.id,
      createdByUserId: userId,
      sequence: ++state.sequence,
      kind: v<20>(op === 'count' ? (delta > 0 ? 'count_in' : 'count_out') : op),
      quantityDelta: sign * part.quantity,
      valueDeltaCents: sign * part.quantity * part.unitCostCents,
      quantityAfter: progressive.quantity,
      valueAfterCents: progressive.valueCents,
      reference: v<200>(input.reference),
    });
  }
  await reconcileValuation(tx, companyId, input.itemId, { ...state, pool });
  return { pool, countId, removedCostCents: removedCost, addedCostCents: addedCost };
}

export async function stockOperationPreview(
  tx: PrismaTransaction,
  companyId: string,
  input: StockOperationInput,
) {
  const state = await valuationState(tx, companyId, input.itemId);
  if (!state) throw new ConflictException('Verify an exact opening value first');
  const positions = await reconcileValuation(tx, companyId, input.itemId, state);
  const checked = validateStockSource(positions, input);
  const delta = input.operation === 'transfer' ? 0 : checked.delta;
  let valueDeltaCents = 0;
  if (delta > 0) {
    if (input.unitCostCents === null)
      throw new BadRequestException('Enter the documented cost of added units');
    valueDeltaCents = receiveValue(state.pool, delta, input.unitCostCents).receivedValueCents;
  } else if (delta < 0) {
    if (input.operation === 'receipt_reversal') {
      if (!input.originalMovementId) throw new BadRequestException('Choose the original purchase');
      const purchase = await tx.orm.public.StockMovement.first({
        companyId,
        id: input.originalMovementId ?? '',
        itemId: input.itemId,
        type: 'purchase',
      });
      if (!purchase || purchase.unitCostCents === null)
        throw new ConflictException('Original purchase cost is unavailable');
      const original = await tx.orm.public.InventoryValuationEntry.first({
        companyId,
        movementId: purchase.id,
      });
      if (
        !original ||
        original.kind !== 'receipt' ||
        original.sequence !== state.sequence ||
        input.quantity !== purchase.quantity
      )
        throw new ConflictException(
          'Later valuation activity depends on this receipt. Use a documented current-period correction instead',
        );
      valueDeltaCents = -Math.abs(delta) * purchase.unitCostCents;
    } else valueDeltaCents = -issueValue(state.pool, Math.abs(delta)).costCents;
  }
  const after = validatePool({
    quantity: state.pool.quantity + delta,
    valueCents: state.pool.valueCents + valueDeltaCents,
  });
  return {
    quantityDelta: delta,
    valueDeltaCents,
    quantityAfter: after.quantity,
    valueAfterCents: after.valueCents,
  };
}
