#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/bdbef2d536c803599814fe887d62fca6e280b49564f93bcc6154e9622a8bf31e/contract';
import endContract from '../../snapshots/bdbef2d536c803599814fe887d62fca6e280b49564f93bcc6154e9622a8bf31e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/df03163d99e1f7db874132120495d01cb9a4f6d45a933b32c23a7d2038e9228b/contract';
import startContract from '../../snapshots/df03163d99e1f7db874132120495d01cb9a4f6d45a933b32c23a7d2038e9228b/contract.json' with { type: 'json' };
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
import postgres from '@prisma/orm-postgres/runtime';

const COMPANY_ID = '31000000-0000-4000-8000-000000000001';
const WAREHOUSE_ID = '32000000-0000-4000-8000-000000000001';
const SHOP_ID = '32000000-0000-4000-8000-000000000002';
const BACKFILL_AT = '2026-09-22T15:00:00.000Z';

const { sql, contract } = postgres<End>({ contractJson: endContract });

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'inventory_items',
        constraint: 'inventory_items_sku_key',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'users',
        constraint: 'users_role_check_1e1cae07',
      }),
      this.createTable({
        schema: 'public',
        table: 'companies',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(120)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 120 } },
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
        table: 'location_stocks',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('item_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('location_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('opening_stock', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('location_stock_opening_nonnegative_8908d81c', 'opening_stock >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'locations',
        columns: [
          col('company_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'character varying(120)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 120 } },
          }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('locations_type_check_fd72d584', "\"type\" IN ('warehouse', 'shop')"),
        ],
      }),
      rawSql({
        id: 'data.seed_company_locations',
        label: 'Create the demo company and move opening stock to the main warehouse',
        operationClass: 'data',
        target: { id: 'postgres' },
        precheck: [{
          description: 'Demo company or warehouse opening stock is not in place yet',
          sql: `SELECT NOT (
            EXISTS (SELECT 1 FROM "public"."companies" WHERE "id" = $1::uuid)
            AND EXISTS (SELECT 1 FROM "public"."locations" WHERE "id" = $2::uuid)
            AND EXISTS (SELECT 1 FROM "public"."locations" WHERE "id" = $3::uuid)
            AND NOT EXISTS (
              SELECT 1 FROM "public"."inventory_items" AS item
              WHERE NOT EXISTS (
                SELECT 1 FROM "public"."location_stocks" AS stock
                WHERE stock."item_id" = item."id" AND stock."location_id" = $2::uuid
              )
            )
          ) AS ok`,
          params: [COMPANY_ID, WAREHOUSE_ID, SHOP_ID],
        }],
        execute: [
          {
            description: 'Insert the demo company',
            sql: `INSERT INTO "public"."companies" ("id", "name", "created_at", "updated_at")
              VALUES ($1::uuid, 'StockLedger Demo', now(), now())
              ON CONFLICT ("id") DO NOTHING`,
            params: [COMPANY_ID],
          },
          {
            description: 'Insert the main warehouse and main shop',
            sql: `INSERT INTO "public"."locations" ("id", "company_id", "name", "type", "created_at", "updated_at")
              VALUES
                ($1::uuid, $3::uuid, 'Main warehouse', 'warehouse', now(), now()),
                ($2::uuid, $3::uuid, 'Main shop', 'shop', now(), now())
              ON CONFLICT ("id") DO NOTHING`,
            params: [WAREHOUSE_ID, SHOP_ID, COMPANY_ID],
          },
          {
            description: 'Copy each item opening balance onto the main warehouse',
            sql: `INSERT INTO "public"."location_stocks" ("id", "location_id", "item_id", "opening_stock", "created_at", "updated_at")
              SELECT gen_random_uuid(), $1::uuid, item."id", item."opening_stock", now(), now()
              FROM "public"."inventory_items" AS item
              WHERE NOT EXISTS (
                SELECT 1 FROM "public"."location_stocks" AS stock
                WHERE stock."item_id" = item."id" AND stock."location_id" = $1::uuid
              )`,
            params: [WAREHOUSE_ID],
          },
        ],
        postcheck: [{
          description: 'Demo company, both places, and warehouse opening balances exist',
          sql: `SELECT (
            EXISTS (SELECT 1 FROM "public"."companies" WHERE "id" = $1::uuid)
            AND EXISTS (SELECT 1 FROM "public"."locations" WHERE "id" = $2::uuid)
            AND EXISTS (SELECT 1 FROM "public"."locations" WHERE "id" = $3::uuid)
            AND NOT EXISTS (
              SELECT 1 FROM "public"."inventory_items" AS item
              WHERE NOT EXISTS (
                SELECT 1 FROM "public"."location_stocks" AS stock
                WHERE stock."item_id" = item."id" AND stock."location_id" = $2::uuid
              )
            )
          ) AS ok`,
          params: [COMPANY_ID, WAREHOUSE_ID, SHOP_ID],
        }],
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'inventory_items',
        constraint: 'inventory_item_opening_stock_nonnegative_8908d81c',
      }),
      this.dropColumn({ schema: 'public', table: 'inventory_items', column: 'opening_stock' }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('destination_location_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('location_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'inventory_items',
        column: col('company_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.dataTransform(contract, 'backfill-inventory_items-company_id', {
        check: () => sql.public.inventory_items.select('id').where((fields, fns) => fns.eq(fields.company_id, null)).limit(1),
        run: () => sql.public.inventory_items.update({ company_id: COMPANY_ID, updated_at: BACKFILL_AT }).where((fields, fns) => fns.eq(fields.company_id, null)),
      }),
      this.setNotNull({ schema: 'public', table: 'inventory_items', column: 'company_id' }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('location_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.dataTransform(contract, 'backfill-stock_movements-location_id', {
        check: () => sql.public.stock_movements.select('id').where((fields, fns) => fns.eq(fields.location_id, null)).limit(1),
        run: () => sql.public.stock_movements.update({ location_id: WAREHOUSE_ID }).where((fields, fns) => fns.eq(fields.location_id, null)),
      }),
      this.setNotNull({ schema: 'public', table: 'stock_movements', column: 'location_id' }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('company_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.dataTransform(contract, 'backfill-users-company_id', {
        check: () => sql.public.users.select('id').where((fields, fns) => fns.eq(fields.company_id, null)).limit(1),
        run: () => sql.public.users.update({ company_id: COMPANY_ID, updated_at: BACKFILL_AT }).where((fields, fns) => fns.eq(fields.company_id, null)),
      }),
      this.setNotNull({ schema: 'public', table: 'users', column: 'company_id' }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_items',
        constraint: 'inventory_items_company_id_sku_key',
        columns: ['company_id', 'sku'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'location_stocks',
        constraint: 'location_stocks_location_id_item_id_key',
        columns: ['location_id', 'item_id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'locations',
        constraint: 'locations_company_id_name_key',
        columns: ['company_id', 'name'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movement_destination_differs_e3316603',
        expression: 'destination_location_id IS NULL OR destination_location_id <> location_id',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'users',
        constraint: 'user_shop_attendant_has_location_60fbae6d',
        expression: "role <> 'shop_attendant' OR location_id IS NOT NULL",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'users',
        constraint: 'users_role_check_e70a9d4c',
        expression: "\"role\" IN ('administrator', 'inventory_manager', 'shop_attendant')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'inventory_items',
        index: 'inventory_items_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'location_stocks',
        index: 'location_stocks_item_id_idx_4b8ce5fb',
        columns: ['item_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'location_stocks',
        index: 'location_stocks_location_id_idx_6316b129',
        columns: ['location_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'locations',
        index: 'locations_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_destination_location_id_idx_eca4a338',
        columns: ['destination_location_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_location_id_idx_6316b129',
        columns: ['location_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'users',
        index: 'users_company_id_idx_1303a718',
        columns: ['company_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'users',
        index: 'users_location_id_idx_6316b129',
        columns: ['location_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'inventory_items',
        foreignKey: {
          name: 'inventory_items_company_id_fkey',
          columns: ['company_id'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'location_stocks',
        foreignKey: {
          name: 'location_stocks_location_id_fkey',
          columns: ['location_id'],
          references: { schema: 'public', table: 'locations', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'location_stocks',
        foreignKey: {
          name: 'location_stocks_item_id_fkey',
          columns: ['item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'locations',
        foreignKey: {
          name: 'locations_company_id_fkey',
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
          name: 'stock_movements_destination_location_id_fkey',
          columns: ['destination_location_id'],
          references: { schema: 'public', table: 'locations', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'stock_movements_location_id_fkey',
          columns: ['location_id'],
          references: { schema: 'public', table: 'locations', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'users',
        foreignKey: {
          name: 'users_company_id_fkey',
          columns: ['company_id'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'users',
        foreignKey: {
          name: 'users_location_id_fkey',
          columns: ['location_id'],
          references: { schema: 'public', table: 'locations', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
