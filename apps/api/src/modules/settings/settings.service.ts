import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import * as argon2 from 'argon2';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import type { DeleteWorkspaceDto } from './dto/delete-workspace.dto.js';
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

  async deleteWorkspace(userId: string, companyId: string, body: DeleteWorkspaceDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.account(tx, companyId, userId);
      if (actor.role !== 'administrator') throw new ForbiddenException('Only an administrator can delete a workspace');

      const company = await tx.orm.public.Company.first({ id: companyId });
      if (!company) throw new UnauthorizedException('Business no longer exists');
      if (body.confirmation.trim() !== company.name) {
        throw new BadRequestException('Enter the business name exactly as shown');
      }
      if (!await argon2.verify(actor.passwordHash, body.currentPassword)) {
        throw new BadRequestException('Current password is incorrect');
      }

      await tx.query(this.prisma.client.raw.sql`
        SELECT set_config('app.workspace_deletion_company_id', ${companyId}, true) AS company_id
      `.returnsRow({ company_id: 'pg/text@1' }).build());
      await tx.execute(this.prisma.client.raw.sql`
        UPDATE public.stock_movements
        SET related_movement_id = NULL, stock_count_id = NULL
        WHERE company_id = ${companyId}::uuid
      `.affectedCount().build());
      await tx.execute(this.prisma.client.raw.sql`
        DELETE FROM public.stock_movements WHERE company_id = ${companyId}::uuid
      `.affectedCount().build());
      await tx.execute(this.prisma.client.raw.sql`
        DELETE FROM public.stock_counts WHERE company_id = ${companyId}::uuid
      `.affectedCount().build());
      await tx.execute(this.prisma.client.raw.sql`
        DELETE FROM public.location_stocks WHERE company_id = ${companyId}::uuid
      `.affectedCount().build());
      await tx.execute(this.prisma.client.raw.sql`
        DELETE FROM public.suppliers WHERE company_id = ${companyId}::uuid
      `.affectedCount().build());
      await tx.execute(this.prisma.client.raw.sql`
        DELETE FROM public.inventory_items WHERE company_id = ${companyId}::uuid
      `.affectedCount().build());
      await tx.execute(this.prisma.client.raw.sql`
        DELETE FROM public.audit_events WHERE company_id = ${companyId}::uuid
      `.affectedCount().build());
      await tx.execute(this.prisma.client.raw.sql`
        DELETE FROM public.refresh_sessions WHERE company_id = ${companyId}::uuid
      `.affectedCount().build());
      await tx.execute(this.prisma.client.raw.sql`
        DELETE FROM public.users WHERE company_id = ${companyId}::uuid
      `.affectedCount().build());
      await tx.execute(this.prisma.client.raw.sql`
        DELETE FROM public.locations WHERE company_id = ${companyId}::uuid
      `.affectedCount().build());
      await tx.execute(this.prisma.client.raw.sql`
        DELETE FROM public.companies WHERE id = ${companyId}::uuid
      `.affectedCount().build());

      return { deleted: true as const };
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
