#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/af0f799e84bed462c8c7be7ef11cd3ccc5971603b3c727b8ef34b4b55918fb19/contract';
import startContract from '../../snapshots/af0f799e84bed462c8c7be7ef11cd3ccc5971603b3c727b8ef34b4b55918fb19/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c0b596ebd15edbf7aafabd8419386dad09b9ca8b591e1c6be1eb414e8b7a3af9/contract';
import endContract from '../../snapshots/c0b596ebd15edbf7aafabd8419386dad09b9ca8b591e1c6be1eb414e8b7a3af9/contract.json' with { type: 'json' };
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
        table: 'item_pricing_versions',
        columns: [
          col('base_unit', 'character varying(20)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('bulk_tiers', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('created_by_user_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('item_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('package_label', 'character varying(20)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('package_price_cents', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('package_size', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('preview_enabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'item_pricing_base_unit_present_169acc26',
            'length(btrim(base_unit)) > 0',
          ),
          checkExpression(
            'item_pricing_package_valid_dbc7f253',
            '(package_label IS NULL AND package_size IS NULL AND package_price_cents IS NULL) OR (package_label IS NOT NULL AND length(btrim(package_label)) > 0 AND package_size IS NOT NULL AND package_size > 1 AND package_price_cents IS NOT NULL AND package_price_cents >= 0)',
          ),
          checkExpression(
            'item_pricing_tiers_array_47c3262c',
            "jsonb_typeof(bulk_tiers) = 'array'",
          ),
          checkExpression('item_pricing_version_positive_341aaa74', 'version > 0'),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'item_pricing_versions',
        constraint: 'item_pricing_versions_company_id_item_id_version_key',
        columns: ['company_id', 'item_id', 'version'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'item_pricing_versions',
        index: 'item_pricing_actor_idx',
        columns: ['company_id', 'created_by_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'item_pricing_versions',
        index: 'item_pricing_versions_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'item_pricing_versions',
        index: 'item_pricing_versions_company_id_item_id_idx_a27622c0',
        columns: ['company_id', 'item_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'item_pricing_versions',
        foreignKey: {
          name: 'item_pricing_versions_company_id_item_id_fkey',
          columns: ['company_id', 'item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'item_pricing_versions',
        foreignKey: {
          name: 'item_pricing_versions_company_id_created_by_user_id_fkey',
          columns: ['company_id', 'created_by_user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      rawSql({
        id: 'pricing_preview.grant_runtime_access',
        label: 'Grant append-only pricing access and guarded workspace deletion',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [{
          description: 'Runtime pricing permissions need to be granted',
          sql: "SELECT NOT has_table_privilege('stockledger_app', 'public.item_pricing_versions', 'SELECT, INSERT, DELETE') AS result",
        }],
        execute: [{
          description: 'Allow reads, new versions, and RLS-guarded workspace deletion only',
          sql: 'GRANT SELECT, INSERT, DELETE ON TABLE public.item_pricing_versions TO stockledger_app',
        }],
        postcheck: [{
          description: 'Runtime pricing permissions are present without update access',
          sql: "SELECT has_table_privilege('stockledger_app', 'public.item_pricing_versions', 'SELECT, INSERT, DELETE') AND NOT has_table_privilege('stockledger_app', 'public.item_pricing_versions', 'UPDATE') AS result",
        }],
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'item_pricing_versions' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'item_pricing_versions',
        policy: {
          naming: { kind: 'wire', prefix: 'item_pricing_read', hash: '10e0fa81' },
          tableName: 'item_pricing_versions',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'item_pricing_versions',
        policy: {
          naming: { kind: 'wire', prefix: 'item_pricing_workspace_delete', hash: '336681c2' },
          tableName: 'item_pricing_versions',
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
        table: 'item_pricing_versions',
        policy: {
          naming: { kind: 'wire', prefix: 'item_pricing_write', hash: '1c87de9a' },
          tableName: 'item_pricing_versions',
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
