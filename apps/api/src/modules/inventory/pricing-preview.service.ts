import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { z } from 'zod';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import { PricingQuoteDto, UpdatePricingDto } from './dto/pricing.dto.js';
import { hybridPricingSwitchedOn } from './hybrid-pricing.js';
import { calculatePrice, safeAmount, validatePricingRules, type PricingRules } from './pricing-calculations.js';

const tiersSchema = z.array(z.object({ minimumQuantity: z.number().int(), unitPriceCents: z.number().int() }).strict()).max(100);

@Injectable()
export class PricingPreviewService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private async enabled(tx: PrismaTransaction, companyId: string) {
    return (this.config.get<string[]>('app.pricingPreviewCompanyIds') ?? []).includes(companyId)
      || hybridPricingSwitchedOn(tx, companyId);
  }

  private async actor(tx: PrismaTransaction, companyId: string, userId: string, adminOnly = false) {
    const actor = await tx.orm.public.User.first({ id: userId, companyId });
    if (!actor?.isActive) throw new UnauthorizedException('Account is not available');
    if (adminOnly && actor.role !== 'administrator') throw new ForbiddenException('Only an administrator can configure pricing previews');
    return actor;
  }

  private async latest(tx: PrismaTransaction, companyId: string, itemId: string) {
    return tx.orm.public.ItemPricingVersion.where({ companyId, itemId })
      .orderBy([(row) => row.version.desc()]).first();
  }

  async status(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.actor(tx, companyId, userId, true);
      return { available: (await this.enabled(tx, companyId)), previewOnly: true as const };
    });
  }

  async get(userId: string, companyId: string, itemId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.actor(tx, companyId, userId, true);
      const item = await tx.orm.public.InventoryItem.first({ companyId, id: itemId });
      if (!item) throw new NotFoundException('Inventory item not found');
      return { available: (await this.enabled(tx, companyId)), previewOnly: true as const, configuration: await this.latest(tx, companyId, itemId) };
    });
  }

  async update(userId: string, companyId: string, itemId: string, body: UpdatePricingDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.actor(tx, companyId, userId, true);
      if (!(await this.enabled(tx, companyId))) throw new ForbiddenException('Turn on box and quantity deals in Settings first');
      const locked = await tx.query(this.prisma.client.raw.sql`
        SELECT id FROM public.inventory_items
        WHERE id = ${itemId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE
      `.returnsRow({ id: 'pg/uuid@1' }).build());
      if (!locked.length) throw new NotFoundException('Inventory item not found');
      const item = await tx.orm.public.InventoryItem.first({ id: itemId, companyId });
      if (!item?.isActive) throw new ConflictException('Restore the item before configuring a pricing preview');
      if (body.baseUnitVerified !== true || body.baseUnit !== item.unit) throw new ConflictException('Confirm the current base unit before saving');
      const current = await this.latest(tx, companyId, itemId);
      if (body.expectedVersion !== (current?.version ?? 0)) throw new ConflictException('Pricing configuration changed. Reload it before saving');
      if (body.previewEnabled) {
        if (item.sellingPriceCents === null) throw new ConflictException('Set a retail selling price before configuring this item');
        validatePricingRules(item.sellingPriceCents, { package: body.package ?? null, bulkTiers: body.bulkTiers });
      }
      const version = await tx.orm.public.ItemPricingVersion.create({
        companyId, itemId, version: body.expectedVersion + 1,
        baseUnit: item.unit, previewEnabled: body.previewEnabled,
        packageLabel: body.package ? body.package.label.trim() as Varchar<20> : null,
        packageSize: body.package?.size ?? null, packagePriceCents: body.package?.priceCents ?? null,
        bulkTiers: body.bulkTiers.map((tier) => ({ minimumQuantity: tier.minimumQuantity, unitPriceCents: tier.unitPriceCents })),
        createdByUserId: userId,
      });
      await tx.orm.public.AuditEvent.create({
        companyId, actorUserId: userId, action: 'inventory.pricing_preview_saved' as Varchar<80>,
        entityType: 'inventory_item' as Varchar<80>, entityId: itemId,
        metadata: { versionId: version.id, version: version.version, previewEnabled: body.previewEnabled, baseUnitVerified: true },
      });
      return { available: true, previewOnly: true as const, configuration: version };
    });
  }

  async quote(userId: string, companyId: string, body: PricingQuoteDto) {
    return this.prisma.withCompany(companyId, (tx) => this.quoteInTransaction(tx, userId, companyId, body));
  }

  async quoteInTransaction(tx: PrismaTransaction, userId: string, companyId: string, body: PricingQuoteDto) {
      const actor = await this.actor(tx, companyId, userId);
      if (actor.role === 'shop_attendant') {
        const shop = actor.locationId && await tx.orm.public.Location.first({ id: actor.locationId, companyId, type: 'shop' });
        if (!shop) throw new ForbiddenException('This account must be assigned to a shop');
      }
      const company = await tx.orm.public.Company.first({ id: companyId });
      if (!company) throw new UnauthorizedException('Business no longer exists');
      const normalizedLines = body.lines.map((line) => ({ ...line, itemId: line.itemId.toLowerCase() }));
      const itemIds = [...new Set(normalizedLines.map((line) => line.itemId))].sort();
      // Preview only: no locks, reservation, cost assignment or stock writes. Completion will revalidate separately.
      const lines = [];
      for (const itemId of itemIds) {
        const item = await tx.orm.public.InventoryItem.first({ id: itemId, companyId });
        if (!item?.isActive) throw new NotFoundException('Active inventory item not found');
        const version = (await this.enabled(tx, companyId)) ? await this.latest(tx, companyId, itemId) : null;
        const applied = version?.previewEnabled ? version : null;
        let rules: PricingRules | undefined;
        if (applied) {
          if (applied.baseUnit !== item.unit) throw new ConflictException('The item unit changed. Review its pricing configuration');
          const tiers = tiersSchema.safeParse(applied.bulkTiers);
          if (!tiers.success) throw new ConflictException('Review the stored bulk pricing configuration');
          rules = {
            package: applied.packageSize !== null ? { label: applied.packageLabel!, size: applied.packageSize, priceCents: applied.packagePriceCents! } : null,
            bulkTiers: tiers.data,
          };
        }
        let quantity = 0n;
        const inputs = normalizedLines.filter((line) => line.itemId === itemId);
        for (const input of inputs) {
          if (input.expectedVersion !== undefined && input.expectedVersion !== (version?.version ?? 0)) {
            throw new ConflictException('Pricing configuration changed. Reload it before previewing');
          }
          if (input.quantityUnit === 'package' && !rules?.package) throw new BadRequestException('This item has no enabled package pricing preview');
          quantity += BigInt(input.quantity) * BigInt(input.quantityUnit === 'package' ? rules!.package!.size : 1);
        }
        if (quantity < 1n || quantity > 2147483647n) throw new BadRequestException('The base quantity is too large');
        lines.push({
          itemId, itemName: item.name, baseUnit: item.unit, retailPriceCents: item.sellingPriceCents,
          pricingVersion: applied?.version ?? null, configurationVersion: version?.version ?? 0, inputs,
          package: rules?.package ?? null,
          ...calculatePrice(item.sellingPriceCents, Number(quantity), rules),
        });
      }
      return {
        previewOnly: true as const, canComplete: false as const, currency: company.currency,
        lines,
        grossSalesCents: safeAmount(lines.reduce((sum, line) => sum + BigInt(line.grossSalesCents), 0n)),
        automaticDiscountCents: safeAmount(lines.reduce((sum, line) => sum + BigInt(line.automaticDiscountCents), 0n)),
        totalCents: safeAmount(lines.reduce((sum, line) => sum + BigInt(line.totalCents), 0n)),
      };
  }
}
