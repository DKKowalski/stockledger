import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthenticatedRequest } from './auth.types.js';

describe('AuthGuard', () => {
  const verifyAsync = vi.fn();
  const first = vi.fn();
  const jwt = { verifyAsync } as unknown as JwtService;
  const prisma = {
    client: { orm: { public: { User: { first } } } },
  } as unknown as PrismaService;
  const guard = new AuthGuard(jwt, prisma);

  beforeEach(() => vi.clearAllMocks());

  function context(request: Partial<AuthenticatedRequest>) {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('accepts a valid token for an active account', async () => {
    const request = { headers: { authorization: 'Bearer valid-token' } } as Partial<AuthenticatedRequest>;
    const payload = { sub: '41000000-0000-4000-8000-000000000001', role: 'administrator' as const, iat: 1, exp: 2 };
    verifyAsync.mockResolvedValue(payload);
    first.mockResolvedValue({ id: payload.sub, isActive: true });

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.user).toEqual(payload);
  });

  it('rejects an existing session after the account is deactivated', async () => {
    const request = { headers: { authorization: 'Bearer valid-token' } } as Partial<AuthenticatedRequest>;
    verifyAsync.mockResolvedValue({ sub: '41000000-0000-4000-8000-000000000002', role: 'inventory_manager', iat: 1, exp: 2 });
    first.mockResolvedValue({ isActive: false });

    await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });
});
