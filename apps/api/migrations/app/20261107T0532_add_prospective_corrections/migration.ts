#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0a5e3f164465a966bac6eb041f64856deb7b954fac9c6b6640394913ac060faf/contract';
import startContract from '../../snapshots/0a5e3f164465a966bac6eb041f64856deb7b954fac9c6b6640394913ac060faf/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/da8b67a64c6f11c18e09a8670d0b3755bd08da63a0764b5e848b416e77b2e62e/contract';
import endContract from '../../snapshots/da8b67a64c6f11c18e09a8670d0b3755bd08da63a0764b5e848b416e77b2e62e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      rawSql({
        id: 'prospective_corrections.bounded_locks', label: 'Bound correction schema lock waits',
        operationClass: 'data', target: { id: 'postgres' },
        precheck: [{ description: 'Migration session needs bounded waits', sql: "SELECT current_setting('lock_timeout') <> '5s' OR current_setting('statement_timeout') <> '1min' AS result" }],
        execute: [{ description: 'Limit lock waits and statement duration', sql: "SELECT set_config('lock_timeout','5s',false), set_config('statement_timeout','1min',false)" }],
        postcheck: [{ description: 'Migration waits are bounded', sql: "SELECT current_setting('lock_timeout') = '5s' AND current_setting('statement_timeout') = '1min' AS result" }],
      }),
      this.addColumn({
        schema: 'public',
        table: 'inventory_items',
        column: col('pooled_value_cents', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sale_lines',
        column: col('prospective_cost', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('corrects_movement_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'stock_movements',
        column: col('cost_total_cents', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'inventory_items',
        constraint: 'inventory_item_pooled_value_nonnegative_4fdb048f',
        expression: 'pooled_value_cents IS NULL OR pooled_value_cents >= 0',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'sale_lines',
        constraint: 'sale_line_amounts_valid_72ec89c8',
        expression:
          'position >= 0 AND quantity > 0 AND retail_price_cents >= 0 AND unit_cost_cents >= 0 AND gross_sales_cents::bigint = quantity::bigint * retail_price_cents AND cogs_cents >= 0 AND (valuation_checkpoint_id IS NOT NULL OR prospective_cost OR cogs_cents::bigint = quantity::bigint * unit_cost_cents) AND total_cents >= 0 AND automatic_discount_cents >= 0 AND gross_sales_cents::bigint - automatic_discount_cents = total_cents',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movement_correction_valid_9a8aae7f',
        expression:
          "corrects_movement_id IS NULL OR (type = 'return_out' AND unit_price_cents IS NULL AND unit_cost_cents IS NOT NULL AND corrects_movement_id <> id)",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movement_total_cost_valid_e94aa0d8',
        expression:
          'cost_total_cents IS NULL OR (cost_total_cents >= 0 AND unit_cost_cents IS NOT NULL)',
      }),
      this.addUnique({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movements_company_id_corrects_movement_id_key',
        columns: ['company_id', 'corrects_movement_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stock_movements',
        foreignKey: {
          name: 'stock_movements_company_id_corrects_movement_id_fkey',
          columns: ['company_id', 'corrects_movement_id'],
          references: { schema: 'public', table: 'stock_movements', columns: ['company_id', 'id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'sale_lines',
        constraint: 'sale_line_amounts_valid_491d1ffe',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
