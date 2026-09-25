import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import type { BusinessType } from './dto/update-business-type.dto.js';
import type { InventorySource } from './dto/update-inventory-source.dto.js';

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.owner(tx, companyId, userId);
      return this.statusInTransaction(tx, companyId);
    });
  }

  async updateBusinessType(userId: string, companyId: string, businessType: BusinessType) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.owner(tx, companyId, userId);
      await tx.orm.public.Company.where({ id: companyId }).update({
        businessType: businessType as Varchar<40>,
      });
      return this.statusInTransaction(tx, companyId);
    });
  }

  async updateInventorySource(userId: string, companyId: string, inventorySource: InventorySource) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.owner(tx, companyId, userId);
      await tx.orm.public.Company.where({ id: companyId }).update({
        inventorySource: inventorySource as Varchar<40>,
      });
      return this.statusInTransaction(tx, companyId);
    });
  }

  async complete(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.owner(tx, companyId, userId);
      const [company, locations] = await Promise.all([
        tx.orm.public.Company.first({ id: companyId }),
        tx.orm.public.Location.where({ companyId }).all(),
      ]);
      if (!company?.businessType || !company.inventorySource || locations.length === 0) {
        throw new BadRequestException('Finish each setup step before opening your workspace');
      }
      await tx.orm.public.Company.where({ id: companyId }).update({
        onboardingCompletedAt: new Date().toISOString(),
      });
      return this.statusInTransaction(tx, companyId);
    });
  }

  private async statusInTransaction(tx: PrismaTransaction, companyId: string) {
    const [company, locations, items, users, movements] = await Promise.all([
      tx.orm.public.Company.first({ id: companyId }),
      tx.orm.public.Location.where({ companyId }).all(),
      tx.orm.public.InventoryItem.where({ companyId }).all(),
      tx.orm.public.User.where({ companyId }).all(),
      tx.orm.public.StockMovement.where({ companyId }).all(),
    ]);
    if (!company) throw new UnauthorizedException('Business no longer exists');

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

  private async owner(tx: PrismaTransaction, companyId: string, userId: string) {
    const user = await tx.orm.public.User.first({ id: userId, companyId });
    if (!user || user.isActive === false) throw new UnauthorizedException('Account is not available');
    if (user.role !== 'administrator') throw new ForbiddenException('Only the business owner can manage setup');
    return user;
  }
}
