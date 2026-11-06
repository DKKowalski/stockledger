#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/13064f39dbe9249c0ad572d12a9b3febc3696026d4eb52c5baf475f2fe93bcf0/contract';
import endContract from '../../snapshots/13064f39dbe9249c0ad572d12a9b3febc3696026d4eb52c5baf475f2fe93bcf0/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5ccb1739876988e11fc0dc2dfeb65052a75dbaebb1d4f138d285b2c9f8d8ecb6/contract';
import startContract from '../../snapshots/5ccb1739876988e11fc0dc2dfeb65052a75dbaebb1d4f138d285b2c9f8d8ecb6/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
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
        table: 'finance_budgets',
        columns: [
          col('amount_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('line_key', 'character varying(80)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 80 } },
          }),
          col('month', 'date', { notNull: true, codecRef: { codecId: 'pg/date-string@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'finance_budget_valid_b2bc389b',
            'amount_cents >= 0 AND extract(day from month) = 1',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'finance_categories',
        columns: [
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('is_active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'character varying(80)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 80 } },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'finance_entries',
        columns: [
          col('amount_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('category_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('created_by_user_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('entry_date', 'date', { notNull: true, codecRef: { codecId: 'pg/date-string@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('kind', 'character varying(20)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('note', 'character varying(500)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 500 } },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'finance_entry_valid_e8f2b45d',
            "amount_cents > 0 AND ((kind = 'expense' AND category_id IS NOT NULL) OR (kind = 'other_revenue' AND category_id IS NULL))",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'finance_budgets',
        constraint: 'finance_budgets_company_id_month_line_key_key',
        columns: ['company_id', 'month', 'line_key'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'finance_categories',
        constraint: 'finance_categories_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'finance_categories',
        constraint: 'finance_categories_company_id_name_key',
        columns: ['company_id', 'name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'finance_budgets',
        index: 'finance_budgets_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'finance_categories',
        index: 'finance_categories_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'finance_entries',
        index: 'finance_entries_company_id_category_id_idx_3ef78666',
        columns: ['company_id', 'category_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'finance_entries',
        index: 'finance_entries_company_id_created_by_user_id_idx_fd5eba49',
        columns: ['company_id', 'created_by_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'finance_entries',
        index: 'finance_entries_company_id_entry_date_idx_cf43456b',
        columns: ['company_id', 'entry_date'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'finance_entries',
        index: 'finance_entries_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'finance_budgets',
        foreignKey: {
          name: 'finance_budgets_company_id_fkey',
          columns: ['company_id'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'finance_categories',
        foreignKey: {
          name: 'finance_categories_company_id_fkey',
          columns: ['company_id'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'finance_entries',
        foreignKey: {
          name: 'finance_entries_company_id_fkey',
          columns: ['company_id'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'finance_entries',
        foreignKey: {
          name: 'finance_entries_company_id_category_id_fkey',
          columns: ['company_id', 'category_id'],
          references: {
            schema: 'public',
            table: 'finance_categories',
            columns: ['company_id', 'id'],
          },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'finance_entries',
        foreignKey: {
          name: 'finance_entries_company_id_created_by_user_id_fkey',
          columns: ['company_id', 'created_by_user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'finance_budgets' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'finance_categories' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'finance_entries' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'finance_budgets',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_budgets_delete', hash: 'f027a2a9' },
          tableName: 'finance_budgets',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'finance_budgets',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_budgets_insert', hash: '1c87de9a' },
          tableName: 'finance_budgets',
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
        table: 'finance_budgets',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_budgets_select', hash: '10e0fa81' },
          tableName: 'finance_budgets',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'finance_budgets',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_budgets_update', hash: '2c24cb4c' },
          tableName: 'finance_budgets',
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
        table: 'finance_categories',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_categories_delete', hash: 'f027a2a9' },
          tableName: 'finance_categories',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'finance_categories',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_categories_insert', hash: '1c87de9a' },
          tableName: 'finance_categories',
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
        table: 'finance_categories',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_categories_select', hash: '10e0fa81' },
          tableName: 'finance_categories',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'finance_categories',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_categories_update', hash: '2c24cb4c' },
          tableName: 'finance_categories',
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
        table: 'finance_entries',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_entries_delete', hash: 'f027a2a9' },
          tableName: 'finance_entries',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'finance_entries',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_entries_insert', hash: '1c87de9a' },
          tableName: 'finance_entries',
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
        table: 'finance_entries',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_entries_select', hash: '10e0fa81' },
          tableName: 'finance_entries',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'finance_entries',
        policy: {
          naming: { kind: 'wire', prefix: 'finance_entries_update', hash: '2c24cb4c' },
          tableName: 'finance_entries',
          namespaceId: 'public',
          operation: 'update',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          withCheck:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      ...['finance_budgets', 'finance_categories', 'finance_entries'].map(table => rawSql({
        id: `${table}.runtime_grants`, label: `Grant tenant finance access to ${table}`, operationClass: 'data', target: { id: 'postgres' },
        precheck: [{ description: 'Finance grants need applying', sql: `SELECT NOT has_table_privilege('stockledger_app', 'public.${table}', 'SELECT, INSERT, UPDATE, DELETE') AS result` }],
        execute: [{ description: 'Grant runtime finance access', sql: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO stockledger_app` }],
        postcheck: [{ description: 'Finance grants exist', sql: `SELECT has_table_privilege('stockledger_app', 'public.${table}', 'SELECT, INSERT, UPDATE, DELETE') AS result` }],
      })),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
