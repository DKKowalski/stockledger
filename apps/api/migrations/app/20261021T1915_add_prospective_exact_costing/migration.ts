#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5e8e852febcc03cb527bfc394bdd4f43630adb06900e55fbba9f3411434b8d8e/contract';
import startContract from '../../snapshots/5e8e852febcc03cb527bfc394bdd4f43630adb06900e55fbba9f3411434b8d8e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f2465c7fd10f756e827fda152d9699876bc1d267ba7de9cc24f2a037aa24a7c6/contract';
import endContract from '../../snapshots/f2465c7fd10f756e827fda152d9699876bc1d267ba7de9cc24f2a037aa24a7c6/contract.json' with { type: 'json' };
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
        table: 'inventory_valuation_checkpoints',
        columns: [
          col('base_unit', 'character varying(20)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('cost_review_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
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
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('item_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('opening_quantity', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('opening_value_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('reference', 'character varying(200)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 200 } },
          }),
          col('request_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'valuation_checkpoint_valid_ed805c31',
            'opening_quantity >= 0 AND opening_value_cents >= 0 AND (opening_quantity > 0 OR opening_value_cents = 0) AND length(btrim(reference)) > 0 AND length(btrim(base_unit)) > 0',
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'inventory_valuation_entries',
        columns: [
          col('checkpoint_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('created_by_user_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('item_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('kind', 'character varying(20)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('movement_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('quantity_after', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('quantity_delta', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('reference', 'character varying(200)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 200 } },
          }),
          col('request_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('sequence', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('value_after_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('value_delta_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'valuation_entry_valid_6d8c9d4f',
            "sequence > 0 AND quantity_after >= 0 AND value_after_cents >= 0 AND (quantity_after > 0 OR value_after_cents = 0) AND length(btrim(reference)) > 0 AND ((kind = 'receipt' AND quantity_delta > 0 AND value_delta_cents >= 0 AND movement_id IS NOT NULL AND request_id IS NOT NULL) OR (kind = 'sale' AND quantity_delta < 0 AND value_delta_cents <= 0 AND movement_id IS NOT NULL AND request_id IS NULL) OR (kind = 'value_adjustment' AND quantity_delta = 0 AND movement_id IS NULL AND request_id IS NOT NULL))",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'inventory_valuation_requests',
        columns: [
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('created_by_user_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('finished_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('input_hash', 'character varying(64)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('input_json', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('item_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('request_key', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('status', 'character varying(12)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 12 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'valuation_request_valid_60cd4609',
            "status IN ('prepared','applied','cancelled') AND ((status = 'prepared' AND finished_at IS NULL) OR (status <> 'prepared' AND finished_at IS NOT NULL)) AND ((item_id IS NOT NULL AND input_json IS NOT NULL AND input_hash IS NOT NULL) OR (status = 'cancelled' AND item_id IS NULL AND input_json IS NULL AND input_hash IS NULL))",
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'sale_lines',
        column: col('valuation_checkpoint_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_valuation_checkpoints',
        constraint: 'inventory_valuation_checkpoints_company_id_item_id_key',
        columns: ['company_id', 'item_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_valuation_checkpoints',
        constraint: 'inventory_valuation_checkpoints_company_id_item_id_id_key',
        columns: ['company_id', 'item_id', 'id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_valuation_checkpoints',
        constraint: 'inventory_valuation_checkpoints_company_id_request_id_key',
        columns: ['company_id', 'request_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_valuation_entries',
        constraint: 'inventory_valuation_entries_company_id_item_id_sequence_key',
        columns: ['company_id', 'item_id', 'sequence'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_valuation_entries',
        constraint: 'inventory_valuation_entries_company_id_movement_id_key',
        columns: ['company_id', 'movement_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_valuation_entries',
        constraint: 'inventory_valuation_entries_company_id_request_id_key',
        columns: ['company_id', 'request_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_valuation_requests',
        constraint: 'inventory_valuation_requests_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_valuation_requests',
        constraint: 'inventory_valuation_requests_company_id_request_key_key',
        columns: ['company_id', 'request_key'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'sale_lines',
        constraint: 'sale_line_amounts_valid_491d1ffe',
        expression:
          'position >= 0 AND quantity > 0 AND retail_price_cents >= 0 AND unit_cost_cents >= 0 AND gross_sales_cents::bigint = quantity::bigint * retail_price_cents AND cogs_cents >= 0 AND (valuation_checkpoint_id IS NOT NULL OR cogs_cents::bigint = quantity::bigint * unit_cost_cents) AND total_cents >= 0 AND automatic_discount_cents >= 0 AND gross_sales_cents::bigint - automatic_discount_cents = total_cents',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'sale_lines',
        constraint: 'sale_line_amounts_valid_34a14717',
      }),
      this.createIndex({
        schema: 'public',
        table: 'inventory_valuation_checkpoints',
        index: 'inventory_valuation_checkpoints_company_id_created_by__fd5eba49',
        columns: ['company_id', 'created_by_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'inventory_valuation_entries',
        index: 'inventory_valuation_entries_company_id_created_by_user_fd5eba49',
        columns: ['company_id', 'created_by_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'inventory_valuation_entries',
        index: 'inventory_valuation_entries_company_id_item_id_checkpo_083480a5',
        columns: ['company_id', 'item_id', 'checkpoint_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'inventory_valuation_requests',
        index: 'inventory_valuation_requests_company_id_created_by_use_fd5eba49',
        columns: ['company_id', 'created_by_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'inventory_valuation_requests',
        index: 'inventory_valuation_requests_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'inventory_valuation_requests',
        index: 'inventory_valuation_requests_company_id_item_id_idx_a27622c0',
        columns: ['company_id', 'item_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_lines',
        index: 'sale_lines_company_id_item_id_valuation_checkpoint_id__2fc0facd',
        columns: ['company_id', 'item_id', 'valuation_checkpoint_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_valuation_checkpoints',
        foreignKey: {
          name: 'inventory_valuation_checkpoints_company_id_item_id_fkey',
          columns: ['company_id', 'item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_valuation_checkpoints',
        foreignKey: {
          name: 'inventory_valuation_checkpoints_company_id_request_id_fkey',
          columns: ['company_id', 'request_id'],
          references: {
            schema: 'public',
            table: 'inventory_valuation_requests',
            columns: ['company_id', 'id'],
          },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_valuation_checkpoints',
        foreignKey: {
          name: 'inventory_valuation_checkpoints_company_id_created_by_user_id_fkey',
          columns: ['company_id', 'created_by_user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_valuation_entries',
        foreignKey: {
          name: 'inventory_valuation_entries_company_id_item_id_checkpoint_id_fkey',
          columns: ['company_id', 'item_id', 'checkpoint_id'],
          references: {
            schema: 'public',
            table: 'inventory_valuation_checkpoints',
            columns: ['company_id', 'item_id', 'id'],
          },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_valuation_entries',
        foreignKey: {
          name: 'inventory_valuation_entries_company_id_request_id_fkey',
          columns: ['company_id', 'request_id'],
          references: {
            schema: 'public',
            table: 'inventory_valuation_requests',
            columns: ['company_id', 'id'],
          },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_valuation_entries',
        foreignKey: {
          name: 'inventory_valuation_entries_company_id_movement_id_fkey',
          columns: ['company_id', 'movement_id'],
          references: { schema: 'public', table: 'stock_movements', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_valuation_entries',
        foreignKey: {
          name: 'inventory_valuation_entries_company_id_created_by_user_id_fkey',
          columns: ['company_id', 'created_by_user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_valuation_requests',
        foreignKey: {
          name: 'inventory_valuation_requests_company_id_fkey',
          columns: ['company_id'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_valuation_requests',
        foreignKey: {
          name: 'inventory_valuation_requests_company_id_created_by_user_id_fkey',
          columns: ['company_id', 'created_by_user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_valuation_requests',
        foreignKey: {
          name: 'inventory_valuation_requests_company_id_item_id_fkey',
          columns: ['company_id', 'item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_lines',
        foreignKey: {
          name: 'sale_lines_company_id_item_id_valuation_checkpoint_id_fkey',
          columns: ['company_id', 'item_id', 'valuation_checkpoint_id'],
          references: {
            schema: 'public',
            table: 'inventory_valuation_checkpoints',
            columns: ['company_id', 'item_id', 'id'],
          },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'inventory_valuation_checkpoints' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'inventory_valuation_entries' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'inventory_valuation_requests' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'inventory_valuation_checkpoints',
        policy: {
          naming: { kind: 'wire', prefix: 'valuation_checkpoint_delete', hash: '336681c2' },
          tableName: 'inventory_valuation_checkpoints',
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
        table: 'inventory_valuation_checkpoints',
        policy: {
          naming: { kind: 'wire', prefix: 'valuation_checkpoint_insert', hash: '1c87de9a' },
          tableName: 'inventory_valuation_checkpoints',
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
        table: 'inventory_valuation_checkpoints',
        policy: {
          naming: { kind: 'wire', prefix: 'valuation_checkpoint_select', hash: '10e0fa81' },
          tableName: 'inventory_valuation_checkpoints',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'inventory_valuation_entries',
        policy: {
          naming: { kind: 'wire', prefix: 'valuation_entry_delete', hash: '336681c2' },
          tableName: 'inventory_valuation_entries',
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
        table: 'inventory_valuation_entries',
        policy: {
          naming: { kind: 'wire', prefix: 'valuation_entry_insert', hash: '1c87de9a' },
          tableName: 'inventory_valuation_entries',
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
        table: 'inventory_valuation_entries',
        policy: {
          naming: { kind: 'wire', prefix: 'valuation_entry_select', hash: '10e0fa81' },
          tableName: 'inventory_valuation_entries',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'inventory_valuation_requests',
        policy: {
          naming: { kind: 'wire', prefix: 'valuation_request_delete', hash: '336681c2' },
          tableName: 'inventory_valuation_requests',
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
        table: 'inventory_valuation_requests',
        policy: {
          naming: { kind: 'wire', prefix: 'valuation_request_finish', hash: '277a30ed' },
          tableName: 'inventory_valuation_requests',
          namespaceId: 'public',
          operation: 'update',
          roles: ['stockledger_app'],
          using:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid AND status = 'prepared'",
          withCheck:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid AND status IN ('applied','cancelled')",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'inventory_valuation_requests',
        policy: {
          naming: { kind: 'wire', prefix: 'valuation_request_insert', hash: '1c87de9a' },
          tableName: 'inventory_valuation_requests',
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
        table: 'inventory_valuation_requests',
        policy: {
          naming: { kind: 'wire', prefix: 'valuation_request_select', hash: '10e0fa81' },
          tableName: 'inventory_valuation_requests',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      rawSql({
        id: 'exact_costing.runtime_grants', label: 'Grant immutable valuation records and request completion only', operationClass: 'data', target: {id:'postgres'},
        precheck: [{description:'Valuation grants not applied',sql:"SELECT NOT has_table_privilege('stockledger_app','public.inventory_valuation_entries','SELECT') AS result"}],
        execute: [{description:'Grant immutable ledger access',sql:'GRANT SELECT, INSERT, DELETE ON public.inventory_valuation_checkpoints, public.inventory_valuation_entries, public.inventory_valuation_requests TO stockledger_app'}, {description:'Grant request completion columns only',sql:'GRANT UPDATE (status, finished_at) ON public.inventory_valuation_requests TO stockledger_app'}],
        postcheck: [{description:'Append-only ledger; immutable request payload',sql:"SELECT has_table_privilege('stockledger_app','public.inventory_valuation_entries','SELECT,INSERT,DELETE') AND NOT has_table_privilege('stockledger_app','public.inventory_valuation_entries','UPDATE') AND NOT has_table_privilege('stockledger_app','public.inventory_valuation_checkpoints','UPDATE') AND has_column_privilege('stockledger_app','public.inventory_valuation_requests','status','UPDATE') AND NOT has_column_privilege('stockledger_app','public.inventory_valuation_requests','input_json','UPDATE') AS result"}],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
