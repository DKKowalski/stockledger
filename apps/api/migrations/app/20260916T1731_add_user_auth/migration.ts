#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/df03163d99e1f7db874132120495d01cb9a4f6d45a933b32c23a7d2038e9228b/contract';
import endContract from '../../snapshots/df03163d99e1f7db874132120495d01cb9a4f6d45a933b32c23a7d2038e9228b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f6ae5956359cce0fd99f5e4b895406314e7098a608850ce81261424a6f4acbe2/contract';
import startContract from '../../snapshots/f6ae5956359cce0fd99f5e4b895406314e7098a608850ce81261424a6f4acbe2/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'users',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('email', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('full_name', 'character varying(120)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 120 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('password_hash', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('role', 'text', {
            notNull: true,
            default: lit('inventory_manager'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'users_role_check_1e1cae07',
            "\"role\" IN ('administrator', 'inventory_manager')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'users',
        constraint: 'users_email_key',
        columns: ['email'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
