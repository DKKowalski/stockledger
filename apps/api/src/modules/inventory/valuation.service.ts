import { applyStockOperation, stockOperationPreview } from './exact-stock-operations.js';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import { CostReadinessService } from './cost-readiness.service.js';
import { PrepareValuationDto, valuationInput, type ValuationInput } from './dto/valuation.dto.js';
import { averageCost, receiveValue, validatePool } from './exact-costing.js';
import { reconcileValuation, stockPositions, valuationState } from './valuation-ledger.js';

const varchar = <N extends number>(v: string) => v as Varchar<N>;
@Injectable()
export class ValuationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly costs: CostReadinessService,
  ) {}
  enabled(companyId: string) {
    return (
      ['development', 'test'].includes(this.config.get<string>('app.environment') ?? '') &&
      (this.config.get<string[]>('app.exactCostingCompanyIds') ?? []).includes(companyId)
    );
  }
  private assertEnabled(companyId: string) {
    if (!this.enabled(companyId)) throw new ForbiddenException('Exact costing writes are not enabled for this development business');
  }
  private assertStockOperations(companyId: string) {
    if (!(this.config.get<string[]>('app.stockOperationsCompanyIds') ?? []).includes(companyId))
      throw new ForbiddenException('Exact stock operations are not enabled for this development business');
  }
  async stockStatus(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.administrator(tx, companyId, userId, false, true);
      const existing = await tx.orm.public.InventoryValuationCheckpoint.first({ companyId });
      return {
        available: this.enabled(companyId) && (this.config.get<string[]>('app.stockOperationsCompanyIds') ?? []).includes(companyId),
        hasEnrolledItems: !!existing,
        developmentOnly: true,
      };
    });
  }
  async stockItem(userId: string, companyId: string, itemId: string) {
    return this.prisma.withCompany(
      companyId,
      async (tx) => {
        await this.administrator(tx, companyId, userId, false, true);
        const current = await this.currentInTransaction(tx, companyId, itemId);
        const receipts = await tx.orm.public.StockMovement.where({ companyId, itemId, type: 'purchase' })
          .orderBy([(r) => r.createdAt.desc()])
          .all();
        const { costReview: _review, ...state } = current;
        return {
          ...state,
          available: this.enabled(companyId) && (this.config.get<string[]>('app.stockOperationsCompanyIds') ?? []).includes(companyId),
          receipts: receipts.map((r) => ({
            id: r.id,
            quantity: r.quantity,
            locationId: r.locationId,
            date: r.movementDate,
            reference: r.reference,
            unitCostCents: r.unitCostCents,
          })),
        };
      },
      { consistentSnapshot: true },
    );
  }
  private async administrator(tx: PrismaTransaction, companyId: string, userId: string, writing = false, allowManager = false) {
    if (writing)
      await tx.query(
        this.prisma.client.raw.sql`SELECT id FROM public.users WHERE company_id=${companyId}::uuid AND id=${userId}::uuid FOR SHARE`
          .returnsRow({ id: 'pg/uuid@1' })
          .build(),
      );
    const actor = await tx.orm.public.User.first({ companyId, id: userId });
    if (!actor?.isActive) throw new UnauthorizedException('Account is not available');
    if (actor.role !== 'administrator' && !(allowManager && actor.role === 'inventory_manager'))
      throw new ForbiddenException('Only an administrator can manage exact purchase costs');
  }
  private async requestLock(tx: PrismaTransaction, companyId: string, key: string) {
    await tx.query(
      this.prisma.client.raw.sql`SELECT true AS locked FROM pg_advisory_xact_lock(hashtextextended(${`valuation:${companyId}:${key}`},0))`
        .returnsRow({ locked: 'pg/bool@1' })
        .build(),
    );
  }
  async status(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.administrator(tx, companyId, userId);
      const existing = await tx.orm.public.InventoryValuationCheckpoint.first({ companyId });
      return { available: this.enabled(companyId), hasEnrolledItems: !!existing, developmentOnly: true as const };
    });
  }
  async currentInTransaction(tx: PrismaTransaction, companyId: string, itemId: string) {
    const item = await tx.orm.public.InventoryItem.first({ companyId, id: itemId });
    const company = await tx.orm.public.Company.first({ id: companyId });
    if (!item) throw new NotFoundException('Inventory item not found');
    if (!company) throw new UnauthorizedException('Business no longer exists');
    const state = await valuationState(tx, companyId, itemId);
    const positions = state ? await reconcileValuation(tx, companyId, itemId, state) : await stockPositions(tx, companyId, itemId);
    return {
      available: this.enabled(companyId),
      developmentOnly: true as const,
      currency: company.currency,
      allowNegativeStock: company.allowNegativeStock,
      item: {
        id: item.id,
        name: item.name,
        unit: item.unit,
        unitCostCents: item.unitCostCents,
        updatedAt: item.updatedAt,
        isActive: item.isActive,
      },
      quantity: positions.reduce((sum, p) => sum + p.closing, 0),
      hasNegativePosition: positions.some((p) => p.closing < 0),
      checkpoint: state?.checkpoint ?? null,
      sequence: state?.sequence ?? 0,
      valueCents: state?.pool.valueCents ?? null,
      positions: positions.map((p) => ({ locationId: p.location.id, name: p.location.name, quantity: p.closing })),
      costReview: await this.costs.current(tx, companyId, itemId),
    };
  }
  async get(userId: string, companyId: string, itemId: string) {
    return this.prisma.withCompany(
      companyId,
      async (tx) => {
        await this.administrator(tx, companyId, userId);
        return this.currentInTransaction(tx, companyId, itemId);
      },
      { consistentSnapshot: true },
    );
  }
  private async present(tx: PrismaTransaction, companyId: string, userId: string, key: string) {
    const request = await tx.orm.public.InventoryValuationRequest.first({ companyId, requestKey: key });
    if (!request) return { request: null };
    if (request.createdByUserId !== userId) throw new ConflictException('This request key belongs to another account');
    await this.administrator(
      tx,
      companyId,
      userId,
      false,
      !request.inputJson || (request.inputJson as Record<string, unknown>).kind === 'stock_operation',
    );
    const checkpoint = await tx.orm.public.InventoryValuationCheckpoint.first({ companyId, requestId: request.id });
    const entries = await tx.orm.public.InventoryValuationEntry.where({ companyId, requestId: request.id })
      .orderBy([(r) => r.sequence.asc()])
      .all();
    const entry = entries[0] ?? null;
    return {
      request: {
        key: request.requestKey,
        status: request.status,
        input: request.inputJson,
        createdAt: request.createdAt,
        finishedAt: request.finishedAt,
      },
      checkpoint,
      entry,
      entries,
    };
  }
  async byKey(userId: string, companyId: string, key: string) {
    return this.prisma.withCompany(
      companyId,
      async (tx) => {
        await this.administrator(tx, companyId, userId, false, true);
        return this.present(tx, companyId, userId, key.toLowerCase());
      },
      { consistentSnapshot: true },
    );
  }
  async prepare(userId: string, companyId: string, body: PrepareValuationDto) {
    const parsed = valuationInput.safeParse(body.input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const input = parsed.data;
    const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const key = body.requestKey.toLowerCase();
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.administrator(tx, companyId, userId, true, input.kind === 'stock_operation');
      await this.requestLock(tx, companyId, key);
      const prior = await tx.orm.public.InventoryValuationRequest.first({ companyId, requestKey: key });
      if (prior) {
        if (prior.createdByUserId !== userId || (prior.inputHash !== inputHash && prior.status !== 'cancelled'))
          throw new ConflictException('This request key has already been used');
        return this.present(tx, companyId, userId, key);
      }
      this.assertEnabled(companyId);
      if (input.kind === 'stock_operation') this.assertStockOperations(companyId);
      if (!(await tx.orm.public.InventoryItem.first({ companyId, id: input.itemId })))
        throw new NotFoundException('Inventory item not found');
      let storedInput: unknown = input;
      if (input.kind === 'stock_operation') {
        const current = await this.currentInTransaction(tx, companyId, input.itemId);
        this.validateCurrent(input, current);
        storedInput = { ...input, preparedPreview: await stockOperationPreview(tx, companyId, input) };
      }
      await tx.orm.public.InventoryValuationRequest.create({
        companyId,
        requestKey: key,
        createdByUserId: userId,
        itemId: input.itemId,
        inputJson: storedInput as typeof input,
        inputHash: varchar<64>(inputHash),
        status: varchar<12>('prepared'),
      });
      return this.present(tx, companyId, userId, key);
    });
  }
  async cancel(userId: string, companyId: string, key: string) {
    key = key.toLowerCase();
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.administrator(tx, companyId, userId, true, true);
      await this.requestLock(tx, companyId, key);
      const prior = await tx.orm.public.InventoryValuationRequest.first({ companyId, requestKey: key });
      if (prior && prior.createdByUserId !== userId) throw new ConflictException('This request key belongs to another account');
      if (prior)
        await this.administrator(
          tx,
          companyId,
          userId,
          false,
          !prior.inputJson || (prior.inputJson as Record<string, unknown>).kind === 'stock_operation',
        );
      if (!prior)
        await tx.orm.public.InventoryValuationRequest.create({
          companyId,
          requestKey: key,
          createdByUserId: userId,
          status: varchar<12>('cancelled'),
          finishedAt: new Date().toISOString(),
        });
      else if (prior.status === 'prepared')
        await tx.orm.public.InventoryValuationRequest.where({ companyId, id: prior.id }).update({
          status: varchar<12>('cancelled'),
          finishedAt: new Date().toISOString(),
        });
      return this.present(tx, companyId, userId, key);
    });
  }
  private validateCurrent(input: ValuationInput, current: Awaited<ReturnType<ValuationService['currentInTransaction']>>) {
    if (!current.item.isActive) throw new ConflictException('Restore this item before recording costs');
    if (current.allowNegativeStock || current.hasNegativePosition)
      throw new ConflictException('Exact costing requires nonnegative stock at every location');
    if (
      input.expectedUnit !== current.item.unit ||
      input.expectedCurrency !== current.currency ||
      input.expectedItemUpdatedAt !== current.item.updatedAt ||
      input.expectedQuantity !== current.quantity ||
      input.expectedSequence !== current.sequence
    ) {
      throw new ConflictException('Stock or cost details changed. Cancel this request and review current values');
    }
    if (input.kind === 'checkpoint') {
      if (current.checkpoint) throw new ConflictException('This item already has an exact opening balance');
      validatePool({ quantity: current.quantity, valueCents: input.valueCents });
      if (current.quantity > 0 && (current.costReview.state !== 'confirmed' || current.costReview.review?.id !== input.costReviewId))
        throw new ConflictException('Review the current purchase cost before verifying an opening balance');
      if (
        current.quantity > 0 &&
        input.valueCents === 0 &&
        (!input.freeStockConfirmed || current.costReview.review?.source !== 'free_acquisition')
      )
        throw new ConflictException('Confirm that zero-value stock was acquired free of charge');
    } else {
      if (!current.checkpoint) throw new ConflictException('Verify an exact opening balance first');
      if (current.checkpoint.currency !== current.currency || current.checkpoint.baseUnit !== current.item.unit)
        throw new ConflictException('Currency or base unit no longer matches the verified opening balance');
      if (input.kind === 'receipt' && input.unitCostCents === 0 && !input.freeStockConfirmed)
        throw new ConflictException('Confirm free acquisition before recording zero value');
    }
  }
  async apply(userId: string, companyId: string, key: string) {
    key = key.toLowerCase();
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.administrator(tx, companyId, userId, true, true);
      await this.requestLock(tx, companyId, key);
      const request = await tx.orm.public.InventoryValuationRequest.first({ companyId, requestKey: key });
      if (!request) throw new NotFoundException('Prepare this request before applying it');
      if (request.createdByUserId !== userId) throw new ConflictException('This request key belongs to another account');
      await this.administrator(
        tx,
        companyId,
        userId,
        false,
        !request.inputJson || (request.inputJson as Record<string, unknown>).kind === 'stock_operation',
      );
      if (request.status !== 'prepared') return this.present(tx, companyId, userId, key);
      this.assertEnabled(companyId);
      await tx.query(
        this.prisma.client.raw.sql`SELECT id FROM public.companies WHERE id=${companyId}::uuid FOR SHARE`
          .returnsRow({ id: 'pg/uuid@1' })
          .build(),
      );
      const { preparedPreview: _preview, ...storedInput } = request.inputJson as Record<string, unknown>;
      const input = valuationInput.parse(storedInput);
      await this.administrator(tx, companyId, userId, false, input.kind === 'stock_operation');
      if (input.kind === 'stock_operation') this.assertStockOperations(companyId);
      const locked = await tx.query(
        this.prisma.client.raw
          .sql`SELECT id FROM public.inventory_items WHERE company_id=${companyId}::uuid AND id=${input.itemId}::uuid FOR UPDATE`
          .returnsRow({ id: 'pg/uuid@1' })
          .build(),
      );
      if (!locked.length) throw new NotFoundException('Inventory item not found');
      const current = await this.currentInTransaction(tx, companyId, input.itemId);
      this.validateCurrent(input, current);
      this.assertEnabled(companyId);
      let nextPool = { quantity: current.quantity, valueCents: current.valueCents ?? 0 };
      if (input.kind === 'checkpoint') {
        nextPool = { quantity: current.quantity, valueCents: input.valueCents };
        await tx.orm.public.InventoryValuationCheckpoint.create({
          companyId,
          itemId: input.itemId,
          requestId: request.id,
          createdByUserId: userId,
          baseUnit: varchar<20>(current.item.unit),
          currency: varchar<3>(current.currency),
          openingQuantity: current.quantity,
          openingValueCents: input.valueCents,
          reference: varchar<200>(input.reference),
          costReviewId: input.costReviewId,
        });
      } else if (input.kind === 'stock_operation') {
        nextPool = (await applyStockOperation(tx, companyId, userId, request.id, input)).pool;
      } else {
        let movementId: string | null = null;
        if (input.kind === 'receipt') {
          if (!(await tx.orm.public.Location.first({ companyId, id: input.locationId }))) throw new NotFoundException('Place not found');
          if (input.supplierId && !(await tx.orm.public.Supplier.first({ companyId, id: input.supplierId, isActive: true })))
            throw new NotFoundException('Supplier not found');
          nextPool = receiveValue(nextPool, input.quantity, input.unitCostCents).pool;
          const movement = await tx.orm.public.StockMovement.create({
            companyId,
            itemId: input.itemId,
            locationId: input.locationId,
            type: 'purchase',
            quantity: input.quantity,
            unitCostCents: input.unitCostCents,
            supplierId: input.supplierId,
            movementDate: input.movementDate,
            reference: varchar<80>(input.reference.slice(0, 80)),
            note: varchar<500>(`Exact-cost receipt: ${input.reference}`),
          });
          movementId = movement.id;
        } else nextPool = validatePool({ quantity: current.quantity, valueCents: input.valueCents });
        await tx.orm.public.InventoryValuationEntry.create({
          companyId,
          itemId: input.itemId,
          checkpointId: current.checkpoint!.id,
          requestId: request.id,
          movementId,
          createdByUserId: userId,
          sequence: current.sequence + 1,
          kind: varchar<20>(input.kind),
          quantityDelta: nextPool.quantity - current.quantity,
          valueDeltaCents: nextPool.valueCents - current.valueCents!,
          quantityAfter: nextPool.quantity,
          valueAfterCents: nextPool.valueCents,
          reference: varchar<200>(input.reference),
        });
      }
      const average = averageCost(nextPool);
      if (average !== null) await tx.orm.public.InventoryItem.where({ companyId, id: input.itemId }).update({ unitCostCents: average });
      await tx.orm.public.AuditEvent.create({
        companyId,
        actorUserId: userId,
        action: varchar<80>(`inventory.valuation_${input.kind}`),
        entityType: varchar<80>('inventory_item'),
        entityId: input.itemId,
        metadata: {
          requestId: request.id,
          reference: input.reference,
          quantity: nextPool.quantity,
          valueCents: nextPool.valueCents,
          ...(input.kind === 'value_adjustment' ? { reason: input.reason, previousValueCents: current.valueCents } : {}),
          ...(input.kind === 'stock_operation'
            ? {
                operation: input.operation,
                reason: input.reason,
                supplierCreditCents: input.supplierCreditCents,
                originalMovementId: input.originalMovementId,
                creditProcessed: false,
              }
            : {}),
          developmentOnly: true,
        },
      });
      await tx.orm.public.InventoryValuationRequest.where({ companyId, id: request.id }).update({
        status: varchar<12>('applied'),
        finishedAt: new Date().toISOString(),
      });
      return this.present(tx, companyId, userId, key);
    });
  }
}
