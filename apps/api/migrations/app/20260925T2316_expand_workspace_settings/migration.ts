#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/09f8f57c7156d74b37b201f847fb5ff4fcf768b22dad904b7cc8c3b7800b0b2e/contract';
import startContract from '../../snapshots/09f8f57c7156d74b37b201f847fb5ff4fcf768b22dad904b7cc8c3b7800b0b2e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e4c9055158de2e726dde6419a7ba5ab6287a75eb7c2d024f9b1b97c10bad93e6/contract';
import endContract from '../../snapshots/e4c9055158de2e726dde6419a7ba5ab6287a75eb7c2d024f9b1b97c10bad93e6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('allow_negative_stock', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('default_location_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('default_reorder_level', 'int4', {
          notNull: true,
          default: lit(10),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('default_unit', 'character varying(20)', {
          notNull: true,
          default: lit('pcs'),
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('item_term', 'character varying(20)', {
          notNull: true,
          default: lit('item'),
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('next_sku_number', 'int4', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('require_adjustment_reason', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('require_purchase_source', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('shop_term', 'character varying(20)', {
          notNull: true,
          default: lit('shop'),
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('sku_prefix', 'character varying(12)', {
          notNull: true,
          default: lit('SKU'),
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 12 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('warehouse_term', 'character varying(20)', {
          notNull: true,
          default: lit('warehouse'),
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
