# Phase 4A: current-cost review in development

Date: 21 October 2026. This is the first bounded step of Phase 4. It does not complete prospective valuation corrections, mixed-price returns or production readiness.

## Assessment and bounded plan

The existing item requires a nonnegative integer `unitCostCents`, defaulting to zero. Purchases keep the existing company-wide rounded moving average; administrative item edits can also change current cost. Sale and return snapshots retain their original costs, including missing values. Therefore a zero item cost cannot establish that stock was free, and a populated historical snapshot cannot establish verified source records. No historical cost may be inferred or backfilled.

The existing tenant-scoped `AuditEvent` table already stores immutable-by-API activity metadata, actor, entity and timestamp, and is included in complete workspace exports and owner-confirmed workspace deletion. Reuse it for an append-only `inventory.cost_reviewed` event. No schema changes or migration are needed. This is an administrator attestation about the current stored cost, not automatic verification of invoices and not a correction to historical or current valuation.

Add administrator-only development/test endpoints and an optional **Review purchase costs** panel, gated by `COST_READINESS_COMPANY_IDS`, default empty. Positive current costs require purchase/opening-record evidence and a reference. Zero requires an explicit free-acquisition declaration and reference. An unreviewed zero remains unconfirmed; never silently treat it as a free acquisition. Confirmation carries the exact current currency, unit, cost and item revision that the administrator reviewed.

The server pins the company currency with a shared company-row lock, then locks the existing item and rechecks those values before writing one audit event. A concurrent purchase, currency change or item edit makes the submitted review stale and requires a reload. Stored reviews are current only while their currency/unit/cost/item revision still match. This conservatively requests another review after any item edit, including a non-cost edit. Identical retries under the same item lock return the existing matching review rather than creating another event. Different evidence appends a new review. Tenant and role checks exclude attendants/managers from reading cost-review details or writing confirmations.

## Classification, rollout and recovery

| Change | Classification | Impact and validation |
|---|---|---|
| New administrator endpoints, optional UI and audit action | Safe extension; no migration | No item, stock, price, financial snapshot or profit calculation changes. Review default-off parity, owner-only access, zero/positive evidence, export compatibility and no business-row changes. |
| Item locking and revision checks around audit insertion | High risk because it shares the inventory transaction boundary | Test stale revisions, cost/unit changes, concurrent reviews, purchase/review ordering, tenant isolation and rollback. The lock performs only short reads and an audit insert. Existing stock writers keep their existing implementation. |
| Review lifecycle displayed separately from profit | Behaviour-changing only for enabled development administrators | Clear that confirmation describes the current cost only. No historical sale is relabeled, no profit recalculated, and checkout policy is unchanged. Test desktop/mobile and the real local test workspace. |

Develop and validate using disposable localhost resources first. Apply no migration. Deploy a compatible API before the optional client and leave the allowlist empty. Only the existing local Hybrid Pricing Test company is eligible for initial manual review; no production/staging changes are authorized. Production refuses review writes even if the flag is mistakenly configured.

Recovery removes the allowlist or rolls back the optional UI/endpoints, retaining audit events. Normal sales and stock operations remain compatible. No database restore, event deletion, backfill or unit conversion is part of rollback.

## Remaining Phase 4 decisions

A later step must explicitly settle cent-rounding residuals, original-cost return valuation, supplier returns/cancellations, audited cost corrections and verified opening checkpoints across every stock writer. This step does not select a new valuation policy, claim complete cost provenance or change the existing moving-average engine. Phase 5 must add original-allocation hybrid returns/reversals before a production selling pilot.

## Validation

See [Phase 4A test evidence](cost-readiness-test-report.md) for unit, PostgreSQL/HTTP, desktop/mobile browser and actual TesterArmy results, populated-record preservation and resource cleanup. API routes are `GET /inventory/cost-review`, `GET /inventory/items/:id/cost-review`, and `POST /inventory/items/:id/cost-review`. The development allowlist is enabled locally only for Hybrid Pricing Test.
