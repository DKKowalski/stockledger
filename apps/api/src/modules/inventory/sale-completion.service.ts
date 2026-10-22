import { averageCost, issueValue, splitCostComponents } from './exact-costing.js';
import { reconcileValuation, valuationState } from './valuation-ledger.js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import type { MovementRecord } from './inventory-calculations.js';
import { buildSnapshot } from './inventory-calculations.js';
import { hybridPricingSwitchedOn } from './hybrid-pricing.js';
import { PricingPreviewService } from './pricing-preview.service.js';
import { CompleteSaleDto, SaleQuoteDto } from './dto/sale.dto.js';

type Actor = { id: string; role: string; locationId: string | null };
type QuoteEnvelope = { version: 1; companyId: string; userId: string; locationId: string; currency: string; expiresAt: number; input: SaleQuoteDto; fingerprint: string };
const varchar = <N extends number>(value: string) => value as Varchar<N>;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
// Explicit bounded integer-cent contract. Never round or overflow a database money field.
function amount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new BadRequestException('Checkout supports totals up to 2147483647 cents');
  return value;
}

@Injectable()
export class SaleCompletionService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly pricing: PricingPreviewService) {}

  private async enabled(tx: PrismaTransaction, companyId: string) {
    const allowlisted = ['development', 'test'].includes(this.config.get<string>('app.environment') ?? '')
      && (this.config.get<string[]>('app.saleCompletionCompanyIds') ?? []).includes(companyId)
      && (this.config.get<string[]>('app.pricingPreviewCompanyIds') ?? []).includes(companyId);
    return allowlisted || hybridPricingSwitchedOn(tx, companyId);
  }

  private async assertEnabled(tx: PrismaTransaction, companyId: string) {
    if (!await this.enabled(tx, companyId)) throw new ForbiddenException('Box and quantity deals are switched off for this business');
  }

  private async actor(tx: PrismaTransaction, userId: string, companyId: string, writing = false) {
    if (writing) await tx.query(this.prisma.client.raw.sql`
      SELECT id FROM public.users WHERE id = ${userId}::uuid AND company_id = ${companyId}::uuid FOR SHARE
    `.returnsRow({ id: 'pg/uuid@1' }).build());
    const actor = await tx.orm.public.User.first({ id: userId, companyId });
    if (!actor?.isActive) throw new UnauthorizedException('Account is not available');
    if (writing && actor.role !== 'shop_attendant') throw new ForbiddenException('Only a shop attendant can complete a sale');
    if (!writing && actor.role !== 'shop_attendant' && actor.role !== 'administrator') throw new ForbiddenException('Sale records are not available to this role');
    if (actor.role === 'shop_attendant') {
      const shop = actor.locationId && await tx.orm.public.Location.first({ id: actor.locationId, companyId, type: 'shop' });
      if (!shop) throw new ForbiddenException('This account must be assigned to a shop');
    }
    return actor;
  }

  async status(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const user = await tx.orm.public.User.first({ id: userId, companyId });
      if (!user?.isActive) throw new UnauthorizedException('Account is not available');
      const company = await tx.orm.public.Company.first({ id: companyId });
      return { available: await this.enabled(tx, companyId) && user.role === 'shop_attendant' && !company?.allowNegativeStock, developmentOnly: true as const };
    });
  }

  private signature(encoded: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('auth.jwtSecret')).update(`stockledger:sale-quote:v1:${encoded}`).digest('base64url');
  }

  private decode(token: string): QuoteEnvelope {
    try {
      const [encoded, supplied] = token.split('.');
      const expected = this.signature(encoded!);
      if (!supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new Error('signature');
      const envelope = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8')) as QuoteEnvelope;
      if (envelope.version !== 1 || !Number.isSafeInteger(envelope.expiresAt) || envelope.expiresAt <= Date.now()) throw new Error('expired');
      return envelope;
    } catch { throw new ConflictException('The sale quote is invalid or expired. Review a new quote'); }
  }

  private async calculate(tx: PrismaTransaction, userId: string, companyId: string, input: SaleQuoteDto) {
    const company = await tx.orm.public.Company.first({ id: companyId });
    if (!company) throw new UnauthorizedException('Business no longer exists');
    if (company.allowNegativeStock) throw new ConflictException('Checkout needs negative stock switched off in Settings');
    const quote = await this.pricing.quoteInTransaction(tx, userId, companyId, input);
    const lines = [];
    for (const line of quote.lines) {
      const item = await tx.orm.public.InventoryItem.first({ companyId, id: line.itemId });
      // Items without box or quantity deals sell at their single retail price.
      if (!item) throw new NotFoundException('Inventory item not found');
      if (input.lines.some((request) => request.itemId.toLowerCase() === item.id && request.expectedRetailPriceCents !== item.sellingPriceCents)) throw new ConflictException('The retail price changed. Review a new quote');
      const valuation = await valuationState(tx,companyId,item.id);
      if (valuation) {
        if (!['development','test'].includes(this.config.get<string>('app.environment') ?? '') || !(this.config.get<string[]>('app.exactCostingCompanyIds') ?? []).includes(companyId)) throw new ForbiddenException('Exact costing writes are not enabled for this development item');
        if (valuation.checkpoint.currency !== company.currency || valuation.checkpoint.baseUnit !== item.unit) throw new ConflictException('The verified cost currency or unit changed');
        await reconcileValuation(tx,companyId,item.id,valuation);
      }
      const cogsCents = valuation ? issueValue(valuation.pool,line.quantity).costCents : amount(item.unitCostCents * line.quantity);
      amount(line.grossSalesCents); amount(line.totalCents); amount(line.automaticDiscountCents);
      lines.push({ ...line, sku: item.sku, category: item.category, unitCostCents: item.unitCostCents, cogsCents, valuation });
    }
    amount(quote.grossSalesCents); amount(quote.totalCents); amount(quote.automaticDiscountCents);
    const cogsCents = amount(lines.reduce((sum, line) => sum + line.cogsCents, 0));
    // Includes cost privately in a one-way fingerprint, never in the public quote or token payload.
    const fingerprint = hash(JSON.stringify({ currency: quote.currency, movementDate: input.movementDate, lines }));
    return { ...quote, lines, cogsCents, fingerprint };
  }

  async quote(userId: string, companyId: string, input: SaleQuoteDto) {
    input = { ...input, lines: input.lines.map((line) => ({ ...line, itemId: line.itemId.toLowerCase() })) };
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.assertEnabled(tx, companyId);
      const actor = await this.actor(tx, userId, companyId, true);
      const result = await this.calculate(tx, userId, companyId, input);
      const expiresAt = Date.now() + 10 * 60_000;
      const envelope: QuoteEnvelope = { version: 1, companyId, userId, locationId: actor.locationId!, currency: result.currency, expiresAt, input, fingerprint: result.fingerprint };
      const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64url');
      return { canComplete: true as const, developmentOnly: true as const, currency: result.currency, movementDate: input.movementDate,
        expiresAt: new Date(expiresAt).toISOString(), quoteToken: `${encoded}.${this.signature(encoded)}`,
        grossSalesCents: result.grossSalesCents, automaticDiscountCents: result.automaticDiscountCents, totalCents: result.totalCents,
        lines: result.lines.map(({ unitCostCents: _cost, cogsCents: _cogs, valuation: _valuation, ...line }) => line) };
    }, { consistentSnapshot: true });
  }

  async complete(userId: string, companyId: string, body: CompleteSaleDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, userId, companyId, true);
      const key = body.idempotencyKey.toLowerCase();
      // Same-key requests serialize even when their products differ. Hash collisions only cause extra waiting.
      await tx.query(this.prisma.client.raw.sql`
        SELECT true AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${companyId}:${key}`}, 0))
      `.returnsRow({ locked: 'pg/bool@1' }).build());
      const requestHash = hash(body.quoteToken);
      const prior = await tx.orm.public.Sale.first({ companyId, idempotencyKey: key });
      if (prior) {
        if (prior.createdByUserId !== userId || prior.locationId !== actor.locationId || prior.requestHash !== requestHash) throw new ConflictException('This sale request key has already been used');
        return this.present(tx, companyId, prior.id, actor);
      }
      // Recover committed requests before consulting gates or quote expiry.
      await this.assertEnabled(tx, companyId);
      await tx.query(this.prisma.client.raw.sql`
        SELECT id FROM public.companies WHERE id = ${companyId}::uuid FOR SHARE
      `.returnsRow({ id: 'pg/uuid@1' }).build());
      const envelope = this.decode(body.quoteToken);
      if (envelope.companyId !== companyId || envelope.userId !== userId || envelope.locationId !== actor.locationId) throw new ForbiddenException('The sale quote belongs to another account or shop');
      const itemIds = [...new Set(envelope.input.lines.map((line) => line.itemId))].sort();
      for (const itemId of itemIds) {
        const locked = await tx.query(this.prisma.client.raw.sql`
          SELECT id FROM public.inventory_items WHERE id = ${itemId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE
        `.returnsRow({ id: 'pg/uuid@1' }).build());
        if (!locked.length) throw new NotFoundException('Inventory item not found');
      }
      await this.assertEnabled(tx, companyId);
      if (envelope.expiresAt <= Date.now()) throw new ConflictException('The sale quote expired while waiting. Review a new quote');
      const result = await this.calculate(tx, userId, companyId, envelope.input);
      if (result.fingerprint !== envelope.fingerprint || result.currency !== envelope.currency) throw new ConflictException('Prices, item details or recorded costs changed. Review a new quote');
      for (const line of result.lines) {
        const [items, stocks, movements, locations] = await Promise.all([
          tx.orm.public.InventoryItem.where({ companyId, id: line.itemId }).all(),
          tx.orm.public.LocationStock.where({ companyId, itemId: line.itemId }).all(),
          tx.orm.public.StockMovement.where({ companyId, itemId: line.itemId }).all(),
          tx.orm.public.Location.where({ companyId, id: actor.locationId! }).all(),
        ]);
        const current = buildSnapshot(items, locations, stocks, movements as MovementRecord[], 30, actor.locationId).positions[0]?.closing ?? 0;
        if (line.quantity > current) throw new ConflictException(`Only ${current} ${line.baseUnit} available for ${line.itemName}`);
      }
      const sale = await tx.orm.public.Sale.create({ companyId, locationId: actor.locationId!, createdByUserId: userId,
        idempotencyKey: key, requestHash: varchar<64>(requestHash), currency: varchar<3>(result.currency), movementDate: envelope.input.movementDate,
        grossSalesCents: result.grossSalesCents, automaticDiscountCents: result.automaticDiscountCents, totalCents: result.totalCents, cogsCents: result.cogsCents });
      for (const [position, line] of result.lines.entries()) {
        const savedLine = await tx.orm.public.SaleLine.create({ companyId, saleId: sale.id, itemId: line.itemId, position,
          itemName: varchar<120>(line.itemName), sku: line.sku, category: line.category, baseUnit: varchar<20>(line.baseUnit), quantity: line.quantity,
          valuationCheckpointId: line.valuation?.checkpoint.id ?? null, retailPriceCents: line.retailPriceCents!, unitCostCents: line.unitCostCents, cogsCents: line.cogsCents,
          grossSalesCents: line.grossSalesCents, automaticDiscountCents: line.automaticDiscountCents, totalCents: line.totalCents,
          pricingSnapshot: { version: line.pricingVersion, package: line.package, packageCount: line.packageCount, inputs: line.inputs.map((entry) => ({ ...entry, quantityUnit: entry.quantityUnit ?? 'base' })) } });
        const parts = line.valuation ? splitCostComponents(line.components,line.cogsCents) : line.components.map(part => ({...part,unitCostCents:line.unitCostCents}));
        let pool = line.valuation?.pool;
        let sequence = line.valuation?.sequence ?? 0;
        for (const [componentPosition, part] of parts.entries()) {
          const movement = await tx.orm.public.StockMovement.create({ companyId, itemId: line.itemId, locationId: actor.locationId!, type: 'sale', quantity: part.quantity,
            unitPriceCents: part.unitPriceCents, unitCostCents: part.unitCostCents, movementDate: envelope.input.movementDate });
          await tx.orm.public.SaleComponent.create({ companyId, saleLineId: savedLine.id, movementId: movement.id, position: componentPosition,
            category: varchar<10>(part.category), quantity: part.quantity, unitPriceCents: part.unitPriceCents, totalCents: part.totalCents });
          if (pool && line.valuation) {
            const cost = part.quantity * part.unitCostCents;
            pool = {quantity:pool.quantity-part.quantity,valueCents:pool.valueCents-cost};
            await tx.orm.public.InventoryValuationEntry.create({ companyId,itemId:line.itemId,checkpointId:line.valuation.checkpoint.id,movementId:movement.id,createdByUserId:userId,
              sequence:++sequence,kind:varchar<20>('sale'),quantityDelta:-part.quantity,valueDeltaCents:-cost,quantityAfter:pool.quantity,valueAfterCents:pool.valueCents,reference:varchar<200>(`Sale ${sale.id}`) });
          }
        }
        if (pool) {
          const average = averageCost(pool);
          if (average !== null) await tx.orm.public.InventoryItem.where({ companyId,id:line.itemId }).update({unitCostCents:average});
        }
      }
      await tx.orm.public.AuditEvent.create({ companyId, actorUserId: userId, action: varchar<80>('inventory.sale_completed'), entityType: varchar<80>('sale'), entityId: sale.id,
        metadata: { lineCount: result.lines.length, grossSalesCents: result.grossSalesCents, automaticDiscountCents: result.automaticDiscountCents, totalCents: result.totalCents, developmentOnly: true } });
      return this.present(tx, companyId, sale.id, actor);
    });
  }

  private async present(tx: PrismaTransaction, companyId: string, id: string, actor: Actor) {
    const sale = await tx.orm.public.Sale.first({ companyId, id });
    if (!sale || (actor.role === 'shop_attendant' && sale.locationId !== actor.locationId)) throw new NotFoundException('Sale not found');
    const lines = await tx.orm.public.SaleLine.where({ companyId, saleId: id }).orderBy([(row) => row.position.asc()]).all();
    const presented = [];
    for (const line of lines) {
      const components = await tx.orm.public.SaleComponent.where({ companyId, saleLineId: line.id }).orderBy([(row) => row.position.asc()]).all();
      const { unitCostCents, cogsCents, ...publicLine } = line;
      presented.push({ ...publicLine, ...(actor.role === 'administrator' ? { unitCostCents, cogsCents } : {}), components });
    }
    const { cogsCents, requestHash: _hash, ...publicSale } = sale;
    return { ...publicSale, ...(actor.role === 'administrator' ? { cogsCents } : {}), status: 'completed' as const, lines: presented };
  }

  async get(userId: string, companyId: string, id: string) {
    return this.prisma.withCompany(companyId, async (tx) => this.present(tx, companyId, id, await this.actor(tx, userId, companyId)));
  }

  async byKey(userId: string, companyId: string, key: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.actor(tx, userId, companyId);
      const sale = await tx.orm.public.Sale.first({ companyId, idempotencyKey: key });
      // Keys are scoped to the submitting actor; absence is not proof an in-flight request failed.
      return { sale: sale && sale.createdByUserId === userId && sale.locationId === actor.locationId ? await this.present(tx, companyId, sale.id, actor) : null };
    });
  }
}
