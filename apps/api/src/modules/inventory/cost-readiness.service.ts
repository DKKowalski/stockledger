import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { z } from 'zod';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import { ConfirmCostDto } from './dto/cost-review.dto.js';

const action = 'inventory.cost_reviewed' as Varchar<80>;
const entityType = 'inventory_item' as Varchar<80>;
const evidence = z.object({
  version: z.literal(1), costCents: z.number().int().nonnegative(), unit: z.string(), itemUpdatedAt: z.string(), currency: z.string().optional(),
  source: z.enum(['purchase_records', 'opening_records', 'free_acquisition']), reference: z.string(),
}).strict();

@Injectable()
export class CostReadinessService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private enabled(companyId: string) {
    return ['development', 'test'].includes(this.config.get<string>('app.environment') ?? '')
      && (this.config.get<string[]>('app.costReadinessCompanyIds') ?? []).includes(companyId);
  }

  private async administrator(tx: PrismaTransaction, companyId: string, userId: string) {
    const user = await tx.orm.public.User.first({ id: userId, companyId });
    if (!user?.isActive) throw new UnauthorizedException('Account is not available');
    if (user.role !== 'administrator') throw new ForbiddenException('Only an administrator can review purchase costs');
  }

  async status(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.administrator(tx, companyId, userId);
      return { available: this.enabled(companyId), developmentOnly: true as const };
    });
  }

  async current(tx: PrismaTransaction, companyId: string, itemId: string) {
    const company = await tx.orm.public.Company.first({ id: companyId });
    if (!company) throw new UnauthorizedException('Business no longer exists');
    const item = await tx.orm.public.InventoryItem.first({ id: itemId, companyId });
    if (!item) throw new NotFoundException('Inventory item not found');
    const event = await tx.orm.public.AuditEvent.where({ companyId, entityId: itemId, entityType, action })
      .orderBy([(row) => row.createdAt.desc(), (row) => row.id.desc()]).first();
    const parsed = evidence.safeParse(event?.metadata);
    const record = event && parsed.success ? { ...parsed.data, id: event.id, reviewedAt: event.createdAt, reviewedByUserId: event.actorUserId } : null;
    const matches = record?.costCents === item.unitCostCents && record.unit === item.unit && record.itemUpdatedAt === item.updatedAt && record.currency === company.currency;
    return {
      available: this.enabled(companyId), developmentOnly: true as const,
      currency: company.currency,
      item: { id: item.id, name: item.name, unit: item.unit, unitCostCents: item.unitCostCents, updatedAt: item.updatedAt, isActive: item.isActive },
      state: record ? (matches ? 'confirmed' as const : 'changed' as const) : 'unconfirmed' as const,
      review: record,
    };
  }

  async get(userId: string, companyId: string, itemId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.administrator(tx, companyId, userId);
      return this.current(tx, companyId, itemId);
    }, { consistentSnapshot: true });
  }

  async confirm(userId: string, companyId: string, itemId: string, body: ConfirmCostDto) {
    if (!this.enabled(companyId)) throw new ForbiddenException('Cost reviews are not enabled for this development business');
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.administrator(tx, companyId, userId);
      // Settings writers update this company row; pin the currency before taking the item lock.
      await tx.query(this.prisma.client.raw.sql`
        SELECT id FROM public.companies WHERE id = ${companyId}::uuid FOR SHARE
      `.returnsRow({ id: 'pg/uuid@1' }).build());
      // Every existing purchase/item writer takes this same lock. Never update the item here.
      const locked = await tx.query(this.prisma.client.raw.sql`
        SELECT id FROM public.inventory_items WHERE company_id = ${companyId}::uuid AND id = ${itemId}::uuid FOR UPDATE
      `.returnsRow({ id: 'pg/uuid@1' }).build());
      if (!locked.length) throw new NotFoundException('Inventory item not found');
      const current = await this.current(tx, companyId, itemId);
      if (!current.item.isActive) throw new ConflictException('Restore the item before reviewing its cost');
      if (body.confirmed !== true || body.expectedCostCents !== current.item.unitCostCents || body.expectedUnit !== current.item.unit || body.expectedItemUpdatedAt !== current.item.updatedAt || body.expectedCurrency !== current.currency) {
        throw new ConflictException('The cost details changed. Reload and check the current cost before confirming');
      }
      if ((current.item.unitCostCents === 0) !== (body.source === 'free_acquisition')) {
        throw new ConflictException(current.item.unitCostCents === 0
          ? 'A zero cost needs an explicit confirmation that this stock was acquired free of charge'
          : 'Free stock must have a current cost of zero');
      }
      const reference = body.reference.trim();
      if (!reference) throw new ConflictException('Add the record reference you checked');
      if (current.state === 'confirmed' && current.review?.source === body.source && current.review.reference === reference) return current;
      const metadata = JSON.stringify({ version: 1, costCents: current.item.unitCostCents, unit: current.item.unit, itemUpdatedAt: current.item.updatedAt, currency: current.currency, source: body.source, reference });
      // now() is the transaction start, possibly before waiting for the item lock.
      // Keep append order monotonic even for an older transaction that acquires it later.
      await tx.execute(this.prisma.client.raw.sql`
        INSERT INTO public.audit_events (id, company_id, actor_user_id, action, entity_type, entity_id, metadata, created_at)
        SELECT gen_random_uuid(), ${companyId}::uuid, ${userId}::uuid, ${action}, ${entityType}, ${itemId}::uuid, ${metadata}::jsonb,
          GREATEST(clock_timestamp(), COALESCE((
            SELECT max(created_at) + interval '1 microsecond' FROM public.audit_events
            WHERE company_id = ${companyId}::uuid AND entity_id = ${itemId}::uuid AND action = ${action} AND entity_type = ${entityType}
          ), '-infinity'::timestamptz))
      `.affectedCount().build());
      return this.current(tx, companyId, itemId);
    });
  }
}
