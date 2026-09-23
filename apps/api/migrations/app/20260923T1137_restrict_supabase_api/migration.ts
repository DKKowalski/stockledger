#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3cdf88b5b2bb9a96def5cc8844b291e6bf2f22cb1dd3ace87c77c9a5d1eacd1a/contract';
import startContract from '../../snapshots/3cdf88b5b2bb9a96def5cc8844b291e6bf2f22cb1dd3ace87c77c9a5d1eacd1a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/de2cdacbde8b0ef378d3f7574ab9e1f6338e1db8ca9edc62fc56e3fab22da24d/contract';
import endContract from '../../snapshots/de2cdacbde8b0ef378d3f7574ab9e1f6338e1db8ca9edc62fc56e3fab22da24d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

const APPLICATION_TABLES = [
  'companies',
  'inventory_items',
  'location_stocks',
  'locations',
  'stock_movements',
  'users',
] as const;

const TABLE_ARRAY = APPLICATION_TABLES.map((table) => `'${table}'`).join(', ');
const TABLE_LIST = APPLICATION_TABLES.map((table) => `'${table}'`).join(', ');
const HAS_DATA_API_GRANTS = `EXISTS (
  SELECT 1
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (${TABLE_LIST})
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
)`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.enableRowLevelSecurity({ schema: 'public', table: 'companies' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'inventory_items' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'location_stocks' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'locations' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'stock_movements' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'users' }),
      rawSql({
        id: 'security.restrict_supabase_data_api',
        label: 'Restrict application tables to the NestJS API',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [
          {
            description: 'Supabase Data API grants may need to be removed',
            sql: `SELECT ${HAS_DATA_API_GRANTS} AS result`,
          },
        ],
        execute: [
          {
            description: 'Revoke direct Data API access to application data',
            sql: `DO $security$
              DECLARE app_table text;
              BEGIN
                FOREACH app_table IN ARRAY ARRAY[${TABLE_ARRAY}]
                LOOP
                  IF to_regrole('anon') IS NOT NULL THEN
                    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', app_table);
                  END IF;

                  IF to_regrole('authenticated') IS NOT NULL THEN
                    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', app_table);
                  END IF;
                END LOOP;

                IF to_regrole('anon') IS NOT NULL THEN
                  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM anon';
                  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon';
                END IF;

                IF to_regrole('authenticated') IS NOT NULL THEN
                  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM authenticated';
                  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM authenticated';
                END IF;
              END
              $security$`,
          },
        ],
        postcheck: [
          {
            description: 'Verify direct Data API grants were removed',
            sql: `SELECT NOT ${HAS_DATA_API_GRANTS} AS result`,
          },
        ],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
