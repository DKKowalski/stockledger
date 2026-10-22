# Phase 3: durable sale completion in development

This stage follows the approved assessment and preview stage. It adds a development/test-only sale path; production hybrid checkout remains unavailable. Existing retail endpoints, recorded quantities, financial snapshots, reports, and export v1/v2 keep their existing meanings.

## Assessment and design

Stock is derived from opening balances plus `stock_movements`; there is no separately decremented stock counter. Every existing stock writer locks its inventory item. Existing profit sums each sale movement's recorded price and cost. These properties let exact-cent pricing portions become ordinary sale movements without counting stock twice or changing historical records.

Add three append-only, tenant-scoped tables: sale headers, item lines, and pricing components. Components reference existing movements through restrictive company-scoped foreign keys. No existing business table needs a column, backfill, unit conversion, or rewritten financial value. One header owns the unique company/idempotency key and payload hash; successful records and their component movements commit in one transaction. A transaction-scoped advisory lock serializes the same key before deterministic item locks. Failed transactions leave no sale or stock writes. Matching retries return the original sale, including after a quote expires or writes are disabled; changed payloads conflict.

Quotes use a purpose-specific HMAC, ten-minute expiry, actor/shop/currency/date binding, and a fingerprint of current item/rule/cost snapshots. The completion endpoint accepts only the quote and a UUID retry key, recalculates under item locks, and rejects stale or manipulated values. Quotes are not stock reservations. All submitted products must fit stock or nothing commits. New-path companies must already disallow negative stock; this stage never changes that existing setting. Monetary fields use exact integer cents with an explicit 2,147,483,647-cent per-transaction/line/component limit; larger requests fail before writes. Costs snapshot the existing recorded moving-average cost without claiming verified provenance or inventing historical costs.

The single-product development UI uses an origin-wide Web Lock and a retained per-account/shop intent generation to invalidate stale reviews across active or suspended tabs. It requires Web Locks support and browser storage, and fails closed if either is unavailable. It stores its pending key and quote before sending completion, freezes uncertain requests, and reconciles through lookup/retry using that same key. The backend transaction boundary accepts multiple products for atomicity testing; cart UI remains a later phase. Existing retail UI remains the default, including for configured products in an enabled development company; opening development checkout is an explicit action. No payment or receipt issuance is added.

## Classification and safeguards

| Change | Classification | Impact and validation |
|---|---|---|
| New sale tables, indexes, RLS and restricted grants | Migration required; safe extension while disabled | Additive tables only. Check generated operations, populated upgrades from both legacy and preview schema, runtime role isolation, immutable records and workspace-deletion ordering. |
| Atomic completion and durable retry handling | High risk; behaviour-changing only in explicitly enabled development companies | Test concurrent identical/different requests, lost responses, rollback after partial component creation, insufficient stock, same-item races with legacy writers, stale prices/rules/costs, and exact ledger/header totals. |
| Sale lookup, movement grouping metadata, archive v3 | Safe extension; migration-dependent readers | Keep old financial arithmetic and old export formats. Validate no doubled stock/revenue/cost and preserve null legacy snapshots. Reads remain available with the writer disabled. |
| Blocking legacy deletion/return of new grouped movements | Behaviour-changing; high risk, limited to new records | Prevent a partial correction from invalidating a grouped sale. Existing legacy returns/deletion remain unchanged. New-path activation in production requires dedicated original-allocation returns in Phase 5. |
| Optional development UI and pending-request recovery | Safe extension when hidden; high risk when used | Test confirmed/uncertain responses, refresh failure, repeat clicks, reload recovery and desktop/mobile. No production capability or automatic enrollment. |

## Deployment and recovery

No production/staging migration, deployment, or feature activation is authorized by this development stage. `SALE_COMPLETION_COMPANY_IDS` defaults empty; the same company must also be preview-allowlisted, and the application environment must be development/test. Production ignores this writer allowlist. Product preview enrollment and base-unit verification remain required for this experimental path.

Before a future release, rehearse the exact additive migration on an approved representative staging snapshot with bounded database lock/statement timeouts. New foreign keys originate on empty new tables but can still lock referenced tables. Deploy compatible readers/exports/correction protections first with writers off, then the development writer/UI. Existing retail transactions continue through their unchanged path. Never edit applied migrations.

Rollback disables new writes and retains additive tables, completed sales, key lookups, ledger links and compatible readers. Do not drop tables or restore an old database to undo successful sales. Archive v3 uses a repeatable-read snapshot established before tenant context or other reads, so a concurrent sale cannot split its headers, components and movements across export instants. Legacy export isolation remains unchanged.

The minimum rollback release must understand grouped records and protect them from legacy corrections. Production activation must wait for cost readiness, allocation-based returns/reversals, staging reconciliation and explicit production approval.

## API and verification

| Route | Behaviour |
|---|---|
| `GET /inventory/sale-completion` | Reports the attendant's development capability. Does not enroll any product. |
| `POST /inventory/sales/quote` | Accepts a date and item inputs with expected pricing version/retail price; returns a signed ten-minute quote and exact amounts without stock writes. |
| `POST /inventory/sales/complete` | Accepts only `{idempotencyKey, quoteToken}`; commits all header/line/component/stock/audit records together, or none. Matching retries return the existing sale. |
| `GET /inventory/sales/requests/:key` | Authenticated submitting attendant can reconcile a request; `sale: null` does not mean an in-flight request has failed. |
| `GET /inventory/sales/:id` | Administrator or same-shop attendant can read a completed sale with original allocations. Cost fields are excluded for attendants. |
| `GET /settings/exports/workspace-v3` | Administrator's consistent complete archive includes pricing history and all three new sale tables. Existing v1/v2 routes remain available. |

Item UUIDs are normalized before aggregation, lock ordering and expected-price checks. Idempotency UUIDs are normalized before advisory locking. New grouped movements expose optional grouping IDs; legacy stock/profit arithmetic remains based on movement quantities and recorded amounts. Legacy movement lists/CSVs retain component rows; the sale lookup and v3 archive carry transaction grouping. Broader grouped history/reporting UI remains part of the later pilot.

Validation and evidence are recorded in [the Phase 3 test report](sale-completion-test-report.md). The new migration is `20261020T2347_add_durable_development_sales`: 34 additive operations and one runtime-permission grant. No applied migration was edited.

A disposable API process once stopped accepting connections but exceeded a five-second process-exit budget, with no remaining database sessions. The test harness now bounds shutdown and can terminate only its own test child. This does not establish production graceful-drain behaviour: staging must rehearse in-flight transactions, shutdown, migration timing and rollback before any release approval.
