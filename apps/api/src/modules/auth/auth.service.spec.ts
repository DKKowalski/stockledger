import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let passwordHash: string;
  const first = vi.fn();
  const signAsync = vi.fn();
  const prisma = {
    client: { orm: { public: { User: { first } } } },
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
});
