import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { db } from './db.js';

export type PrismaTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

@Injectable()
export class PrismaService implements OnApplicationShutdown {
  readonly client = db;

  async withCompany<T>(companyId: string, work: (tx: PrismaTransaction) => Promise<T>) {
    return this.client.transaction(async (tx) => {
      await tx.query(this.client.raw.sql`
        SELECT set_config('app.current_company_id', ${companyId}, true) AS company_id
      `.returnsRow({ company_id: 'pg/text@1' }).build());
      return work(tx);
    });
  }

  async onApplicationShutdown() {
    await this.client.close();
  }
}
