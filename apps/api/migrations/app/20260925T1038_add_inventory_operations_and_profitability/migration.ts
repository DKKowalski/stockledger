#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/34bcef8ebc6d466edf2f3fa85cba4bd89f288e8e3f3246002a450211536d2918/contract';
import startContract from '../../snapshots/34bcef8ebc6d466edf2f3fa85cba4bd89f288e8e3f3246002a450211536d2918/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/6a950c83571a1a94da9115cc7dc0d3d171f50e243f746584bb67aaf8bcf4f410/contract';
import endContract from '../../snapshots/6a950c83571a1a94da9115cc7dc0d3d171f50e243f746584bb67aaf8bcf4f410/contract.json' with { type: 'json' };
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
      this.dropCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movement_sale_price_valid_b98fe941',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movements_type_check_6b3e5aa1',
      }),
      this.createTable({
        schema: 'public',
        table: 'stock_counts',
        columns: [
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('counted_at', 'date', { notNull: true, codecRef: { codecId: 'pg/date-string@1' } }),
          col('counted_by_user_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('counted_quantity', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('expected_quantity', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('item_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('location_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('note', 'character varying(500)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 500 } },
          }),
          col('unit_cost_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('variance_quantity', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('stock_count_counted_nonnegative_f149168a', 'counted_quantity >= 0'),
          checkExpression('stock_count_expected_nonnegative_b29d3415', 'expected_quantity >= 0'),
          checkExpression('stock_count_unit_cost_nonnegative_0e3258af', 'unit_cost_cents >= 0'),
          checkExpression(
            'stock_count_variance_matches_0846da72',
            'variance_quantity = counted_quantity - expected_quantity',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'suppliers',
        columns: [
          col('address', 'character varying(300)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 300 } },
          }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('email', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('is_active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'character varying(120)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 120 } },
          }),
          col('phone', 'character varying(40)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 40 } },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'inventory_items',
        column: col('is_active', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('related_movement_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('stock_count_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('supplier_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('unit_cost_cents', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'stock_counts',
        constraint: 'stock_counts_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movement_count_adjustment_only_dc5031ec',
        expression: "stock_count_id IS NULL OR type IN ('adjustment_in', 'adjustment_out')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movement_relation_return_only_e0e0fb05',
        expression: "related_movement_id IS NULL OR type = 'return_in'",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movement_sale_price_valid_252038cc',
        expression:
          "unit_price_cents IS NULL OR (type IN ('sale', 'return_in') AND unit_price_cents >= 0)",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movement_supplier_purchase_only_c3bb2d28',
        expression: "supplier_id IS NULL OR type = 'purchase'",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movement_unit_cost_nonnegative_e010375b',
        expression: 'unit_cost_cents IS NULL OR unit_cost_cents >= 0',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movements_type_check_e80a452a',
        expression:
          "\"type\" IN ('purchase', 'transfer', 'return_in', 'return_out', 'damage', 'sale', 'adjustment_in', 'adjustment_out')",
      }),
      this.addUnique({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movements_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'suppliers',
        constraint: 'suppliers_company_id_name_key',
        columns: ['company_id', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'suppliers',
        constraint: 'suppliers_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_counts',
        index: 'stock_counts_company_id_counted_by_user_id_idx_5b58b57a',
        columns: ['company_id', 'counted_by_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_counts',
        index: 'stock_counts_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_counts',
        index: 'stock_counts_company_id_item_id_idx_a27622c0',
        columns: ['company_id', 'item_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_counts',
        index: 'stock_counts_company_id_location_id_idx_a140a7ef',
        columns: ['company_id', 'location_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_counts',
        index: 'stock_counts_counted_at_idx_71d1fe77',
        columns: ['counted_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_counts',
        index: 'stock_counts_item_id_idx_4b8ce5fb',
        columns: ['item_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_counts',
        index: 'stock_counts_location_id_idx_6316b129',
        columns: ['location_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_company_id_related_movement_id_idx_5b843ea9',
        columns: ['company_id', 'related_movement_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_company_id_stock_count_id_idx_4022f0af',
        columns: ['company_id', 'stock_count_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_company_id_supplier_id_idx_c713a553',
        columns: ['company_id', 'supplier_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_related_movement_id_idx_1d81e109',
        columns: ['related_movement_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_stock_count_id_idx_eae46c55',
        columns: ['stock_count_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_supplier_id_idx_c2f51ce2',
        columns: ['supplier_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'suppliers',
        index: 'suppliers_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_counts',
        foreignKey: {
          name: 'stock_counts_company_id_item_id_fkey',
          columns: ['company_id', 'item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_counts',
        foreignKey: {
          name: 'stock_counts_company_id_location_id_fkey',
          columns: ['company_id', 'location_id'],
          references: { schema: 'public', table: 'locations', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_counts',
        foreignKey: {
          name: 'stock_counts_company_id_counted_by_user_id_fkey',
          columns: ['company_id', 'counted_by_user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'stock_movements_company_id_related_movement_id_fkey',
          columns: ['company_id', 'related_movement_id'],
          references: { schema: 'public', table: 'stock_movements', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'stock_movements_company_id_stock_count_id_fkey',
          columns: ['company_id', 'stock_count_id'],
          references: { schema: 'public', table: 'stock_counts', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'suppliers',
        foreignKey: {
          name: 'suppliers_company_id_fkey',
          columns: ['company_id'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'stock_movements_company_id_supplier_id_fkey',
          columns: ['company_id', 'supplier_id'],
          references: { schema: 'public', table: 'suppliers', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      rawSql({
        id: 'inventory_operations.grant_runtime_tables',
        label: 'Grant the restricted API role access to inventory operation tables',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [{
          description: 'Runtime table permissions need to be granted',
          sql: `SELECT NOT (
            has_table_privilege('stockledger_app', 'public.stock_counts', 'SELECT, INSERT, UPDATE, DELETE')
            AND has_table_privilege('stockledger_app', 'public.suppliers', 'SELECT, INSERT, UPDATE, DELETE')
          ) AS result`,
        }],
        execute: [{
          description: 'Grant runtime table permissions',
          sql: `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
            public.stock_counts,
            public.suppliers
          TO stockledger_app`,
        }],
        postcheck: [{
          description: 'The restricted API role can use the inventory operation tables',
          sql: `SELECT
            has_table_privilege('stockledger_app', 'public.stock_counts', 'SELECT, INSERT, UPDATE, DELETE')
            AND has_table_privilege('stockledger_app', 'public.suppliers', 'SELECT, INSERT, UPDATE, DELETE')
          AS result`,
        }],
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'stock_counts' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'suppliers' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'stock_counts',
        policy: {
          naming: { kind: 'wire', prefix: 'stock_count_tenant', hash: 'f6e81ebe' },
          tableName: 'stock_counts',
          namespaceId: 'public',
          operation: 'all',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          withCheck:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'suppliers',
        policy: {
          naming: { kind: 'wire', prefix: 'supplier_tenant', hash: 'f6e81ebe' },
          tableName: 'suppliers',
          namespaceId: 'public',
          operation: 'all',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          withCheck:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
