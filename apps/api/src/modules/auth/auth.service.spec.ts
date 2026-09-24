import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { PasswordResetMailer } from './password-reset-mailer.js';

describe('AuthService', () => {
  let passwordHash: string;
  const companyId = '31000000-0000-4000-8000-000000000001';
  const shopId = '32000000-0000-4000-8000-000000000002';
  const first = vi.fn();
  const all = vi.fn();
  const update = vi.fn();
  const where = vi.fn(() => ({ all, update }));
  const create = vi.fn();
  const companyCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    orm: { public: { Company: { create: companyCreate }, User: { create } } },
  }));
  const locationFirst = vi.fn();
  const signAsync = vi.fn();
  const getOrThrow = vi.fn((key: string) => ({
    'auth.passwordResetTtlMinutes': 30,
    'app.webOrigin': 'https://stockledger.example',
  })[key]);
  const sendResetEmail = vi.fn();
  const prisma = {
    client: { transaction, orm: { public: { User: { first, where, create }, Location: { first: locationFirst } } } },
  } as unknown as PrismaService;
  const jwt = { signAsync } as unknown as JwtService;
  const config = { getOrThrow } as unknown as ConfigService;
  const passwordResetMailer = { send: sendResetEmail } as unknown as PasswordResetMailer;
  const service = new AuthService(prisma, jwt, config, passwordResetMailer);

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
        isActive: true,
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

  it('rejects a deactivated account even when its password is correct', async () => {
    first.mockResolvedValue({ passwordHash, isActive: false });

    await expect(service.login({
      email: 'ama@stockledger.app',
      password: 'StockLedger123!',
    })).rejects.toThrow('This account has been deactivated');
  });

  it('creates a business and its owner in one transaction', async () => {
    first.mockResolvedValue(null);
    companyCreate.mockResolvedValue({ id: companyId, name: 'Mensah Trading' });
    create.mockImplementation(async (data: {
      companyId: string;
      fullName: string;
      email: string;
      passwordHash: string;
      role: string;
      locationId: null;
    }) => ({
      id: '41000000-0000-4000-8000-000000000010',
      ...data,
      createdAt: '2026-09-24T00:00:00.000Z',
    }));
    signAsync.mockResolvedValue('owner-token');

    const result = await service.registerOwner({
      fullName: ' Ama Mensah ',
      businessName: ' Mensah Trading ',
      email: ' AMA@MENSAH.COM ',
      password: 'StockLedger123!',
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(companyCreate).toHaveBeenCalledWith({ name: 'Mensah Trading' });
    const saved = create.mock.calls[0][0] as { email: string; passwordHash: string; companyId: string; role: string };
    expect(saved.email).toBe('ama@mensah.com');
    expect(saved.companyId).toBe(companyId);
    expect(saved.role).toBe('administrator');
    await expect(argon2.verify(saved.passwordHash, 'StockLedger123!')).resolves.toBe(true);
    expect(result.accessToken).toBe('owner-token');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('does not register an owner with an email already in use', async () => {
    first.mockResolvedValue({ id: '41000000-0000-4000-8000-000000000009' });

    await expect(service.registerOwner({
      fullName: 'Ama Mensah',
      businessName: 'Mensah Trading',
      email: 'ama@mensah.com',
      password: 'StockLedger123!',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
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
      isActive: true,
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

  it('updates the signed-in account profile and normalizes its values', async () => {
    const current = {
      ...administrator,
      fullName: 'Eric Mensah',
      email: 'admin@stockledger.app',
      passwordHash,
      createdAt: '2026-09-16T00:00:00.000Z',
    };
    const updated = { ...current, fullName: 'Eric K. Mensah', email: 'eric@stockledger.app' };
    first
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(updated);

    const result = await service.updateProfile(current.id, {
      fullName: ' Eric K. Mensah ',
      email: ' ERIC@stockledger.app ',
    });

    expect(where).toHaveBeenCalledWith({ id: current.id });
    expect(update).toHaveBeenCalledWith({
      fullName: 'Eric K. Mensah',
      email: 'eric@stockledger.app',
    });
    expect(result.fullName).toBe('Eric K. Mensah');
    expect(result.email).toBe('eric@stockledger.app');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('rejects an email already used by another account', async () => {
    first
      .mockResolvedValueOnce({ ...administrator, email: 'admin@stockledger.app' })
      .mockResolvedValueOnce({ id: '41000000-0000-4000-8000-000000000009' });

    await expect(service.updateProfile(administrator.id, {
      fullName: 'Eric Mensah',
      email: 'ama@stockledger.app',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('changes a password only after verifying the current password', async () => {
    first.mockResolvedValue({ ...administrator, passwordHash });

    await expect(service.changePassword(administrator.id, {
      currentPassword: 'incorrect-password',
      newPassword: 'FreshPassword123!',
    })).rejects.toThrow('Current password is incorrect');
    expect(update).not.toHaveBeenCalled();

    const result = await service.changePassword(administrator.id, {
      currentPassword: 'StockLedger123!',
      newPassword: 'FreshPassword123!',
    });

    const saved = update.mock.calls[0][0] as { passwordHash: string };
    expect(saved.passwordHash).not.toBe('FreshPassword123!');
    await expect(argon2.verify(saved.passwordHash, 'FreshPassword123!')).resolves.toBe(true);
    expect(result).toEqual({ changed: true });
  });

  it('rejects reusing the current password', async () => {
    first.mockResolvedValue({ ...administrator, passwordHash });

    await expect(service.changePassword(administrator.id, {
      currentPassword: 'StockLedger123!',
      newPassword: 'StockLedger123!',
    })).rejects.toThrow('Choose a password you have not used for this account');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not let staff change passwords directly', async () => {
    first.mockResolvedValue({ ...administrator, role: 'inventory_manager', passwordHash });

    await expect(service.changePassword(administrator.id, {
      currentPassword: 'StockLedger123!',
      newPassword: 'FreshPassword123!',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('lets an administrator deactivate a staff account and clears pending resets', async () => {
    const staff = {
      ...administrator,
      id: '41000000-0000-4000-8000-000000000002',
      fullName: 'Ama Boateng',
      email: 'ama@stockledger.app',
      role: 'inventory_manager' as const,
      isActive: true,
      createdAt: '2026-09-22T00:00:00.000Z',
    };
    first.mockResolvedValueOnce(administrator).mockResolvedValueOnce(staff);

    const result = await service.setAccountStatus(administrator.id, staff.id, { isActive: false });

    expect(update).toHaveBeenCalledWith({
      isActive: false,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    });
    expect(result.isActive).toBe(false);
  });

  it('sends a one-time reset link without storing the raw token', async () => {
    const staff = {
      ...administrator,
      id: '41000000-0000-4000-8000-000000000002',
      fullName: 'Ama Boateng',
      email: 'ama@stockledger.app',
      role: 'inventory_manager' as const,
      isActive: true,
    };
    first.mockResolvedValueOnce(administrator).mockResolvedValueOnce(staff);
    sendResetEmail.mockResolvedValue(undefined);

    await expect(service.requestPasswordReset(administrator.id, staff.id)).resolves.toEqual({ sent: true });

    const email = sendResetEmail.mock.calls[0][0] as { resetUrl: string; email: string };
    const token = new URL(email.resetUrl).searchParams.get('token')!;
    const saved = update.mock.calls[0][0] as { passwordResetTokenHash: string; passwordResetExpiresAt: string };
    expect(email.email).toBe(staff.email);
    expect(token).toHaveLength(64);
    expect(saved.passwordResetTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(saved.passwordResetTokenHash).not.toBe(token);
    expect(new Date(saved.passwordResetExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('uses a valid reset token once and stores the replacement password hash', async () => {
    const token = 'a'.repeat(64);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    first.mockResolvedValue({
      ...administrator,
      passwordHash,
      isActive: true,
      passwordResetExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(service.resetPassword({ token, newPassword: 'FreshPassword123!' })).resolves.toEqual({ changed: true });

    expect(first).toHaveBeenCalledWith({ passwordResetTokenHash: tokenHash });
    const saved = update.mock.calls[0][0] as { passwordHash: string; passwordResetTokenHash: null; passwordResetExpiresAt: null };
    await expect(argon2.verify(saved.passwordHash, 'FreshPassword123!')).resolves.toBe(true);
    expect(saved.passwordResetTokenHash).toBeNull();
    expect(saved.passwordResetExpiresAt).toBeNull();
  });

  it('rejects an expired reset token', async () => {
    first.mockResolvedValue({
      ...administrator,
      passwordHash,
      isActive: true,
      passwordResetExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await expect(service.resetPassword({ token: 'b'.repeat(64), newPassword: 'FreshPassword123!' }))
      .rejects.toThrow('This reset link is invalid or has expired');
    expect(update).not.toHaveBeenCalled();
  });
});
