import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  const query = vi.fn();
  const statement = { returnsRow: vi.fn(() => ({ build: vi.fn(() => ({})) })) };
  const prisma = {
    client: {
      runtime: () => ({ query }),
      raw: { sql: vi.fn(() => statement) },
    },
  } as unknown as PrismaService;
  const controller = new HealthController(prisma);

  beforeEach(() => vi.clearAllMocks());

  it('reports process liveness without touching the database', () => {
    expect(controller.live()).toEqual({ status: 'ok', check: 'live' });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports readiness after a successful database query', async () => {
    query.mockResolvedValue([{ ready: 1 }]);
    await expect(controller.ready()).resolves.toEqual({ status: 'ok', check: 'ready' });
  });

  it('fails readiness when the database cannot be reached', async () => {
    query.mockRejectedValue(new Error('offline'));
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
