#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/c4fbc1e8ae687b0617957d10d53f7becb388b82717d37defd372239deb414597/contract';
import endContract from '../../snapshots/c4fbc1e8ae687b0617957d10d53f7becb388b82717d37defd372239deb414597/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c5d7a158871ec529bd305865c9f0ff7543ce959baffc4d4cc2dcfa5e323a4ef3/contract';
import startContract from '../../snapshots/c5d7a158871ec529bd305865c9f0ff7543ce959baffc4d4cc2dcfa5e323a4ef3/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
  rawSql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'profit_split_completions',
        columns: [
          col('amount_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('created_by_user_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('destination', 'character varying(120)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 120 } },
          }),
          col('done_on', 'date', { notNull: true, codecRef: { codecId: 'pg/date-string@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('month', 'date', { notNull: true, codecRef: { codecId: 'pg/date-string@1' } }),
          col('note', 'character varying(200)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 200 } },
          }),
          col('part_key', 'character varying(40)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 40 } },
          }),
          col('part_name', 'character varying(80)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 80 } },
          }),
          col('percent_basis_points', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'profit_split_completion_valid_4fce09f3',
            'amount_cents > 0 AND percent_basis_points BETWEEN 1 AND 10000 AND extract(day from month) = 1',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'profit_split_parts',
        columns: [
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('destination', 'character varying(120)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 120 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(80)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 80 } },
          }),
          col('part_key', 'character varying(40)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 40 } },
          }),
          col('percent_basis_points', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('position', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'profit_split_part_valid_a4f6485b',
            'position >= 1 AND percent_basis_points BETWEEN 1 AND 10000',
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'profit_split_completions',
        constraint: 'profit_split_completions_company_id_month_part_key_key',
        columns: ['company_id', 'month', 'part_key'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'profit_split_parts',
        constraint: 'profit_split_parts_company_id_part_key_key',
        columns: ['company_id', 'part_key'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profit_split_completions',
        index: 'profit_split_completions_company_id_created_by_user_id_fd5eba49',
        columns: ['company_id', 'created_by_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profit_split_completions',
        index: 'profit_split_completions_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profit_split_parts',
        index: 'profit_split_parts_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'profit_split_completions',
        foreignKey: {
          name: 'profit_split_completions_company_id_fkey',
          columns: ['company_id'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'profit_split_completions',
        foreignKey: {
          name: 'profit_split_completions_company_id_created_by_user_id_fkey',
          columns: ['company_id', 'created_by_user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'profit_split_parts',
        foreignKey: {
          name: 'profit_split_parts_company_id_fkey',
          columns: ['company_id'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'profit_split_completions' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'profit_split_parts' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profit_split_completions',
        policy: {
          naming: { kind: 'wire', prefix: 'profit_split_completions_delete', hash: 'f027a2a9' },
          tableName: 'profit_split_completions',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profit_split_completions',
        policy: {
          naming: { kind: 'wire', prefix: 'profit_split_completions_insert', hash: '1c87de9a' },
          tableName: 'profit_split_completions',
          namespaceId: 'public',
          operation: 'insert',
          roles: ['stockledger_app'],
          withCheck:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profit_split_completions',
        policy: {
          naming: { kind: 'wire', prefix: 'profit_split_completions_select', hash: '10e0fa81' },
          tableName: 'profit_split_completions',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profit_split_completions',
        policy: {
          naming: { kind: 'wire', prefix: 'profit_split_completions_update', hash: '2c24cb4c' },
          tableName: 'profit_split_completions',
          namespaceId: 'public',
          operation: 'update',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          withCheck:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profit_split_parts',
        policy: {
          naming: { kind: 'wire', prefix: 'profit_split_parts_delete', hash: 'f027a2a9' },
          tableName: 'profit_split_parts',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profit_split_parts',
        policy: {
          naming: { kind: 'wire', prefix: 'profit_split_parts_insert', hash: '1c87de9a' },
          tableName: 'profit_split_parts',
          namespaceId: 'public',
          operation: 'insert',
          roles: ['stockledger_app'],
          withCheck:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profit_split_parts',
        policy: {
          naming: { kind: 'wire', prefix: 'profit_split_parts_select', hash: '10e0fa81' },
          tableName: 'profit_split_parts',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profit_split_parts',
        policy: {
          naming: { kind: 'wire', prefix: 'profit_split_parts_update', hash: '2c24cb4c' },
          tableName: 'profit_split_parts',
          namespaceId: 'public',
          operation: 'update',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          withCheck:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      ...['profit_split_parts', 'profit_split_completions'].map(table => rawSql({
        id: `${table}.runtime_grants`, label: `Grant tenant profit split access to ${table}`, operationClass: 'data', target: { id: 'postgres' },
        precheck: [{ description: 'Profit split grants need applying', sql: `SELECT NOT has_table_privilege('stockledger_app', 'public.${table}', 'SELECT, INSERT, UPDATE, DELETE') AS result` }],
        execute: [{ description: 'Grant runtime profit split access', sql: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO stockledger_app` }],
        postcheck: [{ description: 'Profit split grants exist', sql: `SELECT has_table_privilege('stockledger_app', 'public.${table}', 'SELECT, INSERT, UPDATE, DELETE') AS result` }],
      })),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
