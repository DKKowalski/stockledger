import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

describe('AuthController session cookies', () => {
  const session = {
    accessToken: 'short-access-token',
    refreshToken: '31000000-0000-4000-8000-000000000001.secret',
    user: { id: 'user-id' },
  };
  const login = vi.fn().mockResolvedValue(session);
  const refresh = vi.fn().mockResolvedValue(session);
  const logout = vi.fn().mockResolvedValue({ signedOut: true });
  const auth = { login, refresh, logout } as unknown as AuthService;
  const config = {
    getOrThrow: vi.fn((key: string) => ({
      'app.environment': 'production',
      'app.webOrigin': 'https://stockledger.example',
      'auth.refreshTokenTtlDays': 30,
    })[key]),
  } as unknown as ConfigService;
  const controller = new AuthController(auth, config);

  it('keeps the refresh token out of JSON and places it in a secure HTTP-only cookie', async () => {
    const cookie = vi.fn();
    const response = { cookie } as unknown as Response;
    const result = await controller.login({ email: 'ama@example.com', password: 'password' }, response);

    expect(result).toEqual({ accessToken: 'short-access-token', user: { id: 'user-id' } });
    expect(cookie).toHaveBeenCalledWith('stockledger_refresh', session.refreshToken, expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    }));
  });

  it('rejects a cross-origin refresh before reading the cookie', async () => {
    const request = { headers: { origin: 'https://attacker.example' } } as Request;
    await expect(controller.refresh(request, { cookie: vi.fn() } as unknown as Response))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('clears the refresh cookie during logout', async () => {
    const clearCookie = vi.fn();
    const request = {
      headers: {
        origin: 'https://stockledger.example',
        cookie: `stockledger_refresh=${encodeURIComponent(session.refreshToken)}`,
      },
    } as Request;
    await controller.logout(request, { clearCookie } as unknown as Response);

    expect(logout).toHaveBeenCalledWith(session.refreshToken);
    expect(clearCookie).toHaveBeenCalledWith('stockledger_refresh', expect.objectContaining({ httpOnly: true, path: '/auth' }));
  });
});
