import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { PasswordResetMailer } from './password-reset-mailer.js';

describe('AuthService launch account flows', () => {
  const companyId = '31000000-0000-4000-8000-000000000001';
  const ownerId = '41000000-0000-4000-8000-000000000001';
  let passwordHash: string;

  const userFirst = vi.fn();
  const userCreate = vi.fn();
  const userUpdate = vi.fn();
  const userDelete = vi.fn();
  const userAll = vi.fn();
  const userWhere = vi.fn(() => ({ update: userUpdate, delete: userDelete, all: userAll }));
  const sessionCreate = vi.fn();
  const sessionDelete = vi.fn();
  const sessionWhere = vi.fn(() => ({ delete: sessionDelete }));
  const auditCreate = vi.fn();
  const companyCreate = vi.fn();
  const companyDelete = vi.fn();
  const companyWhere = vi.fn(() => ({ delete: companyDelete }));
  const locationFirst = vi.fn();
  const transactionQuery = vi.fn();
  const tx = {
    query: transactionQuery,
    orm: { public: {
      User: { first: userFirst, create: userCreate, where: userWhere },
      Company: { create: companyCreate, where: companyWhere },
      Location: { first: locationFirst },
      RefreshSession: { create: sessionCreate, where: sessionWhere },
      AuditEvent: { create: auditCreate },
    } },
  };
  const withCompany = vi.fn(async (_companyId: string, work: (client: typeof tx) => Promise<unknown>) => work(tx));
  const runtimeQuery = vi.fn();
  const rawStatement = { returnsRow: vi.fn(() => ({ build: vi.fn(() => ({})) })) };
  const signAsync = vi.fn();
  const getOrThrow = vi.fn((key: string) => ({
    'auth.passwordResetTtlMinutes': 30,
    'auth.emailVerificationTtlHours': 24,
    'auth.invitationTtlHours': 72,
    'auth.refreshTokenTtlDays': 30,
    'app.webOrigin': 'https://stockledger.example',
  })[key]);
  const send = vi.fn();
  const sendVerification = vi.fn();
  const sendInvitation = vi.fn();
  const prisma = {
    withCompany,
    client: {
      raw: { sql: vi.fn(() => rawStatement) },
      runtime: () => ({ query: runtimeQuery }),
    },
  } as unknown as PrismaService;
  const mailer = { send, sendVerification, sendInvitation } as unknown as PasswordResetMailer;
  const service = new AuthService(
    prisma,
    { signAsync } as unknown as JwtService,
    { getOrThrow } as unknown as ConfigService,
    mailer,
  );

  const owner = () => ({
    id: ownerId,
    companyId,
    locationId: null,
    fullName: 'Ama Mensah',
    email: 'ama@example.com',
    passwordHash,
    role: 'administrator' as const,
    isActive: true,
    emailVerifiedAt: '2026-09-25T00:00:00.000Z',
    invitationAcceptedAt: null,
    createdAt: '2026-09-25T00:00:00.000Z',
  });

  beforeAll(async () => {
    passwordHash = await argon2.hash('StockLedger123!');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeQuery.mockResolvedValue([]);
    userFirst.mockResolvedValue(null);
    transactionQuery.mockResolvedValue([]);
    sessionCreate.mockImplementation(async (data) => data);
    auditCreate.mockImplementation(async (data) => data);
    userUpdate.mockResolvedValue(undefined);
    userDelete.mockResolvedValue(undefined);
    sessionDelete.mockResolvedValue(undefined);
    signAsync.mockResolvedValue('signed-access-token');
    send.mockResolvedValue(undefined);
    sendVerification.mockResolvedValue(undefined);
    sendInvitation.mockResolvedValue(undefined);
  });

  it('returns one generic error for an unknown login', async () => {
    await expect(service.login({ email: 'missing@example.com', password: 'wrong-password' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires owner email verification before login', async () => {
    runtimeQuery.mockResolvedValue([{ id: ownerId, company_id: companyId }]);
    userFirst.mockResolvedValue({ ...owner(), emailVerifiedAt: null });
    await expect(service.login({ email: 'ama@example.com', password: 'StockLedger123!' }))
      .rejects.toThrow('Verify your email before signing in');
  });

  it('creates a short access session and stores only the refresh-token hash', async () => {
    runtimeQuery.mockResolvedValue([{ id: ownerId, company_id: companyId }]);
    userFirst.mockResolvedValue(owner());
    const result = await service.login({ email: 'ama@example.com', password: 'StockLedger123!' });

    expect(result.accessToken).toBe('signed-access-token');
    expect(result.refreshToken).toMatch(new RegExp(`^${companyId}\\.[0-9a-f]{64}$`));
    expect(sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      companyId,
      userId: ownerId,
      tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(sessionCreate.mock.calls[0][0].tokenHash).not.toBe(result.refreshToken);
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('registers an owner as unverified and sends a verification link', async () => {
    companyCreate.mockImplementation(async (data) => data);
    userCreate.mockImplementation(async (data) => ({ id: ownerId, createdAt: '2026-09-25T00:00:00.000Z', isActive: true, ...data }));
    const result = await service.registerOwner({
      fullName: ' Ama Mensah ',
      businessName: ' Mensah Trading ',
      email: ' AMA@EXAMPLE.COM ',
      password: 'StockLedger123!',
    });

    expect(result).toEqual({ verificationRequired: true, email: 'ama@example.com' });
    expect(userCreate).toHaveBeenCalledWith(expect.objectContaining({
      email: 'ama@example.com',
      emailVerificationTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(sendVerification).toHaveBeenCalledWith(expect.objectContaining({
      email: 'ama@example.com',
      url: expect.stringContaining('/verify-email?token='),
    }));
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('lets the owner verify once and then creates a session', async () => {
    const token = `${companyId}.${'a'.repeat(64)}`;
    userFirst.mockResolvedValue({
      ...owner(),
      emailVerifiedAt: null,
      emailVerificationExpiresAt: '2099-01-01T00:00:00.000Z',
    });
    const result = await service.verifyEmail({ token });

    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      emailVerifiedAt: expect.any(String),
      emailVerificationTokenHash: null,
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'owner.email_verified' }));
    expect(result.accessToken).toBe('signed-access-token');
  });

  it('invites staff without accepting an administrator-selected password', async () => {
    userFirst.mockResolvedValue(owner());
    userCreate.mockImplementation(async (data) => ({
      id: '41000000-0000-4000-8000-000000000002',
      createdAt: '2026-09-25T00:00:00.000Z',
      isActive: true,
      invitationAcceptedAt: null,
      ...data,
    }));
    const result = await service.createUser(ownerId, companyId, {
      fullName: 'Kojo Owusu',
      email: 'kojo@example.com',
      role: 'inventory_manager',
    });

    expect(sendInvitation).toHaveBeenCalledWith(expect.objectContaining({
      email: 'kojo@example.com',
      url: expect.stringContaining('/accept-invitation?token='),
    }));
    expect(result.setupPending).toBe(true);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'account.invited' }));
  });

  it('accepts a valid staff invitation and stores the chosen password', async () => {
    const token = `${companyId}.${'b'.repeat(64)}`;
    userFirst.mockResolvedValue({
      ...owner(),
      id: '41000000-0000-4000-8000-000000000002',
      role: 'inventory_manager',
      invitationAcceptedAt: null,
      invitationExpiresAt: '2099-01-01T00:00:00.000Z',
    });
    await service.acceptInvitation({ token, newPassword: 'NewStaffPassword123!' });

    const update = userUpdate.mock.calls[0][0] as { passwordHash: string; invitationAcceptedAt: string };
    await expect(argon2.verify(update.passwordHash, 'NewStaffPassword123!')).resolves.toBe(true);
    expect(update.invitationAcceptedAt).toEqual(expect.any(String));
  });

  it('revokes refresh sessions when an administrator deactivates staff', async () => {
    userFirst.mockImplementation(async (query: { id: string }) => query.id === ownerId
      ? owner()
      : { ...owner(), id: query.id, role: 'inventory_manager', invitationAcceptedAt: '2026-09-25T00:00:00.000Z' });
    await service.setAccountStatus(ownerId, companyId, '41000000-0000-4000-8000-000000000002', { isActive: false });

    expect(sessionWhere).toHaveBeenCalledWith({ companyId, userId: '41000000-0000-4000-8000-000000000002' });
    expect(sessionDelete).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'account.deactivated' }));
  });

  it('rejects malformed reset tokens before querying tenant data', async () => {
    await expect(service.resetPassword({ token: 'not-a-token', newPassword: 'FreshPassword123!' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(withCompany).not.toHaveBeenCalled();
  });

  it('does not let staff change passwords directly', async () => {
    userFirst.mockResolvedValue({ ...owner(), role: 'inventory_manager' });
    await expect(service.changePassword(ownerId, companyId, {
      currentPassword: 'StockLedger123!',
      newPassword: 'FreshPassword123!',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
