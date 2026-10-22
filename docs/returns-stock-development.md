# Returns, reversals and exact stock operations

21 October 2026. These workflows complete the Phase 4 stock-operation coverage and Phase 5 returns/reversals in development on synthetic localhost data. They are optional and refuse production writes. The user selected disposable local staging; no production or remote staging deployment is authorized.

## User workflows

Under **Movements**, administrators see **Customer returns** when `SALE_RETURNS_COMPANY_IDS` explicitly includes their company in development/test. Choose the original sale, units and condition, enter a reason/reference, then review the original refund amount before confirming. **Reverse remaining sale** includes all unreturned units and leaves the original sale intact. Returning a portion does not reprice the units the customer kept or apply today's discounts. Older ungrouped sources need recorded original price/cost; missing historical costs are never fabricated.

A resellable return restores its original assigned cost to an enrolled item's current pool. A damaged return writes its original-price/cost return and an equal original-cost loss together, adding no sellable quantity or carrying value. Both movements are protected. The refund amount is recorded; **no money is sent and no completed refund payment is claimed**. The MVP has no cash/payment-provider refund ledger. Manual settlement or a separately approved payment integration remains operational rollout work.

Under **Exact stock changes**, administrators and inventory managers use `STOCK_OPERATIONS_COMPANY_IDS` together with exact-cost activation and per-item enrollment:

| Action | Quantity and value treatment |
|---|---|
| Transfer stock | Moves quantity between places; preserves company quantity/value. Movement portions retain an exact allocation of carrying cost. |
| Record damaged stock | Removes pooled value once and records an exact loss, including cent residuals. |
| Record a stock count | Shortages remove pooled exact value. Gains require independently documented unit cost; zero requires explicit free acquisition. A matching count records its observation without changing quantity/value. |
| Return to supplier | Caps units against an original purchase, across previous supplier returns and reversals. Removes current pooled carrying value. Optional supplier credit is separate evidence, not a payment or invented receivable. Transferred stock may be returned from its current place. |
| Reverse an untouched receipt | Appends a full original-cost reversal only while that receipt is the latest valuation event and no later activity depends on it. Later mistakes require a documented prospective correction. The original receipt is never deleted. |

Disabled return availability checks skip sale-history scans. Legacy screens/endpoints keep their current behaviour for unenrolled items. Enrolled items use the dedicated exact workflow; direct historical cost/unit edits and destructive stock corrections remain blocked. New writers require whole units, bounded integer cents, current currency/unit, current item/pool revision and expected stock at the affected place. Transfer previews reject an empty source, insufficient stock and invalid destinations. The form initially selects a place holding stock and clears the destination when the source changes.

## Request and transaction safety

Both panels prepare immutable server requests before explicit confirmation. Browser storage holds only an opaque per-account UUID. Reload or check status recovers the same result; a failed response does not invite a new financial request. Tabs coordinate through Web Locks and storage events. Cancel creates a transaction-locked tombstone even when the original preparation never arrived, so a late request cannot execute. Committed records remain recoverable after gates turn off; cancellation never reverses an applied record.

Actors lock before company settings and sorted item locks. Return source revisions include previous linked returns, including older legacy returns. After locks, source quantities, original allocations, currency, units, dispositions and exact pools are revalidated. A partial/full return cannot exceed what remains. Confirmed records, original sale values and earlier allocated costs are never updated. Source quantities and current stock/value reconcile in the same transaction.

Stock requests reuse the existing immutable valuation-request table, with server-calculated financial previews inside its immutable input JSON. Client-supplied preview fields are rejected. Multiple exact movement portions may belong to one request; all portions and terminal request status commit together. A count or loss cannot create an extra stock effect just because cents need splitting.

## Migration and compatible readers

`20261021T2009_add_original_allocation_returns` adds `sale_return_requests`, `sale_returns` and `sale_return_allocations`, tenant policies, restrictive source references and append-only runtime grants. Request UPDATE permissions cover terminal status/time only. No historical record is backfilled. The new valuation-entry check is added before the old check is removed; existing entry kinds remain valid. An index replaces the old per-request entry uniqueness so one exact operation can have several truthful cost portions, serialized and deduplicated by the durable request.

Existing stock/profit math uses the new truthful movement snapshots. Count-history responses add optional `valueImpactCents` from the exact recorded valuation portions, so a 201-cent shortage displays 201 cents rather than 202 cents from a rounded unit average. Old fields and stored count records remain unchanged; legacy clients keep their existing shape and calculations. Gross profit remains sales minus recorded cost; damaged returns also appear under inventory loss. Valuation corrections and supplier-credit notes do not fabricate expense/cash postings. Workspace archive **v5** includes new return requests, headers and allocations; v1–v4 retain their existing fields. The password/name-verified workspace deletion path removes the new dependencies in order, while ordinary deletion cannot remove return allocations or protected originals.

## Rollout rehearsal and recovery

The populated upgrade test migrates old sales, unknown cost snapshots, a verified checkpoint and exact receipt history, then compares all historical rows. Runtime tests use the restricted RLS role, not the database owner. Disposable local staging serves a compiled production frontend without hot reload and exercises real authentication, API writes, browser recovery, partial/damaged returns, transfers and counts. The local development migration followed a verified full backup and before/after hashes for 16 existing business tables. Only the synthetic Hybrid Pricing Test company is allowlisted locally; existing products were not enrolled.

Before real-business activation, select reconciled products and verify opening values, stock locations, roles, return disposition and manual refund/credit settlement procedures. Rehearse against approved representative staging data, measure migration locks and API readiness, and test clients carrying pending keys through the maintenance interval. The ORM contract marker does not establish old/new-binary rolling compatibility: pause new writes, drain transactions, apply expansion, start matching API/readers, verify readiness and reopen. Production migration/activation/deployment require explicit approval.

Monitor reconciliation failures, negative stock, source return caps, request duplication/staleness, source sale versus total refunds/costs, exact loss totals and request latency. A flag-off rollback stops new writes while retaining compatible readers, protections and committed results. Never restore an entire database merely to remove this feature, drop the immutable tables, rewrite past sales or fall back to rounded costing for enrolled items. Correct forward with documented records.

## Remaining roadmap

This stage does not complete the full original roadmap. Phase 6 still needs grouped-sale/category reporting and an explicitly approved selected-product business pilot. Phase 7 manual discounts depend on the business limits, stacking and below-cost policies; they remain disabled. Phase 8 covers the multi-product cart and broader reporting. Payment/provider and receipt expansion in Phase 9 is a separate scope decision. Local staging is a rehearsal, not production approval.

## Routes

- `GET /inventory/sale-returns` and `GET /inventory/sale-returns/sources/:type/:id`: administrator source selection and original allocations.
- `POST /inventory/sale-returns/requests`, `GET /inventory/sale-returns/requests/:key`, and `POST .../:key/apply|cancel`: durable return review, confirmation and recovery.
- `GET /inventory/stock-operations` and `GET /inventory/items/:id/stock-operations`: authorized exact-stock availability and state.
- Existing exact-cost request routes accept the strict `stock_operation` variant; cost review/enrollment/value corrections remain administrator-only. Managers cannot read or apply administrator cost requests after a role change.
- `GET /settings/exports/workspace-v5`: consistent complete archive including return allocations.
