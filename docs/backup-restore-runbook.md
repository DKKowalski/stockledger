# Database backup and recovery runbook

Status: **production readiness not verified**. This is an owner-operated procedure; implementation work has no production access. A JSON workspace export is useful for investigation but has no supported database import path and is not a replacement for a PostgreSQL backup. Render automatically runs migrations during deployment: complete the release checklist before triggering a deploy.

## Owner readiness record — complete before business-critical deployment

| Required evidence | Owner entry |
| --- | --- |
| Named recovery lead, deputy and incident contact | NOT VERIFIED |
| Database provider/project/region, plan, PostgreSQL major version | NOT VERIFIED |
| Actual automated snapshot/PITR availability, retention, oldest recoverable point | NOT VERIFIED |
| Approved recovery point objective (proposed: ≤24 hours), recovery time objective (proposed: ≤4 hours) | NOT APPROVED |
| Backup frequency and retention (proposed: nightly, 7 daily + 4 weekly), encrypted off-provider storage and storage owner | NOT APPROVED |
| Backup job identity, least-privilege access, encryption key custodian and tested key recovery | NOT VERIFIED |
| Alert recipient, backup age/failure alerts, incident acknowledgement and escalation | NOT VERIFIED |
| Last restore evidence, source backup time, measured restore/reconciliation time and signed acceptance | NOT VERIFIED |
| Runtime and migration identities separated; runtime is not superuser/BYPASSRLS | NOT VERIFIED |

The proposed targets are reversible planning defaults, not promises. Confirm the provider's actual plan and retention in its console. An ephemeral scheduled backup task on existing approved infrastructure is sufficient; do not add an always-on service or keepalive ping. An independent backup failure/age alert should run with the scheduled task. Check readiness only at a frequency approved for the expected API sleep behaviour; send errors to a named recipient and test delivery with a labelled test incident. Do not treat an optional Sentry setting as proof someone receives alerts.

## Take and retain a backup

1. Use a trusted operator machine or approved ephemeral job with matching/newer PostgreSQL client tools. Keep host, database, user and password in a protected PostgreSQL service/password file, secret manager or environment injected by the approved platform. Never print a connection URL, put credentials in a command argument/history, or commit a dump. Use `umask 077`; do not enable shell tracing.
2. Record the source database identity, backup start/end in UTC, deployed application commit and applied migration contract/head. Export provider roles/config separately through an approved administrator process: `pg_dump` does not include cluster globals. Keep password-bearing role exports encrypted and outside the repository. Record required extensions and the migration-created `stockledger_app` group.
3. With `PGSERVICE` selecting the approved source, run `pg_dump --format=custom --no-owner --file=stockledger.dump`. Do **not** use `--enable-row-security`: the backup identity must be able to read all tenants. An application runtime login restricted by RLS is not an appropriate backup identity. Verify the exit code and run `pg_restore --list stockledger.dump` without displaying customer data.
4. Encrypt before uploading to approved off-provider storage (for example the organisation's approved encryption tooling), record a checksum of the encrypted object, backup timestamps, byte size, storage object/version and retention deadline. Verify upload and decryptability under the recovery custodian's identity. Avoid unencrypted intermediate files on shared disks; delete the temporary plaintext when verified according to local storage policy. Schedule and test this process; this repository does not install a backup job.
5. Alert on failed/empty upload, failed encryption, or backup age beyond the approved RPO. The lead must acknowledge the test alert and record evidence. A successful dump without an accessible encryption key or tested restore is insufficient.

## Restore into a separate database first

1. Declare an incident and stop automatic deployments. Record the latest good backup/PITR point and any transactions after that point that may be lost. Keep the source database intact for investigation. Do not overwrite the only copy.
2. Provision an empty isolated database with sufficient space, matching PostgreSQL major version/extensions and compatible migration/application versions. Confirm its identity independently before restoration. Set `PGSERVICE` to this **destination**, never the source. Restore required roles (particularly the non-login `stockledger_app` group) through the administrator process before restoring grants. Do not restore superuser/login attributes blindly.
3. Verify encrypted object checksum, decrypt on protected storage and run `pg_restore --exit-on-error --single-transaction --no-owner --dbname="$PGDATABASE" stockledger.dump`. `PGDATABASE` is only the destination database name; host/user/password come from the protected service configuration. Use a new empty destination and do not add `--clean` against an existing business database. Confirm a zero exit code; partial restore means discard this destination and retry from a clean one.
4. Run `ANALYZE`. Verify row counts/checksums per tenant table, applied migration head, RLS flags/policies, indexes/constraints and required functions. Verify table grants and execute a restricted-role check: without company context no tenant rows; with company A context only A; foreign IDs return no rows. Restore the restricted runtime login/membership using the existing `docs/production-database-role.sql` process and the approved secret store. Do not run the API as the restore owner.
5. With outbound email/payment actions disabled and writes paused, start the application version corresponding to the backup in the isolated environment. Compare stock quantities by item/place, movement counts/types, original sale totals and null historical costs/tenders, returns, latest valuation checkpoint/entry balances, Profit and Finance totals for representative complete periods, expenses/budgets and tenant counts against the pre-backup reconciliation record. Perform owner/staff login, read-only reports and role checks. Use synthetic records for any write smoke test. Do not use a new costing policy to make totals agree.
6. Record source point, checksum, table counts, reconciliation differences (must be resolved), start/end times, measured RPO/RTO, participants and pass/fail acceptance. Only the owner/recovery lead authorizes cutover. Freeze writes, capture a final backup/PITR point if available, rotate destination runtime secrets, update the application connection through the approved platform and reopen writes after smoke checks. Preserve pending idempotency keys and check uncertain sales before taking them again. Notify staff of the exact recovery cutoff.

## Deploy, locking and rollback readiness

- Before the automatic migration deploy: confirm a recent recoverable backup, documented app/database compatibility, additive migration review, available storage, and a tested rollback/cutover plan. If the migration needs stronger locks, arrange a maintenance window, stop/drain API writers and allow in-flight transactions to finish with a bounded timeout. Do not release a second writer while draining.
- Set migration-session `lock_timeout` and `statement_timeout` to reviewed bounded values (for example 5 seconds and 2 minutes, adjusted after rehearsal). If locks/timeouts fail, stop the release and inspect; do not leave repeated unbounded retries. Confirm the migration runner's transaction semantics and journal state before retrying.
- Rehearse on a populated isolated restore. Hold an ordinary writer lock, verify DDL times out, roll back, drain/release the writer, then retry and check schema/data invariants. Record actual duration and table size; synthetic success is not evidence of production timing.
- Prefer rolling back application code while leaving compatible additive columns/tables intact. Do not blindly run a down migration, delete migration history, or delete tender/sale records. For destructive/corrupt changes, restore/PITR to a **new** database and use the cutover procedure; disclose any data loss after the recovery point.

## Reproducible local rehearsal

Build the API, then run `LOCAL_POSTGRES_CONTAINER=<local-container-publishing-5434> node apps/api/test/rehearse-restore.mjs`. It ignores caller database URLs, uses only `127.0.0.1:5434`, provisions two random `stockledger_test_...` databases, migrates and seeds synthetic data, creates an in-memory custom dump, restores it, compares every RLS tenant table and ledger/finance aggregates, checks restricted-role reads, and tests a 1-second DDL lock timeout plus transactional rollback. Both databases are dropped in `finally`. Docker supplies PostgreSQL client tools. No production plan, backup schedule, off-provider encryption/upload, alert delivery or real recovery target is verified by this rehearsal.

Reference: [PostgreSQL SQL dumps and restore](https://www.postgresql.org/docs/17/backup-dump.html), [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
