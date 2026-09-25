import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  live() {
    return { status: 'ok', check: 'live' } as const;
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.client.runtime().query(this.prisma.client.raw.sql`
        SELECT 1 AS ready
      `.returnsRow({ ready: 'pg/int4@1' }).build());
      return { status: 'ok', check: 'ready' } as const;
    } catch {
      throw new ServiceUnavailableException('The service is starting.');
    }
  }
}
