# Phase 4B: prospective valuation policy and implementation plan

21 October 2026. The initial assessment below preceded implementation. The user has since approved exact future costs; see the approved development implementation at the end. Phase 4A current-cost attestations are already available locally; they do not verify an exact opening carrying value or reconstruct older costs.

## Current behaviour and demonstrated differences

`InventoryService.weightedAverageCost` rounds a company-wide average to whole cents after each receipt. `buildSnapshot` values stock as quantity times that rounded current cost. Sale movements snapshot a per-unit integer cost; `buildProfitability` sums their quantities times those snapshots. Original-price customer returns preserve original cost but leave today's average unchanged. Supplier returns use today's average; deleting a purchase does not undo its effect on the current average. Administrators can edit current unit cost directly.

These are existing behaviours to preserve outside an explicitly enrolled future-costing workflow. Previously completed sales and null historical cost snapshots must remain untouched.

| Example | Existing treatment | Proposed future treatment |
|---|---|---|
| Buy 1 unit at GHS 1.00, then 2 at GHS 1.01 | Average rounds to GHS 1.01; displayed 3-unit value is GHS 3.03 against GHS 3.02 of purchases | Preserve total value GHS 3.02. Display a rounded average for convenience, but derive stock value and assigned sale costs from the exact remaining value. |
| Sell those 3 units separately | Costs GHS 1.01 each; total assigned cost GHS 3.03 | Assign GHS 1.01, GHS 1.01 and GHS 1.00 as the pool runs down; total is exactly GHS 3.02. |
| Sell 1 of 2 units costing GHS 1.00 each; buy 1 at GHS 3.00; customer returns the original unit | Current average stays GHS 2.00; 3 remaining units display GHS 6.00, although original-cost stock value is GHS 5.00 | Restore the original assigned GHS 1.00 and one sellable unit; pooled value becomes GHS 5.00 for 3 units. Do not reprice the original sale. |
| Delete a 1-unit GHS 3.00 receipt after adding it to 1 unit at GHS 1.00 | Receipt row disappears, one unit remains, and its current value stays GHS 2.00 | For enrolled items, retain the receipt and use a separately authorized correction/reversal. Never silently replay and reprice earlier sales. |

## Recommended policy

Retain perpetual company-wide moving weighted average. For explicitly enrolled future transactions, preserve integer-cent total carrying value instead of repeatedly rounding and multiplying an average. For an outbound quantity `q` from `Q` units with total value `V`, assign `round-half-up(V*q/Q)` cents; the last outbound quantity consumes the entire remaining value. Keep all arithmetic in integer cents with bounded BigInt calculations. Separate legitimate one-cent per-unit allocations from selling-price portions so cost allocation never creates another stock deduction.

Customer returns use their original allocated net selling price and assigned cost. Restore sellable quantity and its original value only for resellable goods; an unsellable return needs an explicit loss/disposition entry and must not become sellable stock. No retained-item repricing is proposed. Phase 5 must deliver the full return/refund/reversal implementation before a production selling pilot.

Stock-only issues (damage/count shortages/supplier returns) remove current pooled average value. Any supplier credit based on original invoice price is a separate discrepancy/settlement amount, not an invented payment or retroactive sale-cost change. For enrolled items, direct cost changes and purchase cancellation/deletion become explicit, append-only current-period corrections with reason, evidence and original references. Negative-stock enrollment is refused; an existing business setting is never flipped automatically. Backdated business dates do not replay past costs; transaction commit order determines prospective assignment and the effective valuation time is recorded explicitly. Currency changes require closing/reviewing the valuation period rather than relabelling an active pool.

## Enrollment and data boundary

Start from a verified checkpoint of current quantity, actual current total value, base unit and currency, supported by records and an administrator. A current unit-cost attestation alone is insufficient: multiplying its rounded unit cost by old stock would perpetuate any pre-existing residual. A zero-stock checkpoint may establish quantity/value zero; nonzero stock needs independently verified total value. Do not infer historical receipt costs or revalue old sales. Unreconciled or negative stock stays on the existing workflow and cannot be silently enrolled.

No customer-product conversion, retrospective acquisition-cost reconstruction, FIFO switch, old-price rewrite or mass backfill is proposed.

## Incremental implementation

1. Freeze legacy behaviour with populated purchase/sale/return/cancellation regression cases and inspect every cost/quantity writer. Produce executable examples of proposed precision behaviour before implementing a financial writer.
2. Add a pure, integer-only prospective value/COGS allocator with conservation tests: repeated receipts/issues, final-unit exhaustion, original-cost return, zero/unknown distinctions, bounds and mixed pricing portions. Keep it disconnected from application writes until policy is selected.
3. Plan separate additive checkpoint, valuation-entry and cost-allocation records with tenant constraints, restrictive relationships and append-only controls. Keep the existing quantity ledger authoritative. The implementation supplies a separate expansion migration, reviewed offline and rehearsed on a populated disposable database before local application.
4. Add a default-empty development-only company/product gate and explicit checkpoint enrollment. Connect every stock writer for an enrolled item under one consistent company/item lock order. Existing companies/products retain current behaviour. Unsupported enrolled-item operations fail before any write until their correction path exists.
5. Add compatible readers that prefer exact recorded cost totals only for new enrolled records, while preserving old unit-cost/null snapshots. Test old exports/clients and new value disclosures. Quotes bind the valuation revision; old quotes cannot survive a receipt that changes the pool even when the displayed rounded average is unchanged.
6. Reconcile full workflows in disposable PostgreSQL and browser tests, including TesterArmy, then rehearse migration/rollback on approved staging data. Production migration and activation remain separately authorized actions.

## Classification and recovery

| Change | Classification | Impact, verification and recovery |
|---|---|---|
| Comparison report and legacy regression cases | Safe extension | No runtime financial change or migration. Validate exact worked amounts using isolated synthetic data. |
| Exact prospective value/COGS allocator | Behaviour-changing and high risk once connected | Affects future stock value, cost assignments and profit for enrolled items. Require explicit policy selection, conservation/property tests and all-writer integration tests. Keep disconnected initially. |
| Checkpoints, valuation entries and original cost allocations | Migration required; high risk | Additive design only; no historical backfill. Inspect constraints/RLS/grants and rehearse with populated data, bounded locks and older clients before applying anywhere. |
| Enrollment, correction protections and new readers | Behaviour-changing; high risk | User-visible value can differ at the verified checkpoint; deletion/cost-edit workflows change only for enrolled items. Provide correction UI and compatible readers before enabling writes. |

Deploy schema expansion first, compatible API/readers next and optional web UI last, with all gates off. Activate only a selected reconciled development item first. Production requires an approved staging rehearsal, monitored reconciliation and explicit approval.

Rollback stops new precise-cost writes and retains checkpoints, original allocations, correction records and compatible readers. Once new cost records exist, do not revert to a binary that ignores them or drop tables. Do not restore a whole database to remove the feature; preserve valid transactions and correct forward. Unenrolled retail remains on its existing path throughout.

## Approved policy

The recommended choice is exact future carrying values while retaining the existing averaging method and leaving historical records intact. The alternative is to retain today's cent-rounded average and its known stock-value/COGS discrepancies, explicitly limiting accuracy claims. The user explicitly selected exact future costs on 21 October 2026.

## Completed assessment validation

The isolated PostgreSQL/HTTP suite passes 92 tests, including three added legacy-baseline cases for receipt rounding, original-cost returns after a cost increase, and receipt deletion without average-cost restoration. Machine-checked comparison amounts are saved in `test-results/phase4b-policy/comparison.json`; the integration log is alongside it. The comparison is an offline policy example, not a connected financial engine. Per-issue half-up allocation can shift an intermediate cent between transactions when quantities are grouped differently; full pool exhaustion always consumes the exact original value. This consequence is part of the proposed policy and must be covered by prospective allocation tests.

No application financial writer, schema, migration, feature flag or business data was modified during this assessment. The subsequent implementation follows the approved exact-cost choice; this paragraph records the assessment boundary.

## Approved development implementation

The user selected **Preserve exact future costs** on 21 October 2026. Implement the prospective development workflow with a verified opening balance; do not ask for that decision again. Production migration/activation remain unauthorized.

The first connected development path supports verified enrollment, documented receipts, exact grouped sale completion and explicit current-value adjustments. Older stock writers must refuse an enrolled item until they have a compatible valuation path. Non-enrolled items are unchanged. Returns/reversals remain Phase 5; enrolled-item transfers, damage, counts and supplier returns remain unavailable in this bounded slice rather than bypass the value ledger. Do not activate this slice for an operating business.

The migration adds three tenant-scoped tables: durable administrator requests, immutable verified checkpoints, and immutable movement/value entries. Request preparation/recovery/cancellation stores financial inputs on the server; the browser persists only an opaque per-account request key. Prepared requests can be cancelled with a transaction-locked tombstone, including when their original response was lost, so a late request cannot execute after cancellation.

Schema inspection found that `sale_lines` currently enforces `cogs_cents = quantity * unit_cost_cents`. Exact average costs cannot always be represented by one integer-cent per-unit number. Add a nullable, company/item-scoped checkpoint reference and relax that equation only for lines tied to a valid checkpoint; old lines keep null and the original equation. Original financial columns are not updated. This is a migration-required, high-risk compatibility extension to an existing constraint and must be tested on a populated upgrade with bounded locks before applying locally. At the movement level, split a price portion into homogeneous cost portions when necessary, preserving quantity/revenue sums. This lets existing profitability and movement CSV arithmetic remain exact without rewriting historical records.

Inventory-value readers allocate the exact pooled total over locations deterministically; the rounded displayed unit average is informational. New complete archive v4 includes requests, checkpoints and entries. Older archive versions retain their original fields. Rollback keeps compatible readers, checkpoints and protections; disabling the writer blocks new operations for enrolled items rather than silently reverting their costing method.
