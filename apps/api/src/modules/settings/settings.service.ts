import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import type { UpdateCompanySettingsDto } from './dto/update-company-settings.dto.js';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      await this.account(tx, companyId, userId);
      return this.companySettings(tx, companyId);
    });
  }

  async update(userId: string, companyId: string, body: UpdateCompanySettingsDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.account(tx, companyId, userId);
      if (actor.role !== 'administrator') throw new ForbiddenException('Only an administrator can change business settings');

      const name = body.name.trim();
      if (!name) throw new BadRequestException('Enter your business name');
      const before = await this.companySettings(tx, companyId);
      const contactEmail = body.contactEmail.trim().toLowerCase();

      await tx.orm.public.Company.where({ id: companyId }).update({
        name: name as Varchar<120>,
        businessType: body.businessType as Varchar<40>,
        contactEmail: contactEmail as Varchar<255>,
        phone: this.optional(body.phone, 40),
        address: this.optional(body.address, 300),
        currency: body.currency as Varchar<3>,
        timeZone: body.timeZone as Varchar<64>,
        dateFormat: body.dateFormat as Varchar<24>,
      });

      const after = await this.companySettings(tx, companyId);
      const changedFields = Object.keys(after).filter((key) => before[key as keyof typeof before] !== after[key as keyof typeof after]);
      await tx.orm.public.AuditEvent.create({
        companyId,
        actorUserId: actor.id,
        action: 'company.settings_updated' as Varchar<80>,
        entityType: 'company' as Varchar<80>,
        entityId: companyId,
        metadata: { changedFields },
      });
      return after;
    });
  }

  async activity(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.account(tx, companyId, userId);
      if (actor.role !== 'administrator') throw new ForbiddenException('Only an administrator can view business activity');

      const events = await tx.orm.public.AuditEvent
        .where({ companyId })
        .include('actor', (users) => users.select('id', 'fullName', 'email'))
        .orderBy([(event) => event.createdAt.desc(), (event) => event.id.desc()])
        .limit(100)
        .all();

      return events.map((event) => ({
        id: event.id,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        metadata: event.metadata,
        createdAt: event.createdAt,
        actor: event.actor ? {
          id: event.actor.id,
          fullName: event.actor.fullName,
          email: event.actor.email,
        } : null,
      }));
    });
  }

  private async companySettings(tx: PrismaTransaction, companyId: string) {
    const company = await tx.orm.public.Company.first({ id: companyId });
    if (!company) throw new UnauthorizedException('Business no longer exists');
    return {
      id: company.id,
      name: company.name,
      businessType: company.businessType,
      contactEmail: company.contactEmail ?? '',
      phone: company.phone ?? '',
      address: company.address ?? '',
      currency: company.currency,
      timeZone: company.timeZone,
      dateFormat: company.dateFormat,
    };
  }

  private async account(tx: PrismaTransaction, companyId: string, userId: string) {
    const user = await tx.orm.public.User.first({ id: userId, companyId });
    if (!user || user.isActive === false) throw new UnauthorizedException('Account is not available');
    return user;
  }

  private optional<const Length extends number>(value: string, _length: Length) {
    const trimmed = value.trim();
    return trimmed ? (trimmed as Varchar<Length>) : null;
  }
}
