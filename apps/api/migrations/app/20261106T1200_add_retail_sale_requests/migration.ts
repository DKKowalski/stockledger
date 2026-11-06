#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0a5e3f164465a966bac6eb041f64856deb7b954fac9c6b6640394913ac060faf/contract';
import endContract from '../../snapshots/0a5e3f164465a966bac6eb041f64856deb7b954fac9c6b6640394913ac060faf/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/13064f39dbe9249c0ad572d12a9b3febc3696026d4eb52c5baf475f2fe93bcf0/contract';
import startContract from '../../snapshots/13064f39dbe9249c0ad572d12a9b3febc3696026d4eb52c5baf475f2fe93bcf0/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'retail_sale_requests',
        columns: [
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('created_by_user_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('idempotency_key', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('location_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('request_hash', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('result', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'retail_sale_requests',
        constraint: 'retail_sale_requests_company_id_idempotency_key_key',
        columns: ['company_id', 'idempotency_key'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'retail_sale_requests',
        index: 'retail_sale_requests_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'retail_sale_requests',
        foreignKey: {
          name: 'retail_sale_requests_company_id_fkey',
          columns: ['company_id'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      rawSql({
        id: 'retail_sale_requests.runtime_grants', label: 'Grant append-only retail receipts and guarded deletion',
        operationClass: 'data', target: { id: 'postgres' },
        precheck: [{ description: 'Retail receipt grants need applying', sql: "SELECT NOT has_table_privilege('stockledger_app', 'public.retail_sale_requests', 'SELECT, INSERT, DELETE') AS result" }],
        execute: [{ description: 'Grant retail receipt access', sql: 'GRANT SELECT, INSERT, DELETE ON public.retail_sale_requests TO stockledger_app' }],
        postcheck: [{ description: 'Retail receipt grants exist', sql: "SELECT has_table_privilege('stockledger_app', 'public.retail_sale_requests', 'SELECT, INSERT, DELETE') AND NOT has_table_privilege('stockledger_app', 'public.retail_sale_requests', 'UPDATE') AS result" }],
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'retail_sale_requests' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'retail_sale_requests',
        policy: {
          naming: { kind: 'wire', prefix: 'retail_sale_request_read', hash: '10e0fa81' },
          tableName: 'retail_sale_requests',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'retail_sale_requests',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'retail_sale_request_workspace_delete',
            hash: '336681c2',
          },
          tableName: 'retail_sale_requests',
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
        table: 'retail_sale_requests',
        policy: {
          naming: { kind: 'wire', prefix: 'retail_sale_request_write', hash: '1c87de9a' },
          tableName: 'retail_sale_requests',
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
