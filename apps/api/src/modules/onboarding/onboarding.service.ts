import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { BusinessType } from './dto/update-business-type.dto.js';
import type { InventorySource } from './dto/update-inventory-source.dto.js';

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string) {
    const actor = await this.owner(userId);
    const [company, locations, items, users] = await Promise.all([
      this.prisma.client.orm.public.Company.first({ id: actor.companyId }),
      this.prisma.client.orm.public.Location.where({ companyId: actor.companyId }).all(),
      this.prisma.client.orm.public.InventoryItem.where({ companyId: actor.companyId }).all(),
      this.prisma.client.orm.public.User.where({ companyId: actor.companyId }).all(),
    ]);
    if (!company) throw new UnauthorizedException('Business no longer exists');

    const itemIds = items.map((item) => item.id);
    const movements = itemIds.length
      ? await this.prisma.client.orm.public.StockMovement.where((movement) => movement.itemId.in(itemIds)).all()
      : [];

    return {
      company: {
        id: company.id,
        name: company.name,
        businessType: company.businessType,
        inventorySource: company.inventorySource,
      },
      completed: Boolean(company.onboardingCompletedAt),
      completedAt: company.onboardingCompletedAt,
      counts: {
        locations: locations.length,
        items: items.length,
        movements: movements.length,
        teammates: Math.max(users.length - 1, 0),
      },
    };
  }

  async updateBusinessType(userId: string, businessType: BusinessType) {
    const actor = await this.owner(userId);
    await this.prisma.client.orm.public.Company.where({ id: actor.companyId }).update({
      businessType: businessType as Varchar<40>,
    });
    return this.status(userId);
  }

  async updateInventorySource(userId: string, inventorySource: InventorySource) {
    const actor = await this.owner(userId);
    await this.prisma.client.orm.public.Company.where({ id: actor.companyId }).update({
      inventorySource: inventorySource as Varchar<40>,
    });
    return this.status(userId);
  }

  async complete(userId: string) {
    const actor = await this.owner(userId);
    const [company, locations] = await Promise.all([
      this.prisma.client.orm.public.Company.first({ id: actor.companyId }),
      this.prisma.client.orm.public.Location.where({ companyId: actor.companyId }).all(),
    ]);
    if (!company?.businessType || !company.inventorySource || locations.length === 0) {
      throw new BadRequestException('Finish each setup step before opening your workspace');
    }
    await this.prisma.client.orm.public.Company.where({ id: actor.companyId }).update({
      onboardingCompletedAt: new Date().toISOString(),
    });
    return this.status(userId);
  }

  private async owner(userId: string) {
    const user = await this.prisma.client.orm.public.User.first({ id: userId });
    if (!user || user.isActive === false) throw new UnauthorizedException('Account is not available');
    if (user.role !== 'administrator') throw new ForbiddenException('Only the business owner can manage setup');
    return user;
  }
}
