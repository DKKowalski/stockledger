#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/34bcef8ebc6d466edf2f3fa85cba4bd89f288e8e3f3246002a450211536d2918/contract';
import endContract from '../../snapshots/34bcef8ebc6d466edf2f3fa85cba4bd89f288e8e3f3246002a450211536d2918/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/76d4a739c3bb266665c8a9c4d6635e52602203a01c99bd7dd841d377f03a912a/contract';
import startContract from '../../snapshots/76d4a739c3bb266665c8a9c4d6635e52602203a01c99bd7dd841d377f03a912a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('address', 'character varying(300)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 300 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('contact_email', 'character varying(255)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('currency', 'character varying(3)', {
          notNull: true,
          default: lit('GHS'),
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('date_format', 'character varying(24)', {
          notNull: true,
          default: lit('day_month_year'),
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 24 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('phone', 'character varying(40)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 40 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'companies',
        column: col('time_zone', 'character varying(64)', {
          notNull: true,
          default: lit('Africa/Accra'),
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
