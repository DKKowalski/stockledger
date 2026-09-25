#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/09f8f57c7156d74b37b201f847fb5ff4fcf768b22dad904b7cc8c3b7800b0b2e/contract';
import endContract from '../../snapshots/09f8f57c7156d74b37b201f847fb5ff4fcf768b22dad904b7cc8c3b7800b0b2e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/6a950c83571a1a94da9115cc7dc0d3d171f50e243f746584bb67aaf8bcf4f410/contract';
import startContract from '../../snapshots/6a950c83571a1a94da9115cc7dc0d3d171f50e243f746584bb67aaf8bcf4f410/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createRlsPolicy({
        schema: 'public',
        table: 'audit_events',
        policy: {
          naming: { kind: 'wire', prefix: 'audit_event_workspace_delete', hash: '336681c2' },
          tableName: 'audit_events',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['stockledger_app'],
          using:
            "company_id = nullif(current_setting('app.current_company_id', true), '')::uuid AND current_setting('app.workspace_deletion_company_id', true) = company_id::text",
          permissive: true,
        },
      }),
      rawSql({
        id: 'settings.grant_audit_delete_for_workspace_deletion',
        label: 'Grant tenant-scoped audit deletion to the application role',
        operationClass: 'additive',
        target: { id: 'postgres' },
        precheck: [{
          description: 'Application role cannot delete audit rows',
          sql: `SELECT NOT has_table_privilege('stockledger_app', 'public.audit_events', 'DELETE') AS result`,
        }],
        execute: [{
          description: 'Grant delete while the RLS policy keeps audit history append-only outside workspace deletion',
          sql: `GRANT DELETE ON TABLE public.audit_events TO stockledger_app`,
        }],
        postcheck: [{
          description: 'Application role has audit delete privilege',
          sql: `SELECT has_table_privilege('stockledger_app', 'public.audit_events', 'DELETE') AS result`,
        }],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
