# Remaining hybrid-pricing phases: implementation assessment

21 October 2026. Development/test continuation authorized by the user. The user selected disposable local staging. Production and remote staging migration, activation and deployment remain separately approved actions.

## Existing behaviour inspected

Quantities remain `location_stocks.opening_stock` plus the original `stock_movements` ledger. All stock writers lock their inventory item. Grouped sales retain immutable header/line/price-and-cost portions. Those portions contain the original integer unit selling price and assigned cost, including residual cents; old nullable historical prices/costs are not reconstructed. Legacy customer returns copy their original movement's price/cost, with quantities capped under the item lock. Grouped returns currently refuse the legacy route. Exact items have independently verified checkpoints and sequential carrying-value entries; their unsupported writers are blocked. No payment-provider, cash-account or refund-settlement ledger exists in this schema: a recorded return must disclose its refund amount without claiming that money was transferred.

Snapshots and profitability derive their amounts from movements. This permits truthful returns and losses without rewriting a sale: return-in reverses its original revenue/COGS, and an accompanying damaged movement records loss when goods cannot be resold. Exact resellable returns restore original allocated value; damaged returns leave the sellable pool unchanged. Existing unenrolled retail behaviour remains unchanged.

## Incremental implementation and classification

| Stage/change | Classification | Implementation and tests |
|---|---|---|
| Original-allocation calculator | Safe extension while disconnected | Consume remaining homogeneous original portions in recorded order. Partial/full returns conserve original refund and assigned cost, including cent residuals. Include previous legacy returns when capping quantities. |
| Durable return requests, headers and allocations | Migration required; high risk | Add tenant-scoped immutable records and restrictive source/movement references; prepared requests have immutable input/preview and guarded terminal states. No old sale, movement or checkpoint backfill. Test populated upgrade, RLS, grants and immutability. |
| Returns and reversals | Behaviour-changing; high risk; opt-in only | Active administrator reviews original refund amounts, reason and resellable/damaged disposition. Existing company/item lock order and durable request keys prevent duplicates and concurrent over-return. Cancellation fences late requests. Reverse only remaining unreturned units; preserve the original sale. Known-cost legacy sources are supported without inventing absent snapshots; unknown-cost exact restoration is refused. No external refund is executed or claimed. |
| Exact transfers, damage, counts and supplier returns | Behaviour-changing; high risk; separate opt-in gate | Reuse durable exact-cost requests. Transfers preserve company quantity/value. Damage, count shortages and supplier returns remove pooled exact value, split into truthful integer-cost movement portions. Count gains require explicit documented acquisition cost/free confirmation. Supplier credit is evidence only, separate from carrying value and payments. |
| Receipt reversal | Behaviour-changing; high risk | Append a reversal of an untouched exact receipt at its actual original cost; refuse when later valuation events depend on it. Never delete/reprice the original receipt or later sales. Later mistakes require a documented prospective correction. |
| Readers, export and verified owner deletion | Safe compatible extension plus migration-required dependencies | Existing movement/profit math remains valid. New complete archive v5 includes return records. v1–v4 retain their existing fields. Remove new dependencies only through the existing password/name-verified owner deletion flow. |
| Optional UI and rollout rehearsal | Safe extension while disabled | Plain admin actions, explicit review, only opaque browser recovery keys. Legacy screens remain the default. Test desktop/mobile, lost responses, simultaneous tabs, role boundaries and real TesterArmy tasks on disposable fixtures. |

## Financial and concurrency rules

The original unit-price/cost portions determine refunds and restored costs; current catalog prices, current averages and newly triggered quantity tiers do not reprice a return or retained units. Partial returns consume original portions deterministically in recorded order. A source revision binds outstanding quantities and base units; after a competing return, a new review is required. Exact costs are private to authorized cost readers. Original sales and missing legacy cost fields remain intact.

A damaged return writes the original return and an equal-quantity original-cost loss in one transaction. Its net sellable quantity/value is zero; the valuation entry explicitly records that net disposition, without a temporary pool-value overflow. No intermediate state is visible. Both movements and their allocation are protected against ordinary deletion.

Each new request serializes by company/key, locks the actor, then company, then item IDs in sorted order. A committed result is recovered before checking gates. Cancellation has a locked tombstone even when preparation never reached the server. New or stale keys cannot exceed source quantities. Exact requests also bind item revision, pool sequence and relevant location quantities. Zero/unknown cost distinctions and bounded integer-cent arithmetic remain enforced.

## Deployment, validation and recovery

Rehearse the additive migration from a populated current contract first. Extend valuation-entry constraints only for the new explicit kinds and permit multiple immutable portions per stock request; old entries and old checks remain valid. Add the new compatible check before removing the prior one. Runtime grants follow RLS creation. Test historical row equality, restrictive references, unchanged original sale totals and tenant isolation.

After the rehearsal, verify a private localhost backup and apply only to the approved development database with bounded lock/statement waits. Deploy the matching API/readers before enabling UI gates for the synthetic company. Current contract metadata does not establish rolling old/new-binary compatibility: staging requires pausing new writes, draining transactions, applying the expansion, checking the matching API's readiness and reopening writes. Preserve browser request keys through this interval. No production action is authorized by this development continuation.

Rollback disables new returns/stock-operation writes, retains immutable results, compatible readers and enrolled-item protections, and corrects forward. Never drop tables, undo historical amounts, restore a full database to remove valid transactions, or fall back to legacy costing for enrolled items. Monitor reconciliation errors, duplicate/stale requests, negative-stock rejections, refunds versus original sales and quantity/value conservation. Staging data access and production approval remain rollout prerequisites, not reasons to block authorized local implementation.

## Implementation update

Original-allocation returns/reversals, exact transfers/losses/counts/supplier returns and guarded receipt reversals are now implemented behind separate development/test gates. The user selected disposable local staging for rollout rehearsal. The [workflow guide](returns-stock-development.md) describes the final behaviour; the [test report](remaining-phases-test-report.md) records validation. Real-business/production activation remains unapproved. Refund amounts and supplier credit evidence are recorded without claiming that money was paid.
