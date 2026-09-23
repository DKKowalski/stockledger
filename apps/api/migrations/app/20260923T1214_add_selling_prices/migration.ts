#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/7bb8a0ed60364a679593978242cb0aa1f27f9b3f55cf32b5511df887efcd4981/contract';
import endContract from '../../snapshots/7bb8a0ed60364a679593978242cb0aa1f27f9b3f55cf32b5511df887efcd4981/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/de2cdacbde8b0ef378d3f7574ab9e1f6338e1db8ca9edc62fc56e3fab22da24d/contract';
import startContract from '../../snapshots/de2cdacbde8b0ef378d3f7574ab9e1f6338e1db8ca9edc62fc56e3fab22da24d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'inventory_items',
        column: col('selling_price_cents', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('unit_price_cents', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'inventory_items',
        constraint: 'inventory_item_selling_price_nonnegative_8a843ec1',
        expression: 'selling_price_cents IS NULL OR selling_price_cents >= 0',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movement_sale_price_valid_b98fe941',
        expression: "unit_price_cents IS NULL OR (type = 'sale' AND unit_price_cents >= 0)",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
