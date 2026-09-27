#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/af0f799e84bed462c8c7be7ef11cd3ccc5971603b3c727b8ef34b4b55918fb19/contract';
import endContract from '../../snapshots/af0f799e84bed462c8c7be7ef11cd3ccc5971603b3c727b8ef34b4b55918fb19/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e4c9055158de2e726dde6419a7ba5ab6287a75eb7c2d024f9b1b97c10bad93e6/contract';
import startContract from '../../snapshots/e4c9055158de2e726dde6419a7ba5ab6287a75eb7c2d024f9b1b97c10bad93e6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'refresh_sessions',
        column: col('ip_address', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'refresh_sessions',
        column: col('last_used_at', 'timestamptz', {
          notNull: true,
          default: fn('now()'),
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'refresh_sessions',
        column: col('user_agent', 'character varying(300)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 300 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
