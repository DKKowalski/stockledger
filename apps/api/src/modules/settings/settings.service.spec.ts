import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from './settings.service.js';

describe('SettingsService', () => {
  const companyId = '31000000-0000-4000-8000-000000000001';
  const ownerId = '41000000-0000-4000-8000-000000000001';
  const userFirst = vi.fn();
  const companyFirst = vi.fn();
  const companyUpdate = vi.fn();
  const auditCreate = vi.fn();
  const auditAll = vi.fn();
  const auditCollection = {
    include: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    all: auditAll,
  };
  auditCollection.include.mockReturnValue(auditCollection);
  auditCollection.orderBy.mockReturnValue(auditCollection);
  auditCollection.limit.mockReturnValue(auditCollection);
  const auditWhere = vi.fn(() => auditCollection);
  const companyWhere = vi.fn(() => ({ update: companyUpdate }));
  const tx = { orm: { public: {
    User: { first: userFirst },
    Company: { first: companyFirst, where: companyWhere },
    AuditEvent: { create: auditCreate, where: auditWhere },
  } } };
  const withCompany = vi.fn(async (_companyId: string, work: (client: typeof tx) => Promise<unknown>) => work(tx));
  const service = new SettingsService({ withCompany } as unknown as PrismaService);

  const company = {
    id: companyId,
    name: 'Mensah Trading',
    businessType: 'retail',
    contactEmail: 'owner@example.com',
    phone: null,
    address: null,
    currency: 'GHS',
    timeZone: 'Africa/Accra',
    dateFormat: 'day_month_year',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    userFirst.mockResolvedValue({ id: ownerId, companyId, role: 'administrator', isActive: true });
    companyFirst.mockResolvedValue(company);
    companyUpdate.mockResolvedValue(undefined);
    auditCreate.mockResolvedValue(undefined);
    auditAll.mockResolvedValue([]);
  });

  it('lets an active company member read shared presentation settings', async () => {
    userFirst.mockResolvedValue({ id: 'manager-id', companyId, role: 'inventory_manager', isActive: true });

    await expect(service.get('manager-id', companyId)).resolves.toEqual(expect.objectContaining({
      name: 'Mensah Trading',
      currency: 'GHS',
      timeZone: 'Africa/Accra',
    }));
  });

  it('blocks staff from changing company settings', async () => {
    userFirst.mockResolvedValue({ id: 'manager-id', companyId, role: 'inventory_manager', isActive: true });

    await expect(service.update('manager-id', companyId, {
      name: 'Mensah Trading', businessType: 'retail', contactEmail: 'owner@example.com', phone: '', address: '',
      currency: 'GHS', timeZone: 'Africa/Accra', dateFormat: 'day_month_year',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(companyUpdate).not.toHaveBeenCalled();
  });

  it('normalizes owner changes and records the changed fields', async () => {
    companyFirst
      .mockResolvedValueOnce(company)
      .mockResolvedValueOnce({ ...company, name: 'Mensah Stores', phone: '+233 20 000 0000', currency: 'USD' });

    const result = await service.update(ownerId, companyId, {
      name: ' Mensah Stores ', businessType: 'retail', contactEmail: ' OWNER@EXAMPLE.COM ', phone: ' +233 20 000 0000 ', address: '',
      currency: 'USD', timeZone: 'Africa/Accra', dateFormat: 'day_month_year',
    });

    expect(companyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Mensah Stores',
      contactEmail: 'owner@example.com',
      phone: '+233 20 000 0000',
      address: null,
      currency: 'USD',
    }));
    expect(result.currency).toBe('USD');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'company.settings_updated',
      metadata: { changedFields: expect.arrayContaining(['name', 'phone', 'currency']) },
    }));
  });

  it('returns the newest company activity with its actor', async () => {
    auditAll.mockResolvedValue([{
      id: '51000000-0000-4000-8000-000000000001',
      action: 'company.settings_updated',
      entityType: 'company',
      entityId: companyId,
      metadata: { changedFields: ['currency'] },
      createdAt: '2026-09-25T05:00:00.000Z',
      actor: { id: ownerId, fullName: 'Ama Mensah', email: 'ama@example.com' },
    }]);

    await expect(service.activity(ownerId, companyId)).resolves.toEqual([expect.objectContaining({
      action: 'company.settings_updated',
      actor: { id: ownerId, fullName: 'Ama Mensah', email: 'ama@example.com' },
    })]);
    expect(auditWhere).toHaveBeenCalledWith({ companyId });
    expect(auditCollection.limit).toHaveBeenCalledWith(100);
  });
});
