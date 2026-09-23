import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let passwordHash: string;
  const companyId = '31000000-0000-4000-8000-000000000001';
  const shopId = '32000000-0000-4000-8000-000000000002';
  const first = vi.fn();
  const all = vi.fn();
  const where = vi.fn(() => ({ all }));
  const create = vi.fn();
  const locationFirst = vi.fn();
  const signAsync = vi.fn();
  const prisma = {
    client: { orm: { public: { User: { first, where, create }, Location: { first: locationFirst } } } },
  } as unknown as PrismaService;
  const jwt = { signAsync } as unknown as JwtService;
  const service = new AuthService(prisma, jwt);

  beforeAll(async () => {
    passwordHash = await argon2.hash('StockLedger123!');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a signed session without exposing the password hash', async () => {
    first.mockResolvedValue({
      id: '41000000-0000-4000-8000-000000000001',
      companyId,
      locationId: null,
      fullName: 'Eric Mensah',
      email: 'admin@stockledger.app',
      passwordHash,
      role: 'administrator',
      createdAt: '2026-09-16T00:00:00.000Z',
    });
    signAsync.mockResolvedValue('signed-token');

    const result = await service.login({
      email: ' ADMIN@stockledger.app ',
      password: 'StockLedger123!',
    });

    expect(first).toHaveBeenCalledWith({ email: 'admin@stockledger.app' });
    expect(signAsync).toHaveBeenCalledWith({
      sub: '41000000-0000-4000-8000-000000000001',
      role: 'administrator',
    });
    expect(result).toEqual({
      accessToken: 'signed-token',
      user: {
        id: '41000000-0000-4000-8000-000000000001',
        companyId,
        locationId: null,
        fullName: 'Eric Mensah',
        email: 'admin@stockledger.app',
        role: 'administrator',
        createdAt: '2026-09-16T00:00:00.000Z',
      },
    });
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('rejects an incorrect password', async () => {
    first.mockResolvedValue({ passwordHash });

    await expect(service.login({
      email: 'admin@stockledger.app',
      password: 'incorrect-password',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses the same response for an unknown email', async () => {
    first.mockResolvedValue(null);

    await expect(service.login({
      email: 'unknown@stockledger.app',
      password: 'incorrect-password',
    })).rejects.toThrow('Invalid email or password');
  });

  const administrator = {
    id: '41000000-0000-4000-8000-000000000001',
    companyId,
    locationId: null,
    role: 'administrator' as const,
  };

  it('lists accounts for an administrator without password hashes', async () => {
    first.mockResolvedValue(administrator);
    all.mockResolvedValue([
      {
        id: '41000000-0000-4000-8000-000000000002',
        companyId,
        locationId: null,
        fullName: 'Ama Boateng',
        email: 'ama@stockledger.app',
        passwordHash,
        role: 'inventory_manager',
        createdAt: '2026-09-22T00:00:00.000Z',
      },
      {
        id: '41000000-0000-4000-8000-000000000001',
        companyId,
        locationId: null,
        fullName: 'Eric Mensah',
        email: 'admin@stockledger.app',
        passwordHash,
        role: 'administrator',
        createdAt: '2026-09-16T00:00:00.000Z',
      },
    ]);

    const result = await service.listUsers(administrator.id);

    expect(where).toHaveBeenCalledWith({ companyId });
    expect(result.map((user) => user.fullName)).toEqual(['Ama Boateng', 'Eric Mensah']);
    expect(result[0]).not.toHaveProperty('passwordHash');
  });

  it('refuses account management to an inventory manager', async () => {
    first.mockResolvedValue({ ...administrator, role: 'inventory_manager' });

    await expect(service.listUsers(administrator.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createUser(administrator.id, {
      fullName: 'Ama Boateng',
      email: 'ama@stockledger.app',
      password: 'Warehouse123!',
      role: 'inventory_manager',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(all).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates an inventory manager and stores a hashed password', async () => {
    first.mockImplementation(async (query: { id?: string }) => query.id ? administrator : null);
    create.mockImplementation(async (data: {
      companyId: string;
      locationId: string | null;
      fullName: string;
      email: string;
      passwordHash: string;
      role: string;
    }) => ({
      id: '41000000-0000-4000-8000-000000000002',
      ...data,
      createdAt: '2026-09-22T00:00:00.000Z',
    }));

    const result = await service.createUser(administrator.id, {
      fullName: ' Ama Boateng ',
      email: ' AMA@stockledger.app ',
      password: 'Warehouse123!',
      role: 'inventory_manager',
    });

    const saved = create.mock.calls[0][0] as { email: string; passwordHash: string; role: string; companyId: string; locationId: null };
    expect(saved.email).toBe('ama@stockledger.app');
    expect(saved.role).toBe('inventory_manager');
    expect(saved.companyId).toBe(companyId);
    expect(saved.locationId).toBeNull();
    expect(saved.passwordHash).not.toBe('Warehouse123!');
    await expect(argon2.verify(saved.passwordHash, 'Warehouse123!')).resolves.toBe(true);
    expect(result).toEqual({
      id: '41000000-0000-4000-8000-000000000002',
      companyId,
      locationId: null,
      fullName: 'Ama Boateng',
      email: 'ama@stockledger.app',
      role: 'inventory_manager',
      createdAt: '2026-09-22T00:00:00.000Z',
    });
  });

  it('assigns a shop attendant to a shop in the same company', async () => {
    first.mockImplementation(async (query: { id?: string }) => query.id ? administrator : null);
    locationFirst.mockResolvedValue({ id: shopId, companyId, type: 'shop' });
    create.mockImplementation(async (data: { role: string; locationId: string }) => ({
      id: '41000000-0000-4000-8000-000000000003',
      companyId,
      fullName: 'Akosua Mensah',
      email: 'akosua@stockledger.app',
      createdAt: '2026-09-22T00:00:00.000Z',
      ...data,
    }));

    const result = await service.createUser(administrator.id, {
      fullName: 'Akosua Mensah',
      email: 'akosua@stockledger.app',
      password: 'ShopFloor123!',
      role: 'shop_attendant',
      locationId: shopId,
    });

    expect(result.role).toBe('shop_attendant');
    expect(result.locationId).toBe(shopId);
  });

  it('rejects a shop attendant who is not assigned to a shop', async () => {
    first.mockImplementation(async (query: { id?: string }) => query.id ? administrator : null);

    await expect(service.createUser(administrator.id, {
      fullName: 'Akosua Mensah',
      email: 'akosua@stockledger.app',
      password: 'ShopFloor123!',
      role: 'shop_attendant',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email', async () => {
    first.mockImplementation(async (query: { id?: string }) => (
      query.id ? administrator : { id: '41000000-0000-4000-8000-000000000009' }
    ));

    await expect(service.createUser(administrator.id, {
      fullName: 'Eric Mensah',
      email: 'admin@stockledger.app',
      password: 'Warehouse123!',
      role: 'inventory_manager',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });
});
