#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/9360eec135fc9559f39d49b1b345b503aab02c8f82bf572745bb6f2e75a1b8bb/contract';
import endContract from '../../snapshots/9360eec135fc9559f39d49b1b345b503aab02c8f82bf572745bb6f2e75a1b8bb/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c350df09a975ceba80862f4ea14af9c48a699d85d7267df93381c23b49a0dbfe/contract';
import startContract from '../../snapshots/c350df09a975ceba80862f4ea14af9c48a699d85d7267df93381c23b49a0dbfe/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'location_stocks',
        constraint: 'location_stocks_item_id_fkey',
        kind: 'foreignKey',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'location_stocks',
        constraint: 'location_stocks_location_id_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'location_stocks',
        index: 'location_stocks_location_id_idx_6316b129',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'location_stocks',
        constraint: 'location_stocks_location_id_item_id_key',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movements_destination_location_id_fkey',
        kind: 'foreignKey',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movements_item_id_fkey',
        kind: 'foreignKey',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movements_location_id_fkey',
        kind: 'foreignKey',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'users',
        constraint: 'users_location_id_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({ schema: 'public', table: 'users', index: 'users_location_id_idx_6316b129' }),
      this.addColumn({
        schema: 'public',
        table: 'location_stocks',
        column: col('company_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      rawSql({
        id: 'tenant.backfill_location_stocks_company_id',
        label: 'Validate and backfill the company on location stock rows',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [{
          description: 'Location stock rows still need a company',
          sql: 'SELECT EXISTS (SELECT 1 FROM public.location_stocks WHERE company_id IS NULL) AS result',
        }],
        execute: [{
          description: 'Reject mixed-company stock rows and copy the item company',
          sql: `DO $tenant$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM public.location_stocks AS stock
                JOIN public.inventory_items AS item ON item.id = stock.item_id
                JOIN public.locations AS location ON location.id = stock.location_id
                WHERE item.company_id <> location.company_id
              ) THEN
                RAISE EXCEPTION 'Cannot secure location_stocks because an item and location belong to different companies';
              END IF;

              UPDATE public.location_stocks AS stock
              SET company_id = item.company_id
              FROM public.inventory_items AS item
              WHERE item.id = stock.item_id AND stock.company_id IS NULL;
            END
            $tenant$`,
        }],
        postcheck: [{
          description: 'Every location stock row has the matching item and location company',
          sql: `SELECT NOT EXISTS (
            SELECT 1
            FROM public.location_stocks AS stock
            JOIN public.inventory_items AS item ON item.id = stock.item_id
            JOIN public.locations AS location ON location.id = stock.location_id
            WHERE stock.company_id IS NULL
              OR stock.company_id <> item.company_id
              OR stock.company_id <> location.company_id
          ) AS result`,
        }],
      }),
      this.setNotNull({ schema: 'public', table: 'location_stocks', column: 'company_id' }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('company_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      rawSql({
        id: 'tenant.backfill_stock_movements_company_id',
        label: 'Validate and backfill the company on stock movements',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [{
          description: 'Stock movement rows still need a company',
          sql: 'SELECT EXISTS (SELECT 1 FROM public.stock_movements WHERE company_id IS NULL) AS result',
        }],
        execute: [{
          description: 'Reject mixed-company movements and copy the item company',
          sql: `DO $tenant$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM public.stock_movements AS movement
                JOIN public.inventory_items AS item ON item.id = movement.item_id
                JOIN public.locations AS source ON source.id = movement.location_id
                LEFT JOIN public.locations AS destination ON destination.id = movement.destination_location_id
                WHERE item.company_id <> source.company_id
                  OR (destination.id IS NOT NULL AND item.company_id <> destination.company_id)
              ) THEN
                RAISE EXCEPTION 'Cannot secure stock_movements because an item and location belong to different companies';
              END IF;

              UPDATE public.stock_movements AS movement
              SET company_id = item.company_id
              FROM public.inventory_items AS item
              WHERE item.id = movement.item_id AND movement.company_id IS NULL;
            END
            $tenant$`,
        }],
        postcheck: [{
          description: 'Every movement has the matching item and location company',
          sql: `SELECT NOT EXISTS (
            SELECT 1
            FROM public.stock_movements AS movement
            JOIN public.inventory_items AS item ON item.id = movement.item_id
            JOIN public.locations AS source ON source.id = movement.location_id
            LEFT JOIN public.locations AS destination ON destination.id = movement.destination_location_id
            WHERE movement.company_id IS NULL
              OR movement.company_id <> item.company_id
              OR movement.company_id <> source.company_id
              OR (destination.id IS NOT NULL AND movement.company_id <> destination.company_id)
          ) AS result`,
        }],
      }),
      this.setNotNull({ schema: 'public', table: 'stock_movements', column: 'company_id' }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_items',
        constraint: 'inventory_items_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'location_stocks',
        constraint: 'location_stocks_company_id_location_id_item_id_key',
        columns: ['company_id', 'location_id', 'item_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'locations',
        constraint: 'locations_company_id_id_key',
        columns: ['company_id', 'id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'location_stocks',
        index: 'location_stocks_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'location_stocks',
        index: 'location_stocks_company_id_item_id_idx_a27622c0',
        columns: ['company_id', 'item_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'location_stocks',
        index: 'location_stocks_company_id_location_id_idx_a140a7ef',
        columns: ['company_id', 'location_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_company_id_destination_location_id_idx_6515c3e8',
        columns: ['company_id', 'destination_location_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_company_id_item_id_idx_a27622c0',
        columns: ['company_id', 'item_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_company_id_location_id_idx_a140a7ef',
        columns: ['company_id', 'location_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'users',
        index: 'users_company_id_location_id_idx_a140a7ef',
        columns: ['company_id', 'location_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'location_stocks',
        foreignKey: {
          name: 'location_stocks_company_id_item_id_fkey',
          columns: ['company_id', 'item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['company_id', 'id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'location_stocks',
        foreignKey: {
          name: 'location_stocks_company_id_location_id_fkey',
          columns: ['company_id', 'location_id'],
          references: { schema: 'public', table: 'locations', columns: ['company_id', 'id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'stock_movements_company_id_destination_location_id_fkey',
          columns: ['company_id', 'destination_location_id'],
          references: { schema: 'public', table: 'locations', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'stock_movements_company_id_item_id_fkey',
          columns: ['company_id', 'item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['company_id', 'id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'stock_movements_company_id_location_id_fkey',
          columns: ['company_id', 'location_id'],
          references: { schema: 'public', table: 'locations', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'users',
        foreignKey: {
          name: 'users_company_id_location_id_fkey',
          columns: ['company_id', 'location_id'],
          references: { schema: 'public', table: 'locations', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      rawSql({
        id: 'tenant.application_role_and_auth_functions',
        label: 'Create the restricted application role and authentication functions',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [{
          description: 'Application role or authentication functions are missing',
          sql: `SELECT NOT (
            to_regrole('stockledger_app') IS NOT NULL
            AND to_regprocedure('public.stockledger_auth_user_by_email(text)') IS NOT NULL
            AND to_regprocedure('public.stockledger_email_owner(text)') IS NOT NULL
            AND to_regprocedure('public.stockledger_company_for_reset_token(text)') IS NOT NULL
          ) AS result`,
        }],
        execute: [{
          description: 'Create the role, grants, and narrow authentication lookup functions',
          sql: `DO $role$
            BEGIN
              IF to_regrole('stockledger_app') IS NULL THEN
                CREATE ROLE stockledger_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
              END IF;
            END
            $role$;

            GRANT USAGE ON SCHEMA public TO stockledger_app;
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
              public.companies,
              public.inventory_items,
              public.location_stocks,
              public.locations,
              public.stock_movements,
              public.users
            TO stockledger_app;

            CREATE OR REPLACE FUNCTION public.stockledger_auth_user_by_email(requested_email text)
            RETURNS TABLE (
              id uuid,
              company_id uuid,
              location_id uuid,
              full_name character varying(120),
              email character varying(255),
              password_hash character varying(255),
              role text,
              is_active boolean,
              created_at timestamptz
            )
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = pg_catalog, pg_temp
            AS $function$
              SELECT user_account.id,
                     user_account.company_id,
                     user_account.location_id,
                     user_account.full_name,
                     user_account.email,
                     user_account.password_hash,
                     user_account.role::text,
                     user_account.is_active,
                     user_account.created_at
              FROM public.users AS user_account
              WHERE lower(user_account.email::text) = lower(requested_email)
              LIMIT 1
            $function$;

            CREATE OR REPLACE FUNCTION public.stockledger_email_owner(requested_email text)
            RETURNS uuid
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = pg_catalog, pg_temp
            AS $function$
              SELECT user_account.id
              FROM public.users AS user_account
              WHERE lower(user_account.email::text) = lower(requested_email)
              LIMIT 1
            $function$;

            CREATE OR REPLACE FUNCTION public.stockledger_company_for_reset_token(requested_hash text)
            RETURNS uuid
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = pg_catalog, pg_temp
            AS $function$
              SELECT user_account.company_id
              FROM public.users AS user_account
              WHERE user_account.password_reset_token_hash::text = requested_hash
              LIMIT 1
            $function$;

            REVOKE ALL ON FUNCTION public.stockledger_auth_user_by_email(text) FROM PUBLIC;
            REVOKE ALL ON FUNCTION public.stockledger_email_owner(text) FROM PUBLIC;
            REVOKE ALL ON FUNCTION public.stockledger_company_for_reset_token(text) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION public.stockledger_auth_user_by_email(text) TO stockledger_app;
            GRANT EXECUTE ON FUNCTION public.stockledger_email_owner(text) TO stockledger_app;
            GRANT EXECUTE ON FUNCTION public.stockledger_company_for_reset_token(text) TO stockledger_app`,
        }],
        postcheck: [{
          description: 'The restricted role and authentication functions exist',
          sql: `SELECT (
            to_regrole('stockledger_app') IS NOT NULL
            AND to_regprocedure('public.stockledger_auth_user_by_email(text)') IS NOT NULL
            AND to_regprocedure('public.stockledger_email_owner(text)') IS NOT NULL
            AND to_regprocedure('public.stockledger_company_for_reset_token(text)') IS NOT NULL
          ) AS result`,
        }],
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'companies',
        policy: {
          naming: { kind: 'wire', prefix: 'company_tenant', hash: '87eb9ca4' },
          tableName: 'companies',
          namespaceId: 'public',
          operation: 'all',
          roles: ['stockledger_app'],
          using: "id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          withCheck: "id = nullif(current_setting('app.current_company_id', true), '')::uuid",
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'inventory_items',
        policy: {
          naming: { kind: 'wire', prefix: 'inventory_item_tenant', hash: 'f6e81ebe' },
          tableName: 'inventory_items',
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
        table: 'location_stocks',
        policy: {
          naming: { kind: 'wire', prefix: 'location_stock_tenant', hash: 'f6e81ebe' },
          tableName: 'location_stocks',
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
        table: 'locations',
        policy: {
          naming: { kind: 'wire', prefix: 'location_tenant', hash: 'f6e81ebe' },
          tableName: 'locations',
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
        table: 'stock_movements',
        policy: {
          naming: { kind: 'wire', prefix: 'stock_movement_tenant', hash: 'f6e81ebe' },
          tableName: 'stock_movements',
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
        table: 'users',
        policy: {
          naming: { kind: 'wire', prefix: 'user_tenant', hash: 'f6e81ebe' },
          tableName: 'users',
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
