import { ForbiddenException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../modules/auth/auth.types.js';
import { DemoProtectionInterceptor } from './demo-protection.interceptor.js';

describe('DemoProtectionInterceptor', () => {
  const demoCompanyId = '31000000-0000-4000-8000-000000000001';
  const config = { get: vi.fn(() => demoCompanyId) } as unknown as ConfigService;
  const interceptor = new DemoProtectionInterceptor(config);
  const next = { handle: vi.fn(() => of({ ok: true })) } as unknown as CallHandler;

  function context(method: string, companyId?: string) {
    const request = { method, user: companyId ? { companyId } : undefined } as unknown as AuthenticatedRequest;
    return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  }

  it('allows reads from the public demo', () => {
    expect(() => interceptor.intercept(context('GET', demoCompanyId), next)).not.toThrow();
    expect(next.handle).toHaveBeenCalled();
  });

  it('blocks authenticated writes to the public demo', () => {
    expect(() => interceptor.intercept(context('POST', demoCompanyId), next)).toThrow(ForbiddenException);
  });

  it('does not affect real workspaces or public requests', () => {
    expect(() => interceptor.intercept(context('PATCH', '31000000-0000-4000-8000-000000000099'), next)).not.toThrow();
    expect(() => interceptor.intercept(context('POST'), next)).not.toThrow();
  });
});
