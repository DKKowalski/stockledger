#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5e8e852febcc03cb527bfc394bdd4f43630adb06900e55fbba9f3411434b8d8e/contract';
import endContract from '../../snapshots/5e8e852febcc03cb527bfc394bdd4f43630adb06900e55fbba9f3411434b8d8e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c0b596ebd15edbf7aafabd8419386dad09b9ca8b591e1c6be1eb414e8b7a3af9/contract';
import startContract from '../../snapshots/c0b596ebd15edbf7aafabd8419386dad09b9ca8b591e1c6be1eb414e8b7a3af9/contract.json' with { type: 'json' };
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
      // All permissions are on newly created tables; granted after table creation below.

      this.createTable({
        schema: 'public',
        table: 'sale_components',
        columns: [
          col('category', 'character varying(10)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 10 } },
          }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('movement_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('position', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('quantity', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sale_line_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('total_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('unit_price_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'sale_component_valid_124d5f7d',
            "position >= 0 AND quantity > 0 AND unit_price_cents >= 0 AND total_cents::bigint = quantity::bigint * unit_price_cents AND category IN ('retail', 'bulk', 'box')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'sale_lines',
        columns: [
          col('automatic_discount_cents', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('base_unit', 'character varying(20)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('category', 'character varying(80)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 80 } },
          }),
          col('cogs_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('gross_sales_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('item_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('item_name', 'character varying(120)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 120 } },
          }),
          col('position', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('pricing_snapshot', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('quantity', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('retail_price_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sale_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('sku', 'character varying(40)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 40 } },
          }),
          col('total_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('unit_cost_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'sale_line_amounts_valid_34a14717',
            'position >= 0 AND quantity > 0 AND retail_price_cents >= 0 AND unit_cost_cents >= 0 AND gross_sales_cents::bigint = quantity::bigint * retail_price_cents AND cogs_cents::bigint = quantity::bigint * unit_cost_cents AND total_cents >= 0 AND automatic_discount_cents >= 0 AND gross_sales_cents::bigint - automatic_discount_cents = total_cents',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'sales',
        columns: [
          col('automatic_discount_cents', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('cogs_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('created_by_user_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('currency', 'character varying(3)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 3 } },
          }),
          col('gross_sales_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('idempotency_key', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('location_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('movement_date', 'date', {
            notNull: true,
            codecRef: { codecId: 'pg/date-string@1' },
          }),
          col('request_hash', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('total_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'sale_amounts_valid_10975e07',
            'gross_sales_cents >= 0 AND automatic_discount_cents >= 0 AND total_cents >= 0 AND cogs_cents >= 0 AND gross_sales_cents::bigint - automatic_discount_cents = total_cents',
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_components',
        constraint: 'sale_components_company_id_movement_id_key',
        columns: ['company_id', 'movement_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_components',
        constraint: 'sale_components_company_id_sale_line_id_position_key',
        columns: ['company_id', 'sale_line_id', 'position'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_lines',
        constraint: 'sale_lines_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_lines',
        constraint: 'sale_lines_company_id_sale_id_item_id_key',
        columns: ['company_id', 'sale_id', 'item_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_lines',
        constraint: 'sale_lines_company_id_sale_id_position_key',
        columns: ['company_id', 'sale_id', 'position'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sales',
        constraint: 'sales_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sales',
        constraint: 'sales_company_id_idempotency_key_key',
        columns: ['company_id', 'idempotency_key'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_components',
        index: 'sale_components_company_id_sale_line_id_idx_5575d9da',
        columns: ['company_id', 'sale_line_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_lines',
        index: 'sale_lines_company_id_item_id_idx_a27622c0',
        columns: ['company_id', 'item_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_lines',
        index: 'sale_lines_company_id_sale_id_idx_792a8b41',
        columns: ['company_id', 'sale_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales',
        index: 'sales_company_id_created_by_user_id_idx_fd5eba49',
        columns: ['company_id', 'created_by_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales',
        index: 'sales_company_id_location_id_created_at_idx_b7eac4a2',
        columns: ['company_id', 'location_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales',
        index: 'sales_company_id_location_id_idx_a140a7ef',
        columns: ['company_id', 'location_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_components',
        foreignKey: {
          name: 'sale_components_company_id_sale_line_id_fkey',
          columns: ['company_id', 'sale_line_id'],
          references: { schema: 'public', table: 'sale_lines', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_components',
        foreignKey: {
          name: 'sale_components_company_id_movement_id_fkey',
          columns: ['company_id', 'movement_id'],
          references: { schema: 'public', table: 'stock_movements', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_lines',
        foreignKey: {
          name: 'sale_lines_company_id_sale_id_fkey',
          columns: ['company_id', 'sale_id'],
          references: { schema: 'public', table: 'sales', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_lines',
        foreignKey: {
          name: 'sale_lines_company_id_item_id_fkey',
          columns: ['company_id', 'item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales',
        foreignKey: {
          name: 'sales_company_id_location_id_fkey',
          columns: ['company_id', 'location_id'],
          references: { schema: 'public', table: 'locations', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales',
        foreignKey: {
          name: 'sales_company_id_created_by_user_id_fkey',
          columns: ['company_id', 'created_by_user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      rawSql({
        id: 'durable_sales.grant_runtime_access',
        label: 'Grant append-only sale records and guarded workspace deletion',
        operationClass: 'data', target: { id: 'postgres' },
        precheck: [{ description: 'New sale permissions are not yet present', sql: "SELECT NOT has_table_privilege('stockledger_app', 'public.sales', 'SELECT, INSERT, DELETE') AS result" }],
        execute: [{ description: 'Grant only read, insert and RLS-guarded delete', sql: 'GRANT SELECT, INSERT, DELETE ON TABLE public.sales, public.sale_lines, public.sale_components TO stockledger_app' }],
        postcheck: [{ description: 'All new sale tables have append-only permissions', sql: "SELECT bool_and(has_table_privilege('stockledger_app', name, 'SELECT, INSERT, DELETE') AND NOT has_table_privilege('stockledger_app', name, 'UPDATE')) AS result FROM unnest(ARRAY['public.sales','public.sale_lines','public.sale_components']) AS names(name)" }],
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'sale_components' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'sale_lines' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'sales' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'sale_components',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_component_read', hash: '10e0fa81' },
          tableName: 'sale_components',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'sale_components',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_component_workspace_delete', hash: '336681c2' },
          tableName: 'sale_components',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['stockledger_app'],
          using:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid AND current_setting('app.workspace_deletion_company_id', true) = company_id::text",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'sale_components',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_component_write', hash: '1c87de9a' },
          tableName: 'sale_components',
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
        table: 'sale_lines',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_line_read', hash: '10e0fa81' },
          tableName: 'sale_lines',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'sale_lines',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_line_workspace_delete', hash: '336681c2' },
          tableName: 'sale_lines',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['stockledger_app'],
          using:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid AND current_setting('app.workspace_deletion_company_id', true) = company_id::text",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'sale_lines',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_line_write', hash: '1c87de9a' },
          tableName: 'sale_lines',
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
        table: 'sales',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_read', hash: '10e0fa81' },
          tableName: 'sales',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'sales',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_workspace_delete', hash: '336681c2' },
          tableName: 'sales',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['stockledger_app'],
          using:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid AND current_setting('app.workspace_deletion_company_id', true) = company_id::text",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'sales',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_write', hash: '1c87de9a' },
          tableName: 'sales',
          namespaceId: 'public',
          operation: 'insert',
          roles: ['stockledger_app'],
          withCheck:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
