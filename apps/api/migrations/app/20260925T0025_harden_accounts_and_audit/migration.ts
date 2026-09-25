#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/76d4a739c3bb266665c8a9c4d6635e52602203a01c99bd7dd841d377f03a912a/contract';
import endContract from '../../snapshots/76d4a739c3bb266665c8a9c4d6635e52602203a01c99bd7dd841d377f03a912a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9360eec135fc9559f39d49b1b345b503aab02c8f82bf572745bb6f2e75a1b8bb/contract';
import startContract from '../../snapshots/9360eec135fc9559f39d49b1b345b503aab02c8f82bf572745bb6f2e75a1b8bb/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'audit_events',
        columns: [
          col('action', 'character varying(80)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 80 } },
          }),
          col('actor_user_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('entity_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('entity_type', 'character varying(80)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 80 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('metadata', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'refresh_sessions',
        columns: [
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('expires_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('token_hash', 'character varying(64)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('user_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('email_verification_expires_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('email_verification_token_hash', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('email_verified_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('invitation_accepted_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('invitation_expires_at', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('invitation_token_hash', 'character varying(64)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
      rawSql({
        id: 'accounts.backfill_existing_account_state',
        label: 'Keep existing accounts usable after verification and invitation enforcement',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [{
          description: 'Existing accounts still need their account state backfilled',
          sql: `SELECT EXISTS (
            SELECT 1
            FROM public.users
            WHERE email_verified_at IS NULL
               OR (role <> 'administrator' AND invitation_accepted_at IS NULL)
          ) AS result`,
        }],
        execute: [{
          description: 'Mark existing emails as verified and existing staff accounts as accepted',
          sql: `UPDATE public.users
            SET email_verified_at = COALESCE(email_verified_at, created_at),
                invitation_accepted_at = CASE
                  WHEN role <> 'administrator' THEN COALESCE(invitation_accepted_at, created_at)
                  ELSE invitation_accepted_at
                END`,
        }],
        postcheck: [{
          description: 'Every existing account can continue signing in',
          sql: `SELECT NOT EXISTS (
            SELECT 1
            FROM public.users
            WHERE email_verified_at IS NULL
               OR (role <> 'administrator' AND invitation_accepted_at IS NULL)
          ) AS result`,
        }],
      }),
      this.addUnique({
        schema: 'public',
        table: 'refresh_sessions',
        constraint: 'refresh_sessions_token_hash_key',
        columns: ['token_hash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'users',
        constraint: 'users_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'users',
        constraint: 'users_email_verification_token_hash_key',
        columns: ['email_verification_token_hash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'users',
        constraint: 'users_invitation_token_hash_key',
        columns: ['invitation_token_hash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audit_events',
        index: 'audit_events_actor_user_id_idx_c46ca325',
        columns: ['actor_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audit_events',
        index: 'audit_events_company_id_actor_user_id_idx_8c7112ea',
        columns: ['company_id', 'actor_user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'audit_events',
        index: 'audit_events_company_id_created_at_idx_5ad0c8de',
        columns: ['company_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refresh_sessions',
        index: 'refresh_sessions_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refresh_sessions',
        index: 'refresh_sessions_company_id_user_id_idx_4ba0b82c',
        columns: ['company_id', 'user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refresh_sessions',
        index: 'refresh_sessions_user_id_idx_6c952402',
        columns: ['user_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'audit_events',
        foreignKey: {
          name: 'audit_events_company_id_actor_user_id_fkey',
          columns: ['company_id', 'actor_user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'refresh_sessions',
        foreignKey: {
          name: 'refresh_sessions_company_id_user_id_fkey',
          columns: ['company_id', 'user_id'],
          references: { schema: 'public', table: 'users', columns: ['company_id', 'id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      rawSql({
        id: 'accounts.grant_runtime_access',
        label: 'Grant the application role narrow session and audit permissions',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [{
          description: 'Runtime grants are missing',
          sql: `SELECT NOT (
            has_table_privilege('stockledger_app', 'public.refresh_sessions', 'SELECT,INSERT,UPDATE,DELETE')
            AND has_table_privilege('stockledger_app', 'public.audit_events', 'SELECT,INSERT')
          ) AS result`,
        }],
        execute: [{
          description: 'Allow session rotation and append-only audit writes',
          sql: `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.refresh_sessions TO stockledger_app;
            GRANT SELECT, INSERT ON TABLE public.audit_events TO stockledger_app;
            REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_events FROM stockledger_app`,
        }],
        postcheck: [{
          description: 'Runtime access is narrow and audit events remain append-only',
          sql: `SELECT (
            has_table_privilege('stockledger_app', 'public.refresh_sessions', 'SELECT,INSERT,UPDATE,DELETE')
            AND has_table_privilege('stockledger_app', 'public.audit_events', 'SELECT,INSERT')
            AND NOT has_table_privilege('stockledger_app', 'public.audit_events', 'UPDATE,DELETE,TRUNCATE')
          ) AS result`,
        }],
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'audit_events' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'refresh_sessions' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'audit_events',
        policy: {
          naming: { kind: 'wire', prefix: 'audit_event_read', hash: '10e0fa81' },
          tableName: 'audit_events',
          namespaceId: 'public',
          operation: 'select',
          roles: ['stockledger_app'],
          using: "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'audit_events',
        policy: {
          naming: { kind: 'wire', prefix: 'audit_event_write', hash: '1c87de9a' },
          tableName: 'audit_events',
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
        table: 'refresh_sessions',
        policy: {
          naming: { kind: 'wire', prefix: 'refresh_session_tenant', hash: 'f6e81ebe' },
          tableName: 'refresh_sessions',
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
