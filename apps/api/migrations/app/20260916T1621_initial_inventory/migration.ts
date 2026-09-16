#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/f6ae5956359cce0fd99f5e4b895406314e7098a608850ce81261424a6f4acbe2/contract';
import endContract from '../../snapshots/f6ae5956359cce0fd99f5e4b895406314e7098a608850ce81261424a6f4acbe2/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'inventory_items',
        columns: [
          col('category', 'character varying(80)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 80 } },
          }),
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
          col('opening_stock', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('reorder_level', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('sku', 'character varying(40)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 40 } },
          }),
          col('unit', 'character varying(20)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('unit_cost_cents', 'int4', {
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
          checkExpression(
            'inventory_item_opening_stock_nonnegative_8908d81c',
            'opening_stock >= 0',
          ),
          checkExpression(
            'inventory_item_reorder_level_nonnegative_e896746f',
            'reorder_level >= 0',
          ),
          checkExpression('inventory_item_unit_cost_nonnegative_0e3258af', 'unit_cost_cents >= 0'),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'stock_movements',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('item_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('movement_date', 'date', {
            notNull: true,
            codecRef: { codecId: 'pg/date-string@1' },
          }),
          col('note', 'character varying(500)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 500 } },
          }),
          col('quantity', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('reference', 'character varying(80)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 80 } },
          }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('stock_movement_quantity_positive_4402679f', 'quantity > 0'),
          checkExpression(
            'stock_movements_type_check_9c78a0ca',
            "\"type\" IN ('purchase', 'transfer', 'return_in', 'return_out', 'damage')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'inventory_items',
        constraint: 'inventory_items_sku_key',
        columns: ['sku'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_item_id_idx_4b8ce5fb',
        columns: ['item_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_movement_date_idx_eb014515',
        columns: ['movement_date'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'stock_movements_item_id_fkey',
          columns: ['item_id'],
          references: { schema: 'public', table: 'inventory_items', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
