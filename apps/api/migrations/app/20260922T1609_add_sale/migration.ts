#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/3cdf88b5b2bb9a96def5cc8844b291e6bf2f22cb1dd3ace87c77c9a5d1eacd1a/contract';
import endContract from '../../snapshots/3cdf88b5b2bb9a96def5cc8844b291e6bf2f22cb1dd3ace87c77c9a5d1eacd1a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/bdbef2d536c803599814fe887d62fca6e280b49564f93bcc6154e9622a8bf31e/contract';
import startContract from '../../snapshots/bdbef2d536c803599814fe887d62fca6e280b49564f93bcc6154e9622a8bf31e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movements_type_check_9c78a0ca',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'stock_movements',
        constraint: 'stock_movements_type_check_6b3e5aa1',
        expression:
          "\"type\" IN ('purchase', 'transfer', 'return_in', 'return_out', 'damage', 'sale')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
