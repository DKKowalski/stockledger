#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/07c01bde97422dd89f62ff221bf146cbfc0e62da3f0043d6dc7e756d2bded2ea/contract';
import startContract from '../../snapshots/07c01bde97422dd89f62ff221bf146cbfc0e62da3f0043d6dc7e756d2bded2ea/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5ccb1739876988e11fc0dc2dfeb65052a75dbaebb1d4f138d285b2c9f8d8ecb6/contract';
import endContract from '../../snapshots/5ccb1739876988e11fc0dc2dfeb65052a75dbaebb1d4f138d285b2c9f8d8ecb6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('hybrid_pricing_enabled', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
