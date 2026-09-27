import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from './settings.service.js';

describe('SettingsService', () => {
  const companyId = '31000000-0000-4000-8000-000000000001';
  const ownerId = '41000000-0000-4000-8000-000000000001';
  const userFirst = vi.fn();
  const companyFirst = vi.fn();
  const companyUpdate = vi.fn();
  const locationFirst = vi.fn();
  const auditCreate = vi.fn();
  const query = vi.fn();
  const execute = vi.fn();
  const builtStatement = { build: vi.fn(() => ({})) };
  const rawStatement = {
    returnsRow: vi.fn(() => builtStatement),
    affectedCount: vi.fn(() => builtStatement),
  };
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
  const tx = { query, execute, orm: { public: {
    User: { first: userFirst },
    Company: { first: companyFirst, where: companyWhere },
    Location: { first: locationFirst },
    AuditEvent: { create: auditCreate, where: auditWhere },
  } } };
  const withCompany = vi.fn(async (_companyId: string, work: (client: typeof tx) => Promise<unknown>) => work(tx));
  const service = new SettingsService({
    withCompany,
    client: { raw: { sql: vi.fn(() => rawStatement) } },
  } as unknown as PrismaService);

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
    defaultLocationId: null,
    defaultUnit: 'pcs',
    defaultReorderLevel: 10,
    skuPrefix: 'SKU',
    nextSkuNumber: 1,
    allowNegativeStock: false,
    requirePurchaseSource: false,
    requireAdjustmentReason: true,
    shopTerm: 'shop',
    warehouseTerm: 'warehouse',
    itemTerm: 'item',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    userFirst.mockResolvedValue({ id: ownerId, companyId, role: 'administrator', isActive: true });
    companyFirst.mockResolvedValue(company);
    companyUpdate.mockResolvedValue(undefined);
    locationFirst.mockResolvedValue(null);
    auditCreate.mockResolvedValue(undefined);
    auditAll.mockResolvedValue([]);
    query.mockResolvedValue([{ company_id: companyId }]);
    execute.mockResolvedValue(0);
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

  it('keeps expanded settings and data history under administrator control', async () => {
    userFirst.mockResolvedValue({ id: 'manager-id', companyId, role: 'inventory_manager', isActive: true });
    const inventory = {
      defaultLocationId: null,
      defaultUnit: 'pcs',
      defaultReorderLevel: 10,
      skuPrefix: 'SKU',
      nextSkuNumber: 1,
      allowNegativeStock: false,
      requirePurchaseSource: false,
      requireAdjustmentReason: true,
    };

    await expect(service.updateInventory('manager-id', companyId, inventory)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateTerminology('manager-id', companyId, {
      shopTerm: 'branch', warehouseTerm: 'stockroom', itemTerm: 'product',
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.dataSummary('manager-id', companyId)).rejects.toBeInstanceOf(ForbiddenException);
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

  it('saves inventory defaults and safeguards for an administrator', async () => {
    const locationId = '51000000-0000-4000-8000-000000000001';
    locationFirst.mockResolvedValue({ id: locationId, companyId });
    companyFirst
      .mockResolvedValueOnce({
        ...company,
        defaultLocationId: locationId,
        defaultUnit: 'carton',
        defaultReorderLevel: 6,
        skuPrefix: 'PRD',
        nextSkuNumber: 25,
        allowNegativeStock: true,
        requirePurchaseSource: true,
        requireAdjustmentReason: false,
      });

    const result = await service.updateInventory(ownerId, companyId, {
      defaultLocationId: locationId,
      defaultUnit: ' carton ',
      defaultReorderLevel: 6,
      skuPrefix: 'prd',
      nextSkuNumber: 25,
      allowNegativeStock: true,
      requirePurchaseSource: true,
      requireAdjustmentReason: false,
    });

    expect(locationFirst).toHaveBeenCalledWith({ id: locationId, companyId });
    expect(companyUpdate).toHaveBeenCalledWith(expect.objectContaining({ defaultUnit: 'carton', skuPrefix: 'PRD' }));
    expect(result).toMatchObject({ defaultLocationId: locationId, skuPrefix: 'PRD' });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'company.inventory_settings_updated' }));
  });

  it('rejects a default location from outside the workspace', async () => {
    await expect(service.updateInventory(ownerId, companyId, {
      defaultLocationId: '51000000-0000-4000-8000-000000000002',
      defaultUnit: 'pcs',
      defaultReorderLevel: 10,
      skuPrefix: 'SKU',
      nextSkuNumber: 1,
      allowNegativeStock: false,
      requirePurchaseSource: false,
      requireAdjustmentReason: true,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(companyUpdate).not.toHaveBeenCalled();
  });

  it('saves the supported workspace terminology', async () => {
    companyFirst.mockResolvedValueOnce({
      ...company, shopTerm: 'branch', warehouseTerm: 'stockroom', itemTerm: 'product',
    });

    await expect(service.updateTerminology(ownerId, companyId, {
      shopTerm: 'branch', warehouseTerm: 'stockroom', itemTerm: 'product',
    })).resolves.toMatchObject({ shopTerm: 'branch', warehouseTerm: 'stockroom', itemTerm: 'product' });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'company.terminology_updated' }));
  });

  it('summarizes the latest export and spreadsheet imports', async () => {
    auditAll.mockResolvedValue([
      { id: 'export', action: 'data.exported', metadata: { type: 'workspace', rowCount: 18 }, createdAt: '2026-09-25T06:00:00.000Z', actor: { fullName: 'Ama Mensah' } },
      { id: 'import', action: 'inventory.items_imported', metadata: { fileName: 'catalog.xlsx', imported: 4 }, createdAt: '2026-09-25T05:00:00.000Z', actor: { fullName: 'Kojo Owusu' } },
    ]);

    await expect(service.dataSummary(ownerId, companyId)).resolves.toEqual({
      lastExport: { type: 'workspace', rowCount: 18, createdAt: '2026-09-25T06:00:00.000Z', actorName: 'Ama Mensah' },
      imports: [{ id: 'import', fileName: 'catalog.xlsx', imported: 4, createdAt: '2026-09-25T05:00:00.000Z', actorName: 'Kojo Owusu' }],
    });
  });

  it('deletes the entire workspace after checking the owner password and business name', async () => {
    const passwordHash = await argon2.hash('StockLedger123!');
    userFirst.mockResolvedValue({ id: ownerId, companyId, role: 'administrator', isActive: true, passwordHash });

    await expect(service.deleteWorkspace(ownerId, companyId, {
      currentPassword: 'StockLedger123!',
      confirmation: 'Mensah Trading',
    })).resolves.toEqual({ deleted: true });

    expect(query).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(11);
    expect(rawStatement.affectedCount).toHaveBeenCalledTimes(11);
  });

  it('keeps the workspace when its name does not match', async () => {
    const passwordHash = await argon2.hash('StockLedger123!');
    userFirst.mockResolvedValue({ id: ownerId, companyId, role: 'administrator', isActive: true, passwordHash });

    await expect(service.deleteWorkspace(ownerId, companyId, {
      currentPassword: 'StockLedger123!',
      confirmation: 'Wrong business',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });
});
