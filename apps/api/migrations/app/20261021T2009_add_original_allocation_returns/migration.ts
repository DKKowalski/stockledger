#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/07c01bde97422dd89f62ff221bf146cbfc0e62da3f0043d6dc7e756d2bded2ea/contract';
import endContract from '../../snapshots/07c01bde97422dd89f62ff221bf146cbfc0e62da3f0043d6dc7e756d2bded2ea/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f2465c7fd10f756e827fda152d9699876bc1d267ba7de9cc24f2a037aa24a7c6/contract';
import startContract from '../../snapshots/f2465c7fd10f756e827fda152d9699876bc1d267ba7de9cc24f2a037aa24a7c6/contract.json' with { type: 'json' };
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
      this.dropConstraint({
        schema: 'public',
        table: 'inventory_valuation_entries',
        constraint: 'inventory_valuation_entries_company_id_request_id_key',
      }),
      this.createTable({
        schema: 'public',
        table: 'sale_return_allocations',
        columns: [
          col('cogs_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('disposition', 'character varying(12)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 12 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('item_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('loss_movement_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('original_movement_id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('position', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('quantity', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('refund_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('return_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('return_movement_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('unit_cost_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('unit_price_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'sale_return_allocation_valid_7d8bd791',
            "position >= 0 AND quantity > 0 AND unit_price_cents >= 0 AND unit_cost_cents >= 0 AND refund_cents::bigint = quantity::bigint * unit_price_cents AND cogs_cents::bigint = quantity::bigint * unit_cost_cents AND ((disposition = 'resellable' AND loss_movement_id IS NULL) OR (disposition = 'damaged' AND loss_movement_id IS NOT NULL))",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'sale_return_requests',
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
          col('preview_json', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('request_key', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('status', 'character varying(12)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 12 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'sale_return_request_valid_c9187f36',
            "status IN ('prepared','applied','cancelled') AND ((status = 'prepared' AND finished_at IS NULL) OR (status <> 'prepared' AND finished_at IS NOT NULL)) AND ((input_json IS NOT NULL AND preview_json IS NOT NULL AND input_hash IS NOT NULL) OR (status = 'cancelled' AND input_json IS NULL AND preview_json IS NULL AND input_hash IS NULL))",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'sale_returns',
        columns: [
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
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('kind', 'character varying(12)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 12 } },
          }),
          col('legacy_movement_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('location_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('movement_date', 'date', {
            notNull: true,
            codecRef: { codecId: 'pg/date-string@1' },
          }),
          col('reason', 'character varying(200)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 200 } },
          }),
          col('reference', 'character varying(200)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 200 } },
          }),
          col('refund_cents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('request_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('source_sale_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'sale_return_valid_43f30c79',
            "(source_sale_id IS NULL) <> (legacy_movement_id IS NULL) AND kind IN ('return','reversal') AND refund_cents >= 0 AND cogs_cents >= 0 AND length(btrim(reason)) > 0 AND length(btrim(reference)) > 0",
          ),
        ],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'inventory_valuation_entries',
        constraint: 'valuation_entry_valid_40761e35',
        expression:
          "sequence > 0 AND quantity_after >= 0 AND value_after_cents >= 0 AND (quantity_after > 0 OR value_after_cents = 0) AND length(btrim(reference)) > 0 AND ((kind = 'receipt' AND quantity_delta > 0 AND value_delta_cents >= 0 AND movement_id IS NOT NULL AND request_id IS NOT NULL) OR (kind = 'sale' AND quantity_delta < 0 AND value_delta_cents <= 0 AND movement_id IS NOT NULL AND request_id IS NULL) OR (kind = 'customer_return' AND quantity_delta > 0 AND value_delta_cents >= 0 AND movement_id IS NOT NULL AND request_id IS NULL) OR (kind = 'return_disposal' AND quantity_delta = 0 AND value_delta_cents = 0 AND movement_id IS NOT NULL AND request_id IS NULL) OR (kind IN ('damage','count_out','supplier_return','receipt_reversal') AND quantity_delta < 0 AND value_delta_cents <= 0 AND movement_id IS NOT NULL AND request_id IS NOT NULL) OR (kind = 'count_in' AND quantity_delta > 0 AND value_delta_cents >= 0 AND movement_id IS NOT NULL AND request_id IS NOT NULL) OR (kind = 'transfer' AND quantity_delta = 0 AND value_delta_cents = 0 AND movement_id IS NOT NULL AND request_id IS NOT NULL) OR (kind = 'count_check' AND quantity_delta = 0 AND value_delta_cents = 0 AND movement_id IS NULL AND request_id IS NOT NULL) OR (kind = 'value_adjustment' AND quantity_delta = 0 AND movement_id IS NULL AND request_id IS NOT NULL))",
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'inventory_valuation_entries',
        constraint: 'valuation_entry_valid_6d8c9d4f',
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_return_allocations',
        constraint: 'sale_return_allocations_company_id_return_id_position_key',
        columns: ['company_id', 'return_id', 'position'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_return_allocations',
        constraint: 'sale_return_allocations_company_id_return_movement_id_key',
        columns: ['company_id', 'return_movement_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_return_allocations',
        constraint: 'sale_return_allocations_company_id_loss_movement_id_key',
        columns: ['company_id', 'loss_movement_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_return_requests',
        constraint: 'sale_return_requests_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_return_requests',
        constraint: 'sale_return_requests_company_id_request_key_key',
        columns: ['company_id', 'request_key'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_returns',
        constraint: 'sale_returns_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sale_returns',
        constraint: 'sale_returns_company_id_request_id_key',
        columns: ['company_id', 'request_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'inventory_valuation_entries',
        index: 'inventory_valuation_entries_company_id_request_id_idx_47368113',
        columns: ['company_id', 'request_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_return_allocations',
        index: 'sale_return_allocations_company_id_item_id_idx_a27622c0',
        columns: ['company_id', 'item_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_return_allocations',
        index: 'sale_return_allocations_company_id_original_movement_i_e6cab644',
        columns: ['company_id', 'original_movement_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_return_allocations',
        index: 'sale_return_allocations_company_id_return_id_idx_a2d80f4e',
        columns: ['company_id', 'return_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_return_requests',
        index: 'sale_return_requests_company_id_created_by_user_id_idx_fd5eba49',
        columns: ['company_id', 'created_by_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_return_requests',
        index: 'sale_return_requests_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_returns',
        index: 'sale_returns_company_id_created_by_user_id_idx_fd5eba49',
        columns: ['company_id', 'created_by_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_returns',
        index: 'sale_returns_company_id_legacy_movement_id_idx_25046540',
        columns: ['company_id', 'legacy_movement_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_returns',
        index: 'sale_returns_company_id_location_id_idx_a140a7ef',
        columns: ['company_id', 'location_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sale_returns',
        index: 'sale_returns_company_id_source_sale_id_idx_f69ee873',
        columns: ['company_id', 'source_sale_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_return_allocations',
        foreignKey: {
          name: 'sale_return_allocations_company_id_return_id_fkey',
          columns: ['company_id', 'return_id'],
          references: { schema: 'public', table: 'sale_returns', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_return_allocations',
        foreignKey: {
          name: 'sale_return_allocations_company_id_item_id_fkey',
          columns: ['company_id', 'item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_return_allocations',
        foreignKey: {
          name: 'sale_return_allocations_company_id_original_movement_id_fkey',
          columns: ['company_id', 'original_movement_id'],
          references: { schema: 'public', table: 'stock_movements', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_return_allocations',
        foreignKey: {
          name: 'sale_return_allocations_company_id_return_movement_id_fkey',
          columns: ['company_id', 'return_movement_id'],
          references: { schema: 'public', table: 'stock_movements', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_return_allocations',
        foreignKey: {
          name: 'sale_return_allocations_company_id_loss_movement_id_fkey',
          columns: ['company_id', 'loss_movement_id'],
          references: { schema: 'public', table: 'stock_movements', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_return_requests',
        foreignKey: {
          name: 'sale_return_requests_company_id_fkey',
          columns: ['company_id'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_return_requests',
        foreignKey: {
          name: 'sale_return_requests_company_id_created_by_user_id_fkey',
          columns: ['company_id', 'created_by_user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_returns',
        foreignKey: {
          name: 'sale_returns_company_id_request_id_fkey',
          columns: ['company_id', 'request_id'],
          references: {
            schema: 'public',
            table: 'sale_return_requests',
            columns: ['company_id', 'id'],
          },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_returns',
        foreignKey: {
          name: 'sale_returns_company_id_source_sale_id_fkey',
          columns: ['company_id', 'source_sale_id'],
          references: { schema: 'public', table: 'sales', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_returns',
        foreignKey: {
          name: 'sale_returns_company_id_legacy_movement_id_fkey',
          columns: ['company_id', 'legacy_movement_id'],
          references: { schema: 'public', table: 'stock_movements', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_returns',
        foreignKey: {
          name: 'sale_returns_company_id_location_id_fkey',
          columns: ['company_id', 'location_id'],
          references: { schema: 'public', table: 'locations', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sale_returns',
        foreignKey: {
          name: 'sale_returns_company_id_created_by_user_id_fkey',
          columns: ['company_id', 'created_by_user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'sale_return_allocations' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'sale_return_requests' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'sale_returns' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'sale_return_allocations',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_return_allocation_delete', hash: '336681c2' },
          tableName: 'sale_return_allocations',
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
        table: 'sale_return_allocations',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_return_allocation_insert', hash: '1c87de9a' },
          tableName: 'sale_return_allocations',
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
        table: 'sale_return_allocations',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_return_allocation_select', hash: '10e0fa81' },
          tableName: 'sale_return_allocations',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'sale_return_requests',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_return_request_delete', hash: '336681c2' },
          tableName: 'sale_return_requests',
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
        table: 'sale_return_requests',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_return_request_finish', hash: '277a30ed' },
          tableName: 'sale_return_requests',
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
        table: 'sale_return_requests',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_return_request_insert', hash: '1c87de9a' },
          tableName: 'sale_return_requests',
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
        table: 'sale_return_requests',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_return_request_select', hash: '10e0fa81' },
          tableName: 'sale_return_requests',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'sale_returns',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_return_delete', hash: '336681c2' },
          tableName: 'sale_returns',
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
        table: 'sale_returns',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_return_insert', hash: '1c87de9a' },
          tableName: 'sale_returns',
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
        table: 'sale_returns',
        policy: {
          naming: { kind: 'wire', prefix: 'sale_return_select', hash: '10e0fa81' },
          tableName: 'sale_returns',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      rawSql({id:'sale_returns.runtime_grants',label:'Grant immutable returns and guarded request completion',operationClass:'data',target:{id:'postgres'},
        precheck:[{description:'Return grants absent',sql:"SELECT NOT has_table_privilege('stockledger_app','public.sale_returns','SELECT') AS result"}],
        execute:[{description:'Immutable return records',sql:'GRANT SELECT,INSERT,DELETE ON public.sale_return_requests,public.sale_returns,public.sale_return_allocations TO stockledger_app'},{description:'Only request terminal columns are mutable',sql:'GRANT UPDATE(status,finished_at) ON public.sale_return_requests TO stockledger_app'}],
        postcheck:[{description:'Immutable inputs and records',sql:"SELECT has_table_privilege('stockledger_app','public.sale_returns','SELECT,INSERT,DELETE') AND NOT has_table_privilege('stockledger_app','public.sale_returns','UPDATE') AND NOT has_column_privilege('stockledger_app','public.sale_return_requests','input_json','UPDATE') AND has_column_privilege('stockledger_app','public.sale_return_requests','status','UPDATE') AS result"}],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
