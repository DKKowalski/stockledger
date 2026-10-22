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
import { returnInput, type ReturnInput, PrepareReturnDto } from './dto/return.dto.js';
import { allocateReturn, type OriginalPortion } from './return-calculations.js';
import { averageCost, validatePool } from './exact-costing.js';
import { hybridPricingSwitchedOn } from './hybrid-pricing.js';
import { reconcileValuation, valuationState } from './valuation-ledger.js';
const v = <N extends number>(s: string) => s as Varchar<N>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
@Injectable()
export class SaleReturnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  private async enabled(tx: PrismaTransaction, companyId: string) {
    const allowlisted =
      ['development', 'test'].includes(this.config.get<string>('app.environment') ?? '') &&
      (this.config.get<string[]>('app.saleReturnsCompanyIds') ?? []).includes(companyId);
    return allowlisted || hybridPricingSwitchedOn(tx, companyId);
  }
  private async assertEnabled(tx: PrismaTransaction, companyId: string) {
    if (!(await this.enabled(tx, companyId)))
      throw new ForbiddenException('Customer returns are switched off for this business');
  }
  private async administrator(tx: PrismaTransaction, companyId: string, userId: string, writing = false) {
    if (writing)
      await tx.query(
        this.prisma.client.raw
          .sql`SELECT id FROM public.users WHERE company_id=${companyId}::uuid AND id=${userId}::uuid FOR SHARE`
          .returnsRow({ id: 'pg/uuid@1' })
          .build(),
      );
    const user = await tx.orm.public.User.first({ companyId, id: userId });
    if (!user?.isActive) throw new UnauthorizedException('Account is not available');
    if (user.role !== 'administrator')
      throw new ForbiddenException('Only an administrator can authorize a return or reversal');
  }
  private async lockKey(tx: PrismaTransaction, companyId: string, key: string) {
    await tx.query(
      this.prisma.client.raw
        .sql`SELECT true AS locked FROM pg_advisory_xact_lock(hashtextextended(${`return:${companyId}:${key}`},0))`
        .returnsRow({ locked: 'pg/bool@1' })
        .build(),
    );
  }
  private async source(tx: PrismaTransaction, companyId: string, type: 'grouped' | 'legacy', id: string) {
    const company = await tx.orm.public.Company.first({ id: companyId });
    if (!company) throw new UnauthorizedException('Business no longer exists');
    const portions: OriginalPortion[] = [];
    const labels: Array<{
      itemId: string;
      name: string;
      unit: string;
      active: boolean;
      originalUnit: string;
    }> = [];
    let locationId: string, currency: string, date: string;
    const append = async (movementId: string, originalUnit?: string) => {
      const movement = await tx.orm.public.StockMovement.first({ companyId, id: movementId, type: 'sale' });
      if (!movement) throw new ConflictException('Original sale movement is missing');
      const item = await tx.orm.public.InventoryItem.first({ companyId, id: movement.itemId });
      if (!item) throw new NotFoundException('Original item not found');
      const returns = await tx.orm.public.StockMovement.where({
        companyId,
        relatedMovementId: movement.id,
        type: 'return_in',
      }).all();
      portions.push({
        movementId: movement.id,
        itemId: item.id,
        quantity: movement.quantity,
        returned: returns.reduce((s, m) => s + m.quantity, 0),
        unitPriceCents: movement.unitPriceCents,
        unitCostCents: movement.unitCostCents,
      });
      if (!labels.some((l) => l.itemId === item.id))
        labels.push({
          itemId: item.id,
          name: item.name,
          unit: item.unit,
          active: item.isActive,
          originalUnit: originalUnit ?? item.unit,
        });
      return movement;
    };
    if (type === 'grouped') {
      const sale = await tx.orm.public.Sale.first({ companyId, id });
      if (!sale) throw new NotFoundException('Original sale not found');
      locationId = sale.locationId;
      currency = sale.currency;
      date = sale.movementDate;
      const lines = await tx.orm.public.SaleLine.where({ companyId, saleId: id })
        .orderBy([(r) => r.position.asc()])
        .all();
      for (const line of lines) {
        const components = await tx.orm.public.SaleComponent.where({ companyId, saleLineId: line.id })
          .orderBy([(r) => r.position.asc()])
          .all();
        for (const part of components) await append(part.movementId, line.baseUnit);
      }
    } else {
      if (await tx.orm.public.SaleComponent.first({ companyId, movementId: id }))
        throw new ConflictException('Use the grouped sale reference for this movement');
      const movement = await append(id);
      locationId = movement.locationId;
      currency = company.currency;
      date = movement.movementDate;
    }
    const lines = labels.map((label) => ({
      ...label,
      remainingQuantity: portions
        .filter((p) => p.itemId === label.itemId)
        .reduce((s, p) => s + p.quantity - p.returned, 0),
      costKnown: portions
        .filter((p) => p.itemId === label.itemId)
        .every((p) => p.unitCostCents !== null && p.unitPriceCents !== null),
    }));
    const revision = hash({ type, id, locationId, currency, portions, labels });
    return {
      sourceType: type,
      sourceId: id,
      locationId,
      currency,
      movementDate: date,
      revision,
      lines,
      portions,
    };
  }
  async sources(userId: string, companyId: string) {
    return this.prisma.withCompany(
      companyId,
      async (tx) => {
        await this.administrator(tx, companyId, userId);
        // Availability checks must not scan sale history for businesses that have not opted in.
        if (!(await this.enabled(tx, companyId))) return { available: false, developmentOnly: true, sources: [] };
        const sales = await tx.orm.public.Sale.where({ companyId })
          .orderBy([(r) => r.createdAt.desc()])
          .limit(100)
          .all();
        const components = await tx.orm.public.SaleComponent.where({ companyId }).all();
        const groupedIds = new Set(components.map((p) => p.movementId));
        const movements = await tx.orm.public.StockMovement.where({ companyId, type: 'sale' })
          .orderBy([(r) => r.createdAt.desc()])
          .all();
        return {
          available: true,
          developmentOnly: true,
          sources: [
            ...sales.map((s) => ({
              id: s.id,
              type: 'grouped' as const,
              date: s.movementDate,
              totalCents: s.totalCents,
              reference: `Sale ${s.id.slice(0, 8)}`,
            })),
            ...movements
              .filter((m) => !groupedIds.has(m.id))
              .slice(0, 100)
              .map((m) => ({
                id: m.id,
                type: 'legacy' as const,
                date: m.movementDate,
                totalCents: m.unitPriceCents === null ? null : m.unitPriceCents * m.quantity,
                reference: m.reference ?? `Sale ${m.id.slice(0, 8)}`,
              })),
          ],
        };
      },
      { consistentSnapshot: true },
    );
  }
  async getSource(userId: string, companyId: string, type: string, id: string) {
    if (type !== 'grouped' && type !== 'legacy') throw new BadRequestException('Choose a valid sale source');
    return this.prisma.withCompany(
      companyId,
      async (tx) => {
        await this.administrator(tx, companyId, userId);
        return this.source(tx, companyId, type, id);
      },
      { consistentSnapshot: true },
    );
  }
  private plan(source: Awaited<ReturnType<SaleReturnService['source']>>, input: ReturnInput) {
    if (input.expectedRevision !== source.revision)
      throw new ConflictException(
        'Returnable quantities changed. Cancel this request and review the original sale again',
      );
    for (const choice of input.lines) {
      const line = source.lines.find((l) => l.itemId === choice.itemId);
      if (!line) throw new ConflictException('Choose an item from the original sale');
      if (line.unit !== line.originalUnit)
        throw new ConflictException('The original sale unit differs from the current item unit');
      if (choice.disposition === 'resellable' && !line.active)
        throw new ConflictException('Restore the item before adding returned stock');
    }
    if (
      input.kind === 'reversal' &&
      (input.lines.length !== source.lines.filter((l) => l.remainingQuantity > 0).length ||
        input.lines.some(
          (l) => l.quantity !== source.lines.find((s) => s.itemId === l.itemId)?.remainingQuantity,
        ))
    )
      throw new ConflictException('A reversal must include all remaining unreturned units');
    return {
      ...allocateReturn(source.portions, input.lines),
      currency: source.currency,
      locationId: source.locationId,
    };
  }
  private async present(tx: PrismaTransaction, companyId: string, userId: string, key: string) {
    const request = await tx.orm.public.SaleReturnRequest.first({ companyId, requestKey: key });
    if (!request) return { request: null };
    if (request.createdByUserId !== userId)
      throw new ConflictException('This request key belongs to another account');
    const result = await tx.orm.public.SaleReturn.first({ companyId, requestId: request.id });
    const allocations = result
      ? await tx.orm.public.SaleReturnAllocation.where({ companyId, returnId: result.id })
          .orderBy([(r) => r.position.asc()])
          .all()
      : [];
    return {
      request: {
        key: request.requestKey,
        status: request.status,
        input: request.inputJson,
        preview: request.previewJson,
      },
      result: result ? { ...result, allocations, refundStatus: 'not_processed' as const } : null,
    };
  }
  async byKey(userId: string, companyId: string, key: string) {
    return this.prisma.withCompany(
      companyId,
      async (tx) => {
        await this.administrator(tx, companyId, userId);
        return this.present(tx, companyId, userId, key.toLowerCase());
      },
      { consistentSnapshot: true },
    );
  }
  async prepare(userId: string, companyId: string, body: PrepareReturnDto) {
    const parsed = returnInput.safeParse(body.input);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    const input = parsed.data,
      key = body.requestKey.toLowerCase(),
      inputHash = hash(input);
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.administrator(tx, companyId, userId, true);
      await this.lockKey(tx, companyId, key);
      const prior = await tx.orm.public.SaleReturnRequest.first({ companyId, requestKey: key });
      if (prior) {
        if (
          prior.createdByUserId !== userId ||
          (prior.status !== 'cancelled' && prior.inputHash !== inputHash)
        )
          throw new ConflictException('This request key has already been used');
        return this.present(tx, companyId, userId, key);
      }
      await this.assertEnabled(tx, companyId);
      const source = await this.source(tx, companyId, input.sourceType, input.sourceId),
        preview = this.plan(source, input);
      await tx.orm.public.SaleReturnRequest.create({
        companyId,
        requestKey: key,
        createdByUserId: userId,
        inputJson: input,
        previewJson: preview,
        inputHash: v<64>(inputHash),
        status: v<12>('prepared'),
      });
      return this.present(tx, companyId, userId, key);
    });
  }
  async cancel(userId: string, companyId: string, key: string) {
    key = key.toLowerCase();
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.administrator(tx, companyId, userId, true);
      await this.lockKey(tx, companyId, key);
      const prior = await tx.orm.public.SaleReturnRequest.first({ companyId, requestKey: key });
      if (prior && prior.createdByUserId !== userId)
        throw new ConflictException('This request key belongs to another account');
      if (!prior)
        await tx.orm.public.SaleReturnRequest.create({
          companyId,
          requestKey: key,
          createdByUserId: userId,
          status: v<12>('cancelled'),
          finishedAt: new Date().toISOString(),
        });
      else if (prior.status === 'prepared')
        await tx.orm.public.SaleReturnRequest.where({ companyId, id: prior.id }).update({
          status: v<12>('cancelled'),
          finishedAt: new Date().toISOString(),
        });
      return this.present(tx, companyId, userId, key);
    });
  }
  async apply(userId: string, companyId: string, key: string) {
    key = key.toLowerCase();
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.administrator(tx, companyId, userId, true);
      await this.lockKey(tx, companyId, key);
      const request = await tx.orm.public.SaleReturnRequest.first({ companyId, requestKey: key });
      if (!request) throw new NotFoundException('Prepare this return before confirming it');
      if (request.createdByUserId !== userId)
        throw new ConflictException('This request key belongs to another account');
      if (request.status !== 'prepared') return this.present(tx, companyId, userId, key);
      await this.assertEnabled(tx, companyId);
      await tx.query(
        this.prisma.client.raw.sql`SELECT id FROM public.companies WHERE id=${companyId}::uuid FOR SHARE`
          .returnsRow({ id: 'pg/uuid@1' })
          .build(),
      );
      const input = returnInput.parse(request.inputJson),
        before = await this.source(tx, companyId, input.sourceType, input.sourceId);
      for (const itemId of [...new Set(before.portions.map((p) => p.itemId))].sort())
        await tx.query(
          this.prisma.client.raw
            .sql`SELECT id FROM public.inventory_items WHERE company_id=${companyId}::uuid AND id=${itemId}::uuid FOR UPDATE`
            .returnsRow({ id: 'pg/uuid@1' })
            .build(),
        );
      const source = await this.source(tx, companyId, input.sourceType, input.sourceId),
        plan = this.plan(source, input);
      if (hash(plan) !== hash(request.previewJson))
        throw new ConflictException('The original allocations changed. Review this return again');
      const company = await tx.orm.public.Company.first({ id: companyId });
      if (company?.currency !== source.currency)
        throw new ConflictException('The original sale currency differs from the current business currency');
      const states = new Map<string, NonNullable<Awaited<ReturnType<typeof valuationState>>>>();
      for (const choice of input.lines) {
        const state = await valuationState(tx, companyId, choice.itemId);
        if (state) {
          if (
            !['development', 'test'].includes(this.config.get<string>('app.environment') ?? '') ||
            !(this.config.get<string[]>('app.exactCostingCompanyIds') ?? []).includes(companyId)
          )
            throw new ForbiddenException('Exact-cost writes are disabled');
          if (
            state.checkpoint.currency !== source.currency ||
            state.checkpoint.baseUnit !== source.lines.find((l) => l.itemId === choice.itemId)!.unit
          )
            throw new ConflictException('The verified unit or currency changed');
          await reconcileValuation(tx, companyId, choice.itemId, state);
          states.set(choice.itemId, state);
        }
      }
      const saved = await tx.orm.public.SaleReturn.create({
        companyId,
        requestId: request.id,
        sourceSaleId: input.sourceType === 'grouped' ? input.sourceId : null,
        legacyMovementId: input.sourceType === 'legacy' ? input.sourceId : null,
        locationId: source.locationId,
        createdByUserId: userId,
        kind: v<12>(input.kind),
        currency: v<3>(source.currency),
        movementDate: input.movementDate,
        refundCents: plan.refundCents,
        cogsCents: plan.cogsCents,
        reason: v<200>(input.reason),
        reference: v<200>(input.reference),
      });
      for (const [position, part] of plan.allocations.entries()) {
        const movement = await tx.orm.public.StockMovement.create({
          companyId,
          itemId: part.itemId,
          locationId: source.locationId,
          type: 'return_in',
          quantity: part.quantity,
          unitPriceCents: part.unitPriceCents,
          unitCostCents: part.unitCostCents,
          relatedMovementId: part.originalMovementId,
          movementDate: input.movementDate,
          reference: v<80>(input.reference.slice(0, 80)),
          note: v<500>(`Return ${saved.id}: ${input.reason}`),
        });
        const loss =
          part.disposition === 'damaged'
            ? await tx.orm.public.StockMovement.create({
                companyId,
                itemId: part.itemId,
                locationId: source.locationId,
                type: 'damage',
                quantity: part.quantity,
                unitCostCents: part.unitCostCents,
                movementDate: input.movementDate,
                reference: v<80>(input.reference.slice(0, 80)),
                note: v<500>(`Unsellable return ${saved.id}: ${input.reason}`),
              })
            : null;
        await tx.orm.public.SaleReturnAllocation.create({
          companyId,
          returnId: saved.id,
          itemId: part.itemId,
          originalMovementId: part.originalMovementId,
          returnMovementId: movement.id,
          lossMovementId: loss?.id ?? null,
          position,
          quantity: part.quantity,
          unitPriceCents: part.unitPriceCents,
          unitCostCents: part.unitCostCents,
          refundCents: part.refundCents,
          cogsCents: part.cogsCents,
          disposition: v<12>(part.disposition),
        });
        const state = states.get(part.itemId);
        if (state) {
          const resell = part.disposition === 'resellable';
          const pool = validatePool({
            quantity: state.pool.quantity + (resell ? part.quantity : 0),
            valueCents: state.pool.valueCents + (resell ? part.cogsCents : 0),
          });
          await tx.orm.public.InventoryValuationEntry.create({
            companyId,
            itemId: part.itemId,
            checkpointId: state.checkpoint.id,
            movementId: movement.id,
            createdByUserId: userId,
            sequence: ++state.sequence,
            kind: v<20>(resell ? 'customer_return' : 'return_disposal'),
            quantityDelta: resell ? part.quantity : 0,
            valueDeltaCents: resell ? part.cogsCents : 0,
            quantityAfter: pool.quantity,
            valueAfterCents: pool.valueCents,
            reference: v<200>(input.reference),
          });
          state.pool = pool;
        }
      }
      for (const [itemId, state] of states) {
        const average = averageCost(state.pool);
        if (average !== null)
          await tx.orm.public.InventoryItem.where({ companyId, id: itemId }).update({
            unitCostCents: average,
          });
        await reconcileValuation(tx, companyId, itemId, state);
      }
      await tx.orm.public.AuditEvent.create({
        companyId,
        actorUserId: userId,
        action: v<80>('inventory.sale_returned'),
        entityType: v<80>('sale_return'),
        entityId: saved.id,
        metadata: {
          requestId: request.id,
          kind: input.kind,
          refundCents: plan.refundCents,
          cogsCents: plan.cogsCents,
          refundProcessed: false,
          reference: input.reference,
          reason: input.reason,
        },
      });
      await tx.orm.public.SaleReturnRequest.where({ companyId, id: request.id }).update({
        status: v<12>('applied'),
        finishedAt: new Date().toISOString(),
      });
      return this.present(tx, companyId, userId, key);
    });
  }
}
