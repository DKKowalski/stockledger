#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/b85e5d8a6216c5ec341fbc2b59e28374598f4962b6963c31acf6254477db53ca/contract';
import startContract from '../../snapshots/b85e5d8a6216c5ec341fbc2b59e28374598f4962b6963c31acf6254477db53ca/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c5d7a158871ec529bd305865c9f0ff7543ce959baffc4d4cc2dcfa5e323a4ef3/contract';
import endContract from '../../snapshots/c5d7a158871ec529bd305865c9f0ff7543ce959baffc4d4cc2dcfa5e323a4ef3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'stock_movements',
        index: 'stock_movements_company_id_movement_date_idx_b0e8bdf3',
        columns: ['company_id', 'movement_date'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
