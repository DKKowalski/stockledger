#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4f48bf1227195da8260ed816c3e42a4dd388868007d92c4c572768ffe36ff896/contract';
import endContract from '../../snapshots/4f48bf1227195da8260ed816c3e42a4dd388868007d92c4c572768ffe36ff896/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/7bb8a0ed60364a679593978242cb0aa1f27f9b3f55cf32b5511df887efcd4981/contract';
import startContract from '../../snapshots/7bb8a0ed60364a679593978242cb0aa1f27f9b3f55cf32b5511df887efcd4981/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('is_active', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('password_reset_expires_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('password_reset_token_hash', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'users',
        constraint: 'users_password_reset_token_hash_key',
        columns: ['password_reset_token_hash'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
