import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OnboardingService } from './onboarding.service.js';

describe('OnboardingService', () => {
  const companyId = '31000000-0000-4000-8000-000000000001';
  const userFirst = vi.fn();
  const companyFirst = vi.fn();
  const companyUpdate = vi.fn();
  const locationAll = vi.fn();
  const itemAll = vi.fn();
  const usersAll = vi.fn();
  const movementAll = vi.fn();
  const transactionClient = {
    orm: {
      public: {
        User: { first: userFirst, where: vi.fn(() => ({ all: usersAll })) },
        Company: { first: companyFirst, where: vi.fn(() => ({ update: companyUpdate })) },
        Location: { where: vi.fn(() => ({ all: locationAll })) },
        InventoryItem: { where: vi.fn(() => ({ all: itemAll })) },
        StockMovement: { where: vi.fn(() => ({ all: movementAll })) },
      },
    },
  };
  const withCompany = vi.fn(async (_companyId: string, callback: (tx: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));
  const prisma = {
    withCompany,
  } as unknown as PrismaService;
  const service = new OnboardingService(prisma);

  beforeEach(() => {
    vi.clearAllMocks();
    userFirst.mockResolvedValue({ id: 'owner-id', companyId, role: 'administrator', isActive: true });
    companyFirst.mockResolvedValue({
      id: companyId,
      name: 'Mensah Trading',
      businessType: 'retail',
      inventorySource: 'spreadsheet',
      onboardingCompletedAt: null,
    });
    locationAll.mockResolvedValue([{ id: 'location-id' }]);
    itemAll.mockResolvedValue([{ id: 'item-id' }]);
    usersAll.mockResolvedValue([{ id: 'owner-id' }, { id: 'manager-id' }]);
    movementAll.mockResolvedValue([{ id: 'movement-id' }]);
  });

  it('derives launch progress from real company records', async () => {
    const result = await service.status('owner-id', companyId);

    expect(result.completed).toBe(false);
    expect(result.company.name).toBe('Mensah Trading');
    expect(result.counts).toEqual({ locations: 1, items: 1, movements: 1, teammates: 1 });
  });

  it('does not let a staff account manage owner onboarding', async () => {
    userFirst.mockResolvedValue({ id: 'manager-id', companyId, role: 'inventory_manager', isActive: true });

    await expect(service.status('manager-id', companyId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a business type, inventory source and location before completion', async () => {
    companyFirst.mockResolvedValue({ id: companyId, name: 'Mensah Trading', businessType: null, inventorySource: null });
    locationAll.mockResolvedValue([]);

    await expect(service.complete('owner-id', companyId)).rejects.toBeInstanceOf(BadRequestException);
    expect(companyUpdate).not.toHaveBeenCalled();
  });

  it('marks setup complete after all required setup exists', async () => {
    companyUpdate.mockResolvedValue(undefined);
    companyFirst
      .mockResolvedValueOnce({ id: companyId, name: 'Mensah Trading', businessType: 'retail', inventorySource: 'spreadsheet' })
      .mockResolvedValueOnce({ id: companyId, name: 'Mensah Trading', businessType: 'retail', inventorySource: 'spreadsheet', onboardingCompletedAt: '2026-09-24T16:00:00.000Z' });

    const result = await service.complete('owner-id', companyId);

    expect(companyUpdate).toHaveBeenCalledWith({ onboardingCompletedAt: expect.any(String) });
    expect(result.completed).toBe(true);
  });
});
