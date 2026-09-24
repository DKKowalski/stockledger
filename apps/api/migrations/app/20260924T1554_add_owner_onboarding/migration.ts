#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4f48bf1227195da8260ed816c3e42a4dd388868007d92c4c572768ffe36ff896/contract';
import startContract from '../../snapshots/4f48bf1227195da8260ed816c3e42a4dd388868007d92c4c572768ffe36ff896/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c350df09a975ceba80862f4ea14af9c48a699d85d7267df93381c23b49a0dbfe/contract';
import endContract from '../../snapshots/c350df09a975ceba80862f4ea14af9c48a699d85d7267df93381c23b49a0dbfe/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('business_type', 'character varying(40)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 40 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('inventory_source', 'character varying(40)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 40 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('onboarding_completed_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
