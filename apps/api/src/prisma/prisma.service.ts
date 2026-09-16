import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { db } from './db.js';

@Injectable()
export class PrismaService implements OnApplicationShutdown {
  readonly client = db;

  async onApplicationShutdown() {
    await this.client.close();
  }
}
