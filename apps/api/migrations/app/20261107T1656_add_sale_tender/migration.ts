#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b85e5d8a6216c5ec341fbc2b59e28374598f4962b6963c31acf6254477db53ca/contract';
import endContract from '../../snapshots/b85e5d8a6216c5ec341fbc2b59e28374598f4962b6963c31acf6254477db53ca/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/da8b67a64c6f11c18e09a8670d0b3755bd08da63a0764b5e848b416e77b2e62e/contract';
import startContract from '../../snapshots/da8b67a64c6f11c18e09a8670d0b3755bd08da63a0764b5e848b416e77b2e62e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'sales',
        column: col('amount_received_cents', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sales',
        column: col('tender_method', 'character varying(10)', {
          codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 10 } },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'sales',
        constraint: 'sale_tender_valid_7cb54514',
        expression:
          "(tender_method IS NULL AND amount_received_cents IS NULL) OR (tender_method IS NOT NULL AND amount_received_cents IS NOT NULL AND ((tender_method = 'unpaid' AND amount_received_cents = 0) OR (tender_method = 'cash' AND amount_received_cents >= total_cents) OR (tender_method = 'momo' AND amount_received_cents = total_cents)))",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
