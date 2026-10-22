# Phase 4B: exact future stock costs

The user approved preserving exact future costs on 21 October 2026. This is a development/test slice, not a production rollout. Previously completed sales, purchase history and opening stock records are not rewritten. Existing unenrolled items keep their current pricing and average-cost behaviour.

## What works

Items → **Exact stock costs** provides three administrator actions:

- **Verify opening value:** explicitly enroll one item using current quantity, currency, unit, a separately verified total carrying value and record reference. Nonempty stock also needs a current Phase 4A purchase-cost review. The service never multiplies an old rounded cost to invent an opening value. Empty stock starts at zero quantity/value without declaring an unknown purchase cost free.
- **Record a purchase:** record whole units, actual unit purchase cost, receiving place, date and reference. Quantity movement, exact value entry, display average, audit and request completion commit together. A zero acquisition cost needs explicit free-stock confirmation.
- **Correct current value:** record a prospective, documented correction to today's total value, without changing quantities or previously assigned sale costs. A reason is mandatory. A documented write-down to zero does not claim the goods were acquired free. These are valuation corrections, not expense, cash or payment postings; corresponding financial-ledger integration remains outside this development slice.

All three are reviewed before confirmation. Inputs are stored as immutable server requests; localStorage contains only a per-account UUID recovery key. Requests serialize by company/key. Same-key retries return the original result; cancellation creates a tombstone even if the preparation never arrived, fencing late submissions. A committed request can be recovered after gates are switched off; cancellation never reverses it. Stale quantity, item revision, currency, unit or valuation sequence requires cancellation and a fresh review.

The existing development checkout calculates exact sale costs for enrolled items. For a pool of `Q` units worth `V` cents, selling `q` allocates `round-half-up(V*q/Q)` cents. The final sale consumes the remaining value exactly. Grouping can assign an intermediate penny differently; the complete pool always conserves value. Displayed unit cost is rounded for convenience, while stock value uses the exact remaining cents.

Example: buy one unit at GHS 1.00 and two at GHS 1.01. Total value is GHS 3.02. Selling separately assigns costs GHS 1.01, GHS 1.01 and GHS 1.00. Selling together assigns GHS 3.02.

## Scope and safeguards

`EXACT_COSTING_COMPANY_IDS` defaults empty and works only in `development` or `test`. Enabling the company does not enroll its items. Production refuses these writers even if allowlisted. Sale completion and pricing still need their independent gates.

Company locks pin currency/settings; item locks serialize enrollment, purchases, sales, corrections and legacy writers. Exact quantity is reconciled against the existing location-stock/movement ledger; no second mutable stock counter is introduced. Actual quantity is deducted once through original stock movements. Sale quotes privately bind the checkpoint, sequence and value, including changes that leave the rounded average unchanged. Attendant quote payloads contain no pool values or cost totals.

For enrolled items, legacy purchases/sales, transfers, damage, counts, supplier/customer returns and movement deletion are refused before writing. Direct unit/current-cost edits, negative-stock activation and currency changes are also refused. Disabling the flag blocks new exact writes; it does not silently revert enrolled items to legacy costing. Names, selling prices and other valid catalog maintenance remain available. New items/imports are not automatically enrolled.

Grouped returns/refunds, receipt reversals, transfers, loss/count valuation and supplier-return corrections still need compatible paths before a production pilot. Phase 5 must restore original sale allocations rather than use today's costs. Do not enroll an operating business in this bounded slice.

## Schema and compatibility

Migration `20261021T1915_add_prospective_exact_costing` expands the existing schema:

| Change | Classification | Impact and validation |
|---|---|---|
| `inventory_valuation_requests` | Migration required; safe extension while unused | Durable prepare/apply/cancel records. Tenant RLS, company-scoped references, immutable payload grants, terminal states. |
| `inventory_valuation_checkpoints` | Migration required; high risk when enrolled | One immutable verified starting balance per company/item. No backfill or quantity edit. |
| `inventory_valuation_entries` | Migration required; high risk | Immutable sequential receipts, sales and current-value corrections. Nonnegative pools, tenant FKs, restrictive deletion. |
| Nullable `sale_lines.valuation_checkpoint_id` plus conditional cost constraint | Migration required; high risk | Legacy lines stay null and still require `COGS = quantity × integer unit cost`. Exact lines must reference a same-company/item checkpoint. New compatible constraint is added before removing the old constraint. No old financial values are updated. |
| Exact snapshot/CSV value and future sale cost allocation | Behaviour-changing; high risk for enrolled items | Price portions split into homogeneous integer-cost movements so existing profitability arithmetic stays truthful. Counts, revenue and COGS conserve; no duplicate quantity effect. |
| Workspace v4 | Safe extension | Adds requests/checkpoints/entries and checkpoint line references. v1/v2/v3 routes and original fields remain available; v3 excludes the new line field. |

Runtime role can select/insert ledger records but cannot update them. Request UPDATE privilege covers only `status` and `finished_at`; RLS only allows prepared→applied/cancelled. DELETE remains restricted by the existing verified owner workspace-deletion flow. That flow deletes the new dependencies in the correct order, without extending ordinary transaction deletion rights.

Inventory value allocates the company-wide exact pool deterministically over location quantities, using sorted location IDs for remainder cents. Allocation happens before location filtering, so selected-location totals reconcile to the full pool. The private pool map is not returned to attendants. Movement/profitability readers keep their established price×quantity and cost×quantity arithmetic. Previously missing historical costs remain missing.

## Deployment and recovery

1. Rehearse the populated upgrade and API suite on disposable PostgreSQL. Inspect operations/grants/RLS and constraint order; ensure old financial checks remain enforced.
2. Back up and verify the approved development/staging database. Deploy the schema expansion first with writer gates empty, using bounded lock/statement timeouts and a maintenance retry if locks are unavailable. The constraint expansion can briefly lock `sale_lines`; measure real staging table size and concurrent transactions before scheduling production.
3. Deploy compatible API/readers/exports, then web. Keep all gates empty until the selected item has a reconciled, independently verified opening value. The ORM uses emitted contract metadata; zero downtime across old/new API binaries has not been established. For staging, pause admission of new writes, drain existing transactions, apply the expansion, start the matching API and check readiness before reopening writes. Clients keep pending request keys through that interval. Measure and rehearse this maintenance interval; do not assume a rolling deployment is safe.
4. Enable only a synthetic development company, then explicitly enroll one selected item. Check stock/value/COGS conservation, duplicate request rates, stale/conflicting requests, pool reconciliation failures and latency while transactions run.
5. Production migration, activation and deployment require explicit approval after staging rehearsal and completion of missing correction/return workflows.

A verified full local database backup was taken immediately before the development migration; private path is recorded by `/tmp/stockledger-exact-costing-backup`. Before/after hashes cover all existing business tables (the new nullable field is excluded when comparing old sale lines). All existing rows matched. No seed/reset/reconciliation of existing records was performed.

Rollback means stop new exact writes and keep compatible readers, protections and original allocations. Keep committed requests and ledger records. Correct forward using documented current-period records once the compatible correction exists. Do not drop the new tables, revert to a legacy binary or restore an entire database merely to remove this feature. Unenrolled items continue their existing workflow.

## Endpoints

All routes use existing authentication. Cost routes require an active administrator:

| Route | Purpose |
|---|---|
| `GET /inventory/exact-costing` | Development availability and whether enrolled items exist |
| `GET /inventory/items/:id/exact-costing` | Consistent current quantity/value, checkpoint and cost-review state |
| `POST /inventory/exact-costing/requests` | Prepare `{ requestKey, input }`; strict discriminated checkpoint/receipt/correction input |
| `GET /inventory/exact-costing/requests/:key` | Recover that administrator's request |
| `POST /inventory/exact-costing/requests/:key/apply` | Transactionally apply once or recover a terminal result |
| `POST /inventory/exact-costing/requests/:key/cancel` | Cancel/fence an uncommitted request; return committed result unchanged |
| `GET /settings/exports/workspace-v4` | Consistent complete archive including exact-cost records |

Existing sale quote/completion endpoints and idempotency contracts remain unchanged. Exact costs are only assigned inside the existing development checkout after explicit enrollment.

The subsequent [returns and stock-operation stage](returns-stock-development.md) now supplies the dedicated compatible workflows that were unavailable in Phase 4B. Legacy enrolled-item writers remain blocked; use the separately gated new routes. The complete archive is now v5, with v4 still available.
