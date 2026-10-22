# Hybrid pricing: current-system assessment and enhancement plan

Date: 20 October 2026. Source revision: `db81656`.

Status: discovery and proposed design for review. No application code, schema, existing migrations, seed data, or production records were changed. Implementation and production deployment require separate explicit approval, as requested. This document supplies deliverables A–F from the attached requirements; proposed policies below are not approved business rules.

Implementation note: the user subsequently approved the first development stage. The statement above records the discovery baseline. The implemented preview stage and release/rollback boundaries are documented in [pricing-preview-rollout.md](pricing-preview-rollout.md). Actual hybrid sale completion remains disabled.

Current development progress: phases 0–3 are implemented locally; production hybrid checkout remains disabled. Phase 4 has started with [current-cost review](cost-readiness-development.md), an optional development-only administrator attestation. Precision/residual accounting, prospective valuation corrections, original-allocation returns and production rollout remain incomplete. The assessment below preserves the original discovery findings.

## A. Current system assessment

### Scope and evidence

I inspected the API, React client, database contract, migration history, authorization, exports, deployment configuration, and tests. Findings describe this checkout. I did not connect to production or staging, inspect customer records, verify deployed revisions, or measure production data volumes. Therefore, schema compatibility can be assessed from source, but actual customer-data readiness remains unverified.

Baseline checks performed without implementation changes:

| Check | Result | Isolation |
|---|---|---|
| Existing API unit suite | 15 files, 76 tests passed | Explicit unusable localhost database URLs; database dependencies in these tests are mocked |
| Existing PostgreSQL integration suite | 1 file, 39 tests passed | New disposable PostgreSQL 17 Alpine container, random localhost port, temporary database |
| Existing migration chain | 15 migrations, 196 operations applied successfully | Only that temporary database |
| Cleanup | Completed | Runner dropped its test database; container and temporary storage removed |

No new regression tests were written because the requested approval gate covers code changes. The regression additions specified below are the first implementation task after approval. No browser sale walkthrough, build, lint, production migration, seed, or deployment was run during discovery. Existing tests passing does not establish coverage for the missing features or validate an upgrade of populated customer data.

### Architecture and source map

This is an npm workspace with a TypeScript NestJS API and a React 19/Vite client. Persistence uses PostgreSQL and the Prisma ORM contract API (`@prisma/orm-postgres`), including explicit SQL for locks and security context. It does not use a conventional `schema.prisma` plus generated `PrismaClient` implementation.

| Concern | Actual source and entry points |
|---|---|
| Application modules | [app.module.ts](../apps/api/src/app.module.ts): auth, inventory, onboarding, settings, shared Prisma/core modules |
| Authoritative schema | [contract.prisma](../apps/api/src/prisma/contract.prisma): models, checks, relationships, tenant policies; generated `contract.json` and `contract.d.ts` are alongside it |
| Transactions | [prisma.service.ts](../apps/api/src/prisma/prisma.service.ts): `PrismaService.withCompany`; [db.ts](../apps/api/src/prisma/db.ts): database client |
| Inventory API | [inventory.controller.ts](../apps/api/src/modules/inventory/inventory.controller.ts): `InventoryController` |
| Stock writes and pricing | [inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts): `createMovement`, `recordMovement`, `lockItem`, `weightedAverageCost`, `deleteMovement`, `createStockCount` |
| Quantity and valuation reads | [inventory-calculations.ts](../apps/api/src/modules/inventory/inventory-calculations.ts): `buildSnapshot` |
| Profit | [profitability-calculations.ts](../apps/api/src/modules/inventory/profitability-calculations.ts): `buildProfitability` |
| Validation | [create-movement.dto.ts](../apps/api/src/modules/inventory/dto/create-movement.dto.ts), other inventory DTOs; [core.module.ts](../apps/api/src/core/core.module.ts): global whitelist, unknown-field rejection, and transformation |
| Client API and state | [api.ts](../apps/web/src/api.ts), [inventory-store.tsx](../apps/web/src/app/inventory-store.tsx): `InventoryProvider`, `mutate`, snapshot refresh |
| Role-specific routes | [role-workspace.tsx](../apps/web/src/app/role-workspace.tsx): administrator, inventory manager, attendant workspaces |
| Operational UI | [item-pages.tsx](../apps/web/src/features/items/item-pages.tsx), [movements-page.tsx](../apps/web/src/features/movements/movements-page.tsx), [shop-sales-page.tsx](../apps/web/src/features/sales/shop-sales-page.tsx), [stock-counts-page.tsx](../apps/web/src/features/stock-counts/stock-counts-page.tsx), [suppliers-page.tsx](../apps/web/src/features/suppliers/suppliers-page.tsx) |
| Reporting UI | [report-pages.tsx](../apps/web/src/features/reports/report-pages.tsx), [profitability-page.tsx](../apps/web/src/features/profitability/profitability-page.tsx) |
| Export compatibility | [data-export.service.ts](../apps/api/src/modules/settings/data-export.service.ts): `inventory`, `movements`, `workspace` |
| Existing regression suite | [inventory.integration.spec.ts](../apps/api/test/inventory.integration.spec.ts), inventory calculation/DTO specs, [pilot.spec.ts](../tests/e2e/pilot.spec.ts) |
| Deployment and migrations | [prisma.config.ts](../apps/api/prisma.config.ts), [migrations/app](../apps/api/migrations/app), [render.yaml](../render.yaml), [quality.yml](../.github/workflows/quality.yml) |

### Products, units, and balances

`InventoryItem` / `inventory_items` contains company, SKU, name, category, free-text `unit`, reorder level, integer `unitCostCents`, nullable integer `sellingPriceCents`, and `isActive`. SKU is unique within a company. Units can be `pcs`, `bag`, `carton`, or another string; the system does not know how these units convert.

`LocationStock` / `location_stocks` stores **opening quantity**, not a separately updated live balance. Its unique key is `(companyId, locationId, itemId)`. `StockMovement` / `stock_movements` stores positive integer quantities for purchase, transfer, customer return, supplier return, damage, sale, and count adjustments. A transfer has both source and destination locations in one row.

`buildSnapshot` calculates, for each item and location:

```text
closing = opening + purchases + customer returns + transfers in + adjustments in
        - transfers out - supplier returns - damage - sales - adjustments out
```

All movement types already share this ledger. There are no independent retail and wholesale stock balances to merge. However, the claim that *all existing data is already in pieces* cannot be made: quantities are whole numbers in each product's declared unit. A customer whose item unit is `carton` may mean cartons, not pieces. Never multiply that customer's existing balance based only on the label.

`createItem` atomically creates the item and its opening balance. Spreadsheet import atomically creates all imported items and openings, with duplicate SKU checks and company defaults. Import does not merge existing products. Administrators can edit unit cost directly and archive zero-total-stock products. Archiving hides positions while retaining catalog/history; `recordMovement` itself does not explicitly reject an archived item, so the new sale path must validate active status independently.

Current inventory value is `closing × current item.unitCostCents`. This is current valuation at the company-wide item cost; it is not a historical valuation ledger or separate location-specific valuation.

### Selling prices, discounts, and the sale screen

`InventoryService.recordMovement` (around lines 394–489) implements sales as individual `StockMovement(type='sale')` rows. A sale has one product, one positive integer quantity, and one snapshotted integer unit price and cost. There is no `Sale`, `SaleItem`, basket, customer account, or tender model in the current schema.

Only a shop attendant assigned to a shop can record sales. The server overrides the submitted source location with the attendant's assigned location and requires it to be a shop. Administrators and inventory managers cannot directly create a sale through this service.

The backend reads the catalog selling price after locking the item. An unset price blocks a sale; an explicit zero price is valid. Optional `expectedUnitPriceCents` is a stale-price check, not permission to submit a different charge. A mismatch returns `409` before a stock write. The server checks that `price × quantity` is a safe JavaScript integer.

`ShopSalesPage` (`/sell`) selects one stocked product, accepts a quantity, shows `quantity × catalog price`, and posts one movement. Its max quantity is the displayed available stock. It has no box selector, tier calculation, manual discount, cart, payment collection, or printable receipt. Recent sales show the recorded price and `saleTotalCents`. No payment gateway, payment initiation, cash/change ledger, refund disbursement, receipt-numbering, or receipt-generation implementation was found in the inspected modules. A stock receipt means a purchase receipt here, not a customer payment receipt.

No automatic promotion or manual discount functionality was found. Unknown discount fields would be rejected by the current global validation pipe. Below-cost and margin authorization policies do not currently exist.

### Purchase costs and costing method

Purchases reuse `StockMovement(type='purchase')`. They record receipt quantity, actual per-unit cost, optional supplier, date, reference, and note. `Supplier` is a company-scoped directory with active status and contact details. There is no multi-line purchase document, supplier-invoice settlement, payable balance, or purchase-payment model.

After a purchase, `weightedAverageCost` updates `InventoryItem.unitCostCents` using the **pre-purchase total on-hand quantity across locations**:

```text
new average = round_half_up(
  (old quantity × old item cost + received quantity × receipt unit cost)
  / (old quantity + received quantity)
)
```

Multiplication/division use `BigInt`, with the result rounded to whole minor units. This is already a company-wide moving weighted-average approach for purchase receipts. The enhancement should retain that method rather than introduce FIFO or a second cost engine by default.

Important limitations of the existing implementation:

1. Each purchase rounds average unit cost to one cent. Example: 20 units at 10.00 plus 30 at 12.00 gives 11.20; 1 at 1.00 plus 2 at 1.01 rounds to 1.01, valuing 3 units at 3.03 against 3.02 of input cost. Exact carrying-value reconciliation needs an explicit precision/residual policy.
2. Item cost is required/defaulted to zero. The create form defaults it to `0`. This cannot distinguish a confirmed free acquisition from missing cost entered as zero.
3. Existing movement cost snapshots are nullable. The costing migration did not backfill old receipts or sales, correctly preserving missing historical information.
4. Administrators can edit current item cost directly. That changes current valuation and future cost snapshots without a separate valuation-adjustment record; historical sale snapshots stay unchanged.
5. Purchases update the average; customer returns restore quantity and copy original cost but do **not** recalculate the current average. Returning a unit sold before a cost increase can make current inventory value differ from the historical cost restored through COGS reversal.
6. Supplier returns use current item cost and do not link to an original purchase or recalculate the average. A purchase can be deleted without restoring/recalculating the average.
7. Moving average follows request processing order, even if the submitted `movementDate` is backdated or future-dated. Reports filter by business date. No chronological replay recalculates historical sale costs.
8. Negative on-hand is possible under a company setting; the average formula is not a complete negative-inventory costing policy.

These are existing limitations, not permission to revise historical financial values. Accurate future valuation must be a separately tested and approved part of the plan.

### Profit and reports

`buildProfitability` uses recorded sale and customer-return snapshots, not today's selling price. A customer return subtracts original unit price and original unit cost. Gross profit is calculated from **costed revenue minus matched COGS**; margin divides by that costed revenue. `netSalesCents` also includes priced sales whose costs are missing. The report exposes cost coverage and the UI warns that gross profit excludes sales without recorded cost.

Consequently, with incomplete historical costs, displayed gross profit is not simply *all net sales minus displayed COGS*. That is intentional incomplete-data handling and must remain explicit. A zero cost counts as recorded in this calculation even if its provenance is unknown. Sales lacking price snapshots also fall outside the costed calculation.

The owner-only profitability screen filters 7/30/90 days, location type, location, item, and category. It shows quantities sold/returned, net sales, COGS, gross profit, margin, daily trend, and inventory losses. Damage and negative count adjustments appear as losses separately from gross profit. These are not net-profit-after-expenses reports.

General inventory reports show current/low/fast/slow/dead stock. Velocity counts sales plus transfers out, not only customer sales. Closing quantities include all ledger records, while period filters apply to activity; this is not an as-of inventory report. The profitability date filter has a lower bound but no upper bound, so future-dated movements can appear despite the displayed end date.

There are no retail/bulk/box pricing categories, gross list-sales/discount breakdowns, transaction discounts, or mixed-price portions. Existing movement CSV computes `unitPriceCents × quantity`; workspace export is `stockledger-workspace-v1`. Both need explicit compatibility treatment if new sale structures are introduced.

Currency is a company setting, default GHS, with GHS/USD/NGN/GBP/EUR supported. [company-settings-store.tsx](../apps/web/src/app/company-settings-store.tsx) formats using that setting. The README's USD-only passage is stale. Movement rows do not snapshot currency; changing company currency changes the display label of existing amounts without conversion. No tax configuration or tax calculation was found. Do not introduce a tax assumption or label current totals tax-inclusive/exclusive without a separate decision.

### Transaction safety, returns, and deletion

`PrismaService.withCompany` opens a transaction and sets local `app.current_company_id`. Stock writes, item price changes, counts, and deletions acquire `SELECT … FOR UPDATE` on the company/item row. `recordMovement` reads balances after the lock, validates, writes, and updates purchase cost before commit. The lock serializes operations on the same item across locations; different products can progress concurrently.

This provides a strong reusable basis for preventing competing deductions. The existing integration suite verifies competing sales/transfers, deletion races, rollback, and tenant boundaries using separate connection pools and deliberate lock contention.

The README says transactions explicitly select Read Committed. The inspected `withCompany` code and integration helper do not explicitly set isolation. Current isolated tests pass under the test server defaults; production isolation has not been verified. The approved safety phase should explicitly establish and test the intended isolation before relying on post-lock reads.

The stock check applies only when `Company.allowNegativeStock` is false (default). With it enabled, API sales and other outbound writes can overdraw; the sale UI still caps quantity to displayed positive stock. The request's unconditional ordinary-sale no-negative rule therefore conflicts with an existing setting. Do not silently switch that setting or rewrite past negative balances.

Customer `return_in` requires an original sale, matching item, and cumulative return quantity no greater than sold quantity. It restores to the original sale location and snapshots its original price/cost. The shared item lock protects the returnable-quantity check. There is no return disposition: **all customer returns increase sellable stock**. There is no refund-payment state, original mixed-price component allocation, or reversal document.

`deleteMovement` is available to administrators and inventory managers. It checks that removing the row leaves current affected-location stock nonnegative, then physically deletes the row and writes an audit event containing its price/cost/quantity. Stock-count-linked adjustments cannot be deleted. Foreign keys restrict deleting a sale referenced by a return. Otherwise deleting a sale restores stock and removes its contribution from reporting; deleting a return removes the return record and reopens its quantity allowance. This is not an immutable financial reversal workflow. Audited deletion still changes the underlying financial history.

There is no idempotency key or duplicate-business-request constraint. A repeated sale can create another deduction if enough stock remains; repeated returns can process again up to their quantity cap. The UI disables a pending action but cannot protect against lost responses/retries. In `InventoryProvider.mutate`, a successful write followed by a failed snapshot refresh is displayed as an update error, which can encourage retrying an already committed action.

### Security and database constraints

API authorization uses JWT plus an active-user/role lookup, followed by service-level role checks. Administrator setup/pricing, attendant shop-specific sales, inventory-manager operational writes, and owner-only profitability/exports already exist. There is no separate cashier discount limit or manager approval capability. An inventory manager is not automatically authorized to approve financial discounts.

The schema uses company-scoped composite foreign keys, RLS policies, positive movement quantities, nonnegative nullable price/cost checks, and reference-type checks. Related-movement and stock-count links use restrictive deletion. Item deletion cascades to stock/movements at database level, although normal product maintenance uses archiving. New financial tables must not accidentally inherit cascading deletion of history.

The restricted runtime role is `stockledger_app`; the runtime login is separate from the migration owner. New tables need both explicit runtime grants and RLS. The demo interceptor blocks writes. Existing `AuditEvent` can be reused, but ordinary sale/purchase/return creation does not currently call the inventory audit helper or store the acting user on the movement. Counts and certain setup/deletion changes do record actors.

Owner-confirmed workspace deletion is an existing separate workflow requiring business-name confirmation and current password. It explicitly deletes tenant collections. Adding financial tables requires updating and testing this workflow without enabling cascaded or accidental deletion; this enhancement must never call it as migration/recovery tooling.

### Migration and deployment history

All 15 existing migration files were reviewed for their effects and the current contract was inspected. Relevant stages are:

| Migration | Existing effect / compatibility significance |
|---|---|
| `20260916T1621_initial_inventory` | Original items and movement ledger; integer quantities/costs |
| `20260916T1731_add_user_auth` | User authentication |
| `20260922T1514_add_companies_and_locations` | Company/location split; copied original opening quantities into location stocks; legacy association used fixed demo company/location IDs |
| `20260922T1609_add_sale` | Added sale to permitted movement types |
| `20260923T1137_restrict_supabase_api` | Restricted public data API access |
| `20260923T1214_add_selling_prices` | Nullable catalog and movement selling-price columns; no fabricated legacy sale prices |
| `20260924T1438_add_account_controls` | Staff account controls |
| `20260924T1554_add_owner_onboarding` | Company onboarding data |
| `20260925T0019_enforce_tenant_isolation` | Tenant-column backfill/validation, composite relationships, restricted role and RLS |
| `20260925T0025_harden_accounts_and_audit` | Refresh sessions, audit events, account hardening including existing-user verification data update |
| `20260925T0127_add_company_settings` | Configurable currency/timezone/profile, default GHS |
| `20260925T1038_add_inventory_operations_and_profitability` | Suppliers, counts, archived catalog status, nullable movement costs/return links; preserved historical missing values |
| `20260925T1733_enable_workspace_deletion` | Narrowly scoped audit deletion policy/grant for workspace removal |
| `20260925T2316_expand_workspace_settings` | Inventory defaults, negative-stock policy, purchase-source/reason policy, terminology |
| `20260925T2318_add_session_security_details` | Session security metadata |

The source has migrations that previously moved/backfilled data; therefore the future plan must inspect actual applied migration state rather than replay old scripts against a live installation. The empty-database test above does not prove a populated-data upgrade is safe.

`render.yaml` currently runs migrations in the API **build command**, uses automatic deploys on commits, and defines an initial deployment seed hook. That means a production-connected build can migrate the database before the new process serves requests, while old code is active. The seed script uses upserts and updates demo openings, costs, accounts, and dated movements; it is not a production repair or reconciliation tool. No seed should be part of this enhancement rollout. Approving a local implementation does not approve a push that triggers production deployment.

### Data-readiness conclusion

The current structure can support optional hybrid pricing without rewriting stock balances: retain base-unit quantities and add pricing configuration and transaction snapshots. It cannot establish, from source alone, that every customer's quantities are pieces, costs are trustworthy, inventory valuation reconciles, or external integrations understand mixed pricing.

Before pilot enrollment, use an approved development/staging copy or approved read-only export to check applied migrations, schema drift, actual item units, balances including archived/negative positions, price/cost nulls, zero-cost provenance, unlinked legacy returns, existing deletions, direct cost edits, company currency changes, and integration usage. Record exceptions by company/item and reconcile only through explicit, auditable decisions. Do not block unaffected retail products merely because other products are not ready.

## B. Gap analysis

Classification codes used throughout this plan: **S — Safe extension**, **M — Migration required**, **B — Behaviour-changing**, **H — High risk**. Codes can overlap: an additive schema migration is M even if its disabled feature is an S; financial activation is H. IDs link this table to the deployment/recovery register and roadmap.

| ID / feature | Current implementation | Required behaviour | Gap | Proposed change and classification |
|---|---|---|---|---|
| C01: regression baseline | Stock, price, costing, returns, roles and concurrency tests exist | Protect current workflows before extension | No hybrid, retry, damaged-return, valuation-reconciliation or checkout coverage | Extend existing suites before changing behaviour; S |
| C02: optional activation | Company business type is descriptive; no hybrid feature controls | Default off, selected company/product pilot | No effective feature gate | Server-enforced company allowlist/kill switch and product opt-in; versioned configuration; S, M; activation B/H |
| C03: packaging | Whole quantities, free-text item unit | Configurable group-to-base conversion | No numeric conversion; old units may mean cartons | Optional package label/size, one active selling package per item initially; no separate stock balance; S, M; conversion of old units B/H, excluded from automatic migration |
| C04: automatic prices | One retail catalog price and unit-price snapshot | Retail, tier prices and full-box-plus-remainder | No rules or exact mixed-price representation | Validated versioned item configuration, pure backend calculator, quote endpoint; S, M; opting in B/H |
| C05: durable sale grouping | One movement is one single-product sale | Mixed price portions, multi-product checkout, exact totals | No document/line totals or atomic basket | Add sale header/lines, link exact-cent component movements, reuse existing ledger and item locks; M/H; new workflow B |
| C06: retry/concurrency safety | Item lock and transaction, no idempotency; optional negative stock | One business transaction once, no overselling | Lost response can duplicate sales; ordinary-sale stock policy conflicts | Idempotency and payload hash, explicit isolation, deterministic lock order; no-negative pilot eligibility; S/M/H; tightening existing policy B |
| C07: manual discounts | None | Authorized fixed/% line/transaction discounts | No limits, approval, audit or stacking policy | Optional discount policy, backend authorization and bound approval, exact allocations; S/M/H; business policies B |
| C08: cost provenance and valuation | Purchase WAC rounded to cents; direct cost edits; return/deletion limitations | Known historical costs; reconciled future inventory carrying value | Unknown vs true zero indistinguishable; cost restoration and residuals incomplete | Retain existing method initially; add provenance and separately approved prospective valuation corrections; M/B/H |
| C09: returns and reversals | Linked quantity-capped return; all returned stock sellable; deletion | Original allocated refund/cost, damaged disposition, immutable correction | No mixed component allocation, disposition or financial reversal | Versioned return/reversal records, cumulative exact allocations and idempotency; reuse lock and legacy original snapshots; M/B/H |
| C10: reporting/export | Snapshot, owner profit, current CSV and archive formats | Pricing portions, gross/discount/net/COGS/profit, exact reconciliation | No categories/discount values; coverage/currency caveats | Extend calculations with explicit coverage and add versioned detail exports; preserve legacy formats; S/M/H for financial calculations |
| C11: payment and receipts | No implementation found | Recoverable checkout, refund disbursement, receipt if in scope | New capability, not a refactor | Initially record inventory sale only; implement grouped sale summary. Payment processing and formal receipt issuance are separately scoped phases; S/M/H, workflow B |
| C12: rollout controls | Auto-deploy, build-time migrations, readiness and optional Sentry | Reviewed staged releases, compatible mixed versions, recoverable deployment | No hybrid kill switch, reconciliation metrics or safe migration release gate | Rehearsed expand-only migrations, manual production gate, metrics and minimum compatible release; S; deployment/config changes B/H |

## C. Refined business rules

### Confirmed requirements

The following come from the request: one shared inventory ledger in the smallest verified sellable unit; optional product configuration; full groups qualify without tracking sealed packaging; no historical price/cost fabrication; server-authoritative pricing; precise monetary arithmetic; explicit approvals for manual discounts; original-sale-based returns; no ordinary-sale overselling; no production changes without approval.

Everything described as a proposed policy in this section still requires business review. The sample numbers below illustrate the supplied requirements and must not be hard-coded.

### Proposed retail, box, and bulk rules (C03–C04)

1. Preserve `sellingPriceCents` as the standard retail price. Existing unset/explicit-zero behaviour remains unchanged when hybrid pricing is off. Do not derive retail price from cost.
2. For an opted-in product, validate that current quantities already mean the intended base unit. A selling package has an integer size greater than one and a nonnegative whole-package price. A product can call it a box or carton. Initially support one active selling package per item; multiple simultaneous package sizes require a separate precedence decision.
3. With eligible quantity `q`, package size `b`, box price `P`, and retail price `R`, calculate `boxes = floor(q/b)` and `remainder = q mod b`. Charge `boxes × P` plus the independently priced remainder.
4. Choose the highest qualifying **minimum quantity** tier for the remainder; apply its per-piece price to **every piece in the remainder**. If none qualifies, use retail. This is all-units pricing within the remainder, not graduated marginal pricing. With no package pricing enabled, apply the tier to the whole line quantity.
5. Thresholds are positive, unique, ordered integers. With box pricing active, reject active thresholds at or above box size rather than silently leave them ineffective. Validate tier prices as nonincreasing and no higher than retail. Validate full-box pricing does not exceed the configured non-box charge for the same base quantity. Confirm changing the box size does not invalidate tiers.
6. Aggregate duplicate entries of the same item within one checkout before calculating thresholds. Thresholds do not combine different products, different checkouts, or previous customer purchases.
7. Box decomposition takes precedence over bulk pricing on the total line. Do not automatically search for the cheapest combination. Reject or explicitly review unusual price schedules and warn about quantity-boundary price drops; do not silently change the supplied algorithm to solve them. All-units tiers can make adding a unit reduce total at a threshold, which requires acknowledgment when configuring such a schedule.
8. Box entry is an input convenience: 2 boxes of size 10 means 20 base units. Show that conversion before confirmation. Preserve both entered form and base quantity in the new sale snapshot.
9. Price changes create a new version. Quotes are informational until confirmed. Checkout locks all involved items, revalidates rule versions, price, permissions and stock, then stores immutable snapshots. A stale quote returns a conflict with no sale or deduction, allowing the user to review a new quote.

Using the requested 15.00 retail, 5-piece minimum at 13.00, and 10-piece box at 120.00:

| Base quantity | Price composition | Total (GHS in the example) |
|---|---|---|
| 2 | 2 retail | 30.00 |
| 7 | 7 bulk | 91.00 |
| 10 | 1 box | 120.00 |
| 11 | 1 box + 1 retail | 135.00 |
| 15 | 1 box + 5 bulk | 185.00 |
| 19 | 1 box + 9 bulk | 237.00 |
| 20 | 2 boxes | 240.00 |
| 23 | 2 boxes + 3 retail | 285.00 |
| 25 | 2 boxes + 5 bulk | 305.00 |

### Proposed manual discount policy (C07)

Manual discounting starts disabled. Enable it separately from automatic pricing. Support either a fixed amount or an integer basis-point percentage for a line; transaction-wide discounts require the grouped checkout first. A request must identify its scope, reason, requested amount, actor, and policy version. Do not allow the same intent to be applied as both a line and transaction discount.

Default proposal: manual discounts **do not stack with any automatic discount on the affected line**. A wholesale line with a manual discount is rejected unless an administrator has explicitly enabled that combination and authorized its limit/approval. For a mixed line containing box-priced pieces, this restriction applies to the entire line. For a transaction discount, reject if any affected line conflicts, or require the user to explicitly choose eligible lines; do not silently skip some lines.

If stacking is approved, apply the manual discount to the post-automatic subtotal, never again to list price. Allocate transaction discounts to eligible lines proportionally, then to pricing components, using deterministic largest-remainder allocation with stable tie-breaking. Discounts cannot exceed the eligible subtotal; amounts cannot become negative. Zero-revenue margin is unavailable.

Use per-user/role limits enforced by the server. Only administrators manage policies. A separate approval capability is required for managers; do not grant it merely because the role is named inventory manager. Approval must be authenticated, short-lived, one-use, and bound to the checkout content, pricing version, amount, and location. A changed cart invalidates it. Store requester, approver, reason, limit and actual allocation in the audit trail atomically with the sale.

Gross-margin warnings and below-cost restrictions use known assigned cost. Default proposal for opted-in discounted sales: block below-cost sales unless a specifically authorized override is configured; block manual discount approval when cost is unknown pending an explicit unknown-cost exception policy. Do not treat an unverified zero as proof of a profitable sale. Cost-sensitive approval must be revalidated under the item lock if a purchase changes the average after the quote. These are new policies, not existing rules to enforce silently on legacy retail.

### Proposed stock and reconciliation rules (C05–C06)

All sale components deduct only their own base quantity from the existing ledger, with `sum(component quantities) = line base quantity`. Do not also create a full-quantity parent stock movement. Each product and the whole checkout commit atomically; one failed item writes nothing for the checkout.

Acquire item locks once in sorted item-ID order for a multi-item cart. All future mutation paths use the same lock rule, tenant context, and explicit Read Committed transaction intent. Re-read stock and cost after locking. A payment call must never hold these locks open.

Idempotency is company-scoped and operation-specific. Replaying the same key and same canonical payload returns the original committed result; the same key with a different payload returns a conflict. The unique key, payload hash, sale record, ledger movements and audit entries commit together. A transaction rollback must not leave a falsely completed key. After a connection loss, query/retry by key rather than record a fresh sale. A rejected stale quote needs a reviewed new request; an uncertain commit must retain its original key.

No-negative ordinary sales are required for the new workflow. Proposed pilot rule: enroll only companies with `allowNegativeStock=false` and no negative pilot-item positions. Recheck at sale time. Resolving the global setting for other companies is an explicit behaviour decision, not a migration default.

Use stock counts for theft, damage, expiration and reconciliation, preserving original expected/count/variance/reason. Do not reset openings or replace ledger history. Existing negative-stock positions need an approved reconciliation path: the current `StockCount.expectedQuantity >= 0` constraint can prevent counting a negative expected balance, so a dedicated, audited remediation design may be required before enrollment.

### Cost, COGS, and profit policy (C08–C10)

Retain company-wide perpetual moving average as the costing method. New sale movements snapshot the locked current cost. Later receipts/configuration changes never rewrite those snapshots. For legacy missing snapshots, report unavailable cost/profit coverage; do not calculate historical COGS from current cost.

For a future approved valuation improvement, retain higher-precision carrying value or a valuation residual alongside the cost quantity, derive the moving average deterministically, and allocate COGS to cents at the defined boundary. This is a change in precision/valuation behaviour and must not be mixed casually into pricing work. Establish an approved opening valuation checkpoint; do not reconstruct unsupported history. If opening stock cost is unverified, show incomplete valuation and defer cost-dependent discounts rather than assume zero. Explicitly confirmed free stock may have known zero cost.

Resellable returns must reverse original assigned COGS and restore the same cost value into current inventory valuation. Damaged returns reverse original sale revenue/COGS but do not restore sellable quantity; their recovered original cost is recorded as an inventory loss so loss reporting remains consistent. A future valuation adjustment must account for this atomically. Supplier returns need an explicit cost basis/original receipt policy, and direct cost edits need an auditable prospective valuation adjustment if retained. Each is separately reviewable; none retroactively changes completed sales.

For new complete records:

```text
gross list sales = retail price snapshot × base quantity
automatic discount = gross list sales − automatic-price subtotal
net sale revenue = gross list sales − automatic discount − manual discount
net revenue for period = completed-sale revenue − original allocated return revenue
net COGS for period = assigned sale COGS − assigned returned COGS
gross profit = net revenue − net COGS
gross margin = gross profit / net revenue × 100, only if net revenue > 0
```

Track return adjustments to gross/discount/net separately so totals reconcile. Show both gross and returned quantities. Inventory losses remain separate from gross profit, and operating expenses/net profit remain out of scope. Where any cost is missing, preserve the existing covered-revenue approach with visible coverage rather than imply a complete gross-profit figure. No new taxes, tax rates, or currency conversion are part of this plan. Snapshot currency prospectively; unknown historical currency needs an explicit decision.

### Proposed return and cancellation policy (C09)

Preserve the existing original-sale link and lock-protected quantity cap. Extend returns to identify original line/components, their remaining quantities, their original net revenue/discount allocation/assigned COGS, disposition and authenticated actor. Legacy returns continue using their original existing snapshots; missing price/cost is not invented.

Proposed partial-box rule: **do not reprice the items the customer keeps**. Return the original net per-piece allocation, including its share of manual/automatic discounts. Allocate nondivisible box amounts deterministically at original sale time; return from the original component allocation in a fixed order, showing the result before confirmation. A final full return must exactly exhaust original refund and COGS totals. This requires approval because alternative policies could claw back the wholesale discount.

Capture `resellable` or `damaged/unsellable` disposition. Only resellable quantity generates `return_in`. Damaged return records still consume the sale's returnable quantity and refundable allocation; do not calculate the cap solely from restocking movements. Avoid a return-in-then-damage sequence outside a single transaction, which temporarily exposes unavailable stock.

Use an append-only cancellation/reversal record for completed new sales rather than deletion. Before completion, cancelling a draft has no stock effect. After completion, cancellation uses original allocations and idempotent stock/cost reversals; prevent quantities already returned from being refunded/restocked twice. Prevent deletion of new grouped financial movements. Restricting deletion of existing legacy transactions also needs explicit workflow approval and a replacement correction path. Do not delete or rewrite old rows to make them comply.

An inventory return is not proof that money was refunded. Until a payment module exists, distinguish recorded return amounts from actual disbursement; do not show a paid/refunded status that has not occurred.

## D. Minimum architecture changes

### Reuse the existing module and ledger

Keep NestJS modules, PostgreSQL, the tenant transaction wrapper, item locks, stock equation, supplier directory, purchase workflow, stock counts, role workspaces, and profitability calculations. Add a small pure pricing-calculation module alongside the existing calculation files and a checkout orchestration service within the inventory module. No microservice, second inventory system, or general-purpose promotion engine is needed.

The single-product sale screen can adopt the quote/checkout contract first. A multi-item cart then adds UI composition over that same transaction boundary. Wholesale pricing does not require customer-specific price lists, credit accounts, sealed-box inventory, or warehouse selling; those remain separate requests.

### Proposed schema additions

These are logical designs, not an approved schema or executable migration. Final field names/types and generated contract changes should be reviewed in the corresponding implementation phase.

| Structure | Minimum additions | Existing-data treatment |
|---|---|---|
| Company feature controls (C02) | Hybrid enablement/allowlist and independent manual-discount/payment switches; server-side emergency stop | Off for every existing company; do not infer from `businessType='wholesale'` or `'mixed'` |
| Item pricing (C03–C04) | Optional per-item active configuration/version, package label/base size/whole-package price, tier rows keyed by item/version/minimum quantity | No configuration means exact current retail behaviour; no package size guessed |
| Sale header (C05–C06) | Company, location, actor, completion timestamp/business date, currency snapshot, stable sale ID, client idempotency key and payload hash, totals | Only newly created checkouts use this table; do not synthesize historical documents |
| Sale line (C05) | Parent sale, item, base quantity, entered quantity/unit, configuration and package snapshots, retail/gross/automatic/manual/net totals, cost basis/coverage | New records only; preserve historical item/price/cost values independently of future edits |
| Stock movement extensions (C05/C10) | Nullable sale-line link, pricing category, exact component allocation references, gross/discount allocation and cost-provenance fields where needed | Null on existing rows; keep existing `quantity`, `unitPriceCents` and `unitCostCents` meanings |
| Discount policy/approval (C07) | Company policy/version, actor limits/capability, one-use checkout-bound approval and audit references | Disabled/unset initially |
| Cost provenance and optional valuation checkpoint (C08) | Verified/missing/unknown origin, verification actor/time; future carrying-value precision/residual and effective checkpoint if approved | Do not mark all zeros known or backfill old snapshots; do not introduce a second authoritative stock balance |
| Return/reversal header and allocations (C09) | Original line or legacy movement link, actor, reason, quantities, original financial allocations, disposition, idempotency, reversal links | New records; legacy sales supported by original movement ID, including null cost/price |
| Payment/receipt records (C11, later scope) | Provider identifiers and event uniqueness, tender state, reconciliation, receipt number/issued snapshot | No fake payment rows for old sales; no retrospective receipt numbering without approval |

All new financial/configuration tables must have company-scoped relationships, unique company/id combinations where referenced, explicit runtime grants, RLS, and nonnegative/bounded amount checks. Uniqueness must prevent repeated idempotency keys, repeated provider events, and duplicate component links. Foreign keys must not allow another tenant's item, sale, approval or return to be referenced. Keep references to completed financial records restrictive, not cascade-delete from catalog maintenance.

Aggregate constraints such as “sum components equals line total” require transaction-level application checks and integration tests, supplemented by database constraints where practical. A simple column check cannot validate sums across child rows. Approval/cost state must be read from the server, not trusted from a client flag.

### Exact-price compatibility: preserve the existing unit-price invariant

The current API, snapshot, sale table, profit calculation and CSV assume:

```text
movement revenue = movement.quantity × movement.unitPriceCents
```

For 15 pieces at 185.00, a single price per piece would be 12.333…; for a carton of 24 at 100.00 it would be 4.1666…. Rounding one average price and multiplying it back would corrupt revenue/refunds. A new line-total field alone would also leave existing readers wrong.

**Recommended compatibility design:** a logical sale line owns several exact-price component movements. Each movement retains integer base quantity and an integer actual charged unit price. For a 15-piece line, one component can hold 10 pieces at 12.00, another 5 at 13.00. For 24 at 100.00, deterministic allocation gives 16 pieces at 4.17 and 8 at 4.16; both retain the `box` pricing category. Manual discounts can split a component into exact-cent bands the same way. Store allocation order so partial refunds remain deterministic.

This splitting is a financial representation, not separate stock. A line must never write both 15 units at the parent and its 10+5 component deductions. Component quantities, gross amounts, automatic discounts, manual discounts, net revenue and COGS must add to the logical line and sale exactly. With repeated boxes, allocate each original package total consistently and retain enough grouping to refund a whole package for exactly its original amount; do not invent a rounded package unit price later.

Existing sale arithmetic can continue summing the component movement rows correctly. New sale UI and receipts group rows by header/line. Legacy views may show multiple priced rows for one newly enabled checkout, so clients that depend on one-row-per-sale counts or movement IDs must be upgraded before using pilot products. Reporting cannot call the count of movement rows the count of transactions. New damaged-return financial records also require compatible readers because no sellable-stock movement represents their revenue reversal.

The same issue applies to higher-precision future costing. Either allocate cost cents into compatible movements with recorded exact COGS bands, or introduce an explicitly versioned exact-total read contract. Never leave old readers calculating rounded unit cost times quantity while claiming exact new COGS. Design and test that representation in C08 before activating improved valuation.

An alternative single ledger movement with a new authoritative total is possible, but it would require changing all readers and versioning legacy exports. It is not recommended for the first release because this checkout already depends widely on unit-price multiplication.

### API and frontend changes

Keep current routes and payloads for unconfigured products. New routes should express new capabilities, for example:

| Proposed route | Responsibility |
|---|---|
| `GET/PATCH /inventory/items/:id/pricing` | Administrator reads/validates/versions product package and tier configuration |
| `POST /inventory/sales/quote` | Authenticated quote of base quantities and exact pricing breakdown; no stock mutation and no guarantee of availability |
| `POST /inventory/sales` | Idempotent, atomic single- or multi-item completion with expected quote/rule versions |
| `GET /inventory/sales/:id` | Return the durable result after uncertain response; scoped to tenant and permitted shop |
| `POST /inventory/sales/:id/returns` | Authorized original-allocation return with disposition and idempotency |
| `POST /inventory/sales/:id/reversals` | Authorized append-only completed-sale correction |
| `POST /inventory/discount-approvals` | Later optional, authenticated checkout-bound financial approval |

These names are illustrative; align with repository conventions when approved. Preserve the existing sale role/location restriction unless a separate business requirement approves administrators/managers/warehouses selling.

Do not automatically enable hybrid pricing inside old `/inventory/movements` calls. An old client may have displayed retail and omitted its optional expected-price field. For an explicitly enrolled product with hybrid active, the legacy sale route must reject with a clear conflict directing the user to the supported checkout; it must not silently charge a different price or bypass configured discounts. This is an intentional, opt-in behaviour change requiring integration review. Unconfigured products keep the old route and exact existing behaviour. Upgrade relevant clients before enrolling their products.

Apply the same protection to other legacy entry points: reject direct `return_in` against a new grouped sale component and direct deletion of its linked movements. Require the new return/reversal service, which sees both resellable and damaged allocations, to prevent bypassing the cumulative cap or restoring stock twice. These protections continue after feature deactivation. Every new financial record must have one authoritative mutation path; exposing child movement IDs must not create an alternative refund route.

When the feature is disabled, force any outstanding hybrid quote to conflict; require a newly reviewed retail quote before completing a new retail sale. Do not reinterpret a previously confirmed transaction or silently convert its pending intent. Continue reads/returns/reversals for already completed hybrid sales with a compatible backend.

Reuse `AdminItemsPage` to add an optional pricing editor, `ShopSalesPage` for quantity conversion/quotes, `MovementsPage` for clear correction/return entry, `StockCountsPage` for reconciliation, and `ProfitabilityPage`/report components for category breakdowns. Keep supporting copy limited to real consequences, such as base-unit conversion, stale quote, approval required, or unknown cost. Keep the existing retail screen simple when the product is not configured.

Show one authoritative total and an expandable pricing breakdown for mixed lines. Separate a successful write from a failed refresh in `InventoryProvider`; retrieve the committed sale by key/ID and show that result. Do not invite a new deduction because a refresh failed. For eventual cart UI, one checkout request must replace repeated per-item `addMovement` requests.

No visual redesign is proposed in this assessment. During implementation, compare affected desktop/mobile screens with the repository's applicable design references and inspect unnecessary copy and motion timing as required by `AGENTS.md`.

### Reporting and security changes

Extend `buildProfitability` with an explicit new-record path and unchanged legacy fallback. Pricing category belongs to the original component: `retail`, `bulk`, or `box`. The line itself can be `mixed`; do not attribute its entire amount to each category.

Group quantities/revenue/discount/COGS by original component category and date, and allocate returns to those same categories. Reconcile category sums to line totals and period totals. Calculate stock and valuation once per item/location before joining category aggregates; otherwise a box/bulk/retail join can triple-count stock. Keep legacy unclassified/missing-price/missing-cost coverage visible instead of inferring categories from today's package size. Do not label an old sale “retail” merely because no pricing category was stored.

For new returns, the return financial allocation is the authoritative revenue/COGS reversal; its optional restocking movement affects stock. Reports must not subtract both records. Legacy returns without a new financial allocation retain the existing movement-based fallback. This also allows damaged returns to reduce revenue without increasing sellable stock. The new detailed export must carry both financial and stock effects with their linking IDs; the legacy movement CSV remains a stock-ledger export and cannot promise complete new refund reporting by itself.

Preserve the current CSV/archive contract for consumers; add a versioned detailed export with headers, lines, components, returns, discounts, currency and provenance. Export new tables in a new workspace archive version rather than omit them or silently redefine `stockledger-workspace-v1`. Existing CSV sums remain numerically correct through exact-cent component movements, but document its movement-row granularity. Preserve tenant boundaries and owner-only financial access.

Store sale, receipt, return and approval actor IDs directly and write auditable financial actions in the same database transaction. Keep cost/limit enforcement on the backend. Review existing attendant snapshot exposure: current item records include cost fields even though the attendant UI does not display them; do not expand that exposure through quote margin details. Changing existing payload visibility needs a deliberate compatibility/security decision.

Extend workspace export and owner-confirmed workspace deletion to handle new restrictive relationships in the correct order. Test that ordinary catalog archiving, sale correction, or migrations cannot call or imitate workspace deletion.

### Payment boundary, if approved later (C11)

The initial enhanced checkout records an inventory sale just as today. A sale summary is not a payment confirmation. Confirm how businesses currently take payment outside this application before designing a tender workflow.

If integrated payment is required, first design a durable order/reservation and payment state machine with idempotent provider operations, unique webhook/event IDs, and reconciliation/outbox processing. Stock availability must be reserved or otherwise atomically committed before promising fulfilment; expiration/release must be idempotent. A reservation would be a new availability concept, not a second inventory balance, and cannot be added casually.

Do not keep a database transaction open across a provider request. On payment initiation/authorization followed by stock-commit failure, recover the same order, determine actual provider status, and void authorization or refund a captured amount through an auditable compensating action. Do not blindly retry a charge or mark a refund complete on an uncertain response. Do not leave both reservation and completed sale deducting availability. A crash after commit but before responding must return the same order/sale through the idempotency lookup. Until that design is approved and tested, no payment integration is included in hybrid rollout.

## E. Migration and backward-compatibility plan

### Non-negotiable data invariants

1. Do not delete, reseed, truncate, reset, re-unit, or bulk reprice existing products, openings, purchases or movements.
2. Do not alter the quantity, price, cost, date, or recorded amount of a completed historical sale. Leave legacy missing fields missing.
3. Do not auto-enable pricing from business type, unit text, current cost, or existing stock amount.
4. Add optional configuration and nullable links for existing rows. Do not make legacy rows satisfy new snapshot requirements by inventing values.
5. Introduce strict new-record validation through the new paths, with schema constraints that explicitly allow unchanged legacy rows.
6. Treat costing precision, cost verification, negative-stock remediation and unit conversion as separate approved reconciliations. A pricing migration is not permission to perform them.

### Read-only staging readiness audit

Before writing a customer-data migration, obtain an approved snapshot/export in a development or staging environment with appropriate access controls. Record the source deployment revision and actual applied migration list. Establish per-company/item/location closing quantities, record counts, sale/refund amounts, nullable snapshot coverage and current valuation totals. Retain hashes or immutable extracts for completed financial fields and compare them after each rehearsal.

Audit at least:

| Data condition | Required handling |
|---|---|
| Legacy unit is `carton`, `box`, ambiguous text or has been edited | Business verifies what one stored unit means. Keep unchanged until an explicit conversion/reconciliation plan is approved |
| No package size | Leave hybrid off; ordinary retail still works |
| Missing historical sale price/cost | Retain unavailable values and coverage; original-amount refund may require manual reviewed evidence |
| Zero current cost | Ask whether verified free, estimate, or unknown; no blanket zero-to-known migration |
| Old purchases without actual costs, direct cost edits or deleted receipts | Opening valuation needs business evidence; do not replay current catalog costs as acquisition history |
| Negative stock or archived nonzero per-location positions | Reconcile deliberately before pilot; current archive check is company-wide total, so offsetting positions should be examined |
| Legacy unlinked returns | Keep history; do not manufacture original sale links |
| Currency changed since a sale | Current currency label is not proof of original currency; retain uncertainty and approve any forward checkpoint |
| Future/backdated movements | Confirm report and valuation dating policy; no retrospective repricing or automatic chronological recosting |
| Integrations using one-movement-per-sale, old CSV, or direct API sale calls | Inventory usage, upgrade client support before opt-in, and verify both API versions |

Source alone cannot answer how prevalent these conditions are. A pilot can use products whose data is verified without requiring a speculative global reconciliation.

### Migration/high-risk change register

For every M/H proposal, the table specifies impact, required validation, sequencing and recovery. C01 is test-only and needs no migration. Codes retain their meaning from section B.

| Change | Impact and risk | Required tests | Deployment sequence | Recovery |
|---|---|---|---|---|
| C02 (S/M; activation B/H) | Feature controls and product enrollment; stale clients/quotes may otherwise bypass pricing | All flags off equals existing responses/totals; tenant and product scoping; kill switch during quote/commit; legacy client conflict only on opted-in products | Add controls default off; deploy server reader/enforcement; deploy capable client; opt in selected products last | Turn off new hybrid writes, invalidate pending quotes; keep compatible readers and return handling; retain configuration/history |
| C03 (S/M; unit conversion excluded B/H) | Optional package/tier relationships; danger of multiplying existing quantities | Populated upgrade preserves every quantity; invalid/duplicate sizes and tiers rejected; tenant FKs/RLS; edited units blocked/reviewed for enrolled items | Add optional structures and constraints; validate pilot base unit; administrator configures future pricing | Disable item pricing, retain structures; no reverse multiplication or rewriting openings |
| C04 (S/M/B/H on opt-in) | New price precedence and snapshots; can change charges | Supplied examples, boundary/property tests, multiple tiers, stale version, zero/unset price, overflow, fractional-cent package allocation | Calculator/quote behind flag; store versioned config; shadow comparisons; sale activation only after exact snapshot path | Stop new hybrid sales; require refreshed retail review; completed snapshots remain readable/refundable |
| C05 (M/B/H) | New header/line links and multiple movement components; atomic cart/stock correctness | One stock effect, all-or-nothing multi-item failure, sorted locking, integer allocation sums, old/new read parity, original line grouping | Add nullable links/tables; deploy dual-compatible readers/exports/return support first; deploy writers; activate | Stop new path; retain compatible backend and additive schema; never delete new movements or roll back to an incapable reader |
| C06 (S/M/H; negative policy B) | Idempotency uniqueness, transaction/isolation and no-negative enforcement | Concurrent same-key requests, changed payload, timeout after commit, rollback before commit, price/cost race, final-stock race, flag/setting changes | Confirm transaction semantics in staging; unique indexes before writers; upgrade new-path clients; enroll no-negative companies | Disable new writer; keys/results remain queryable; leave successful sales intact; preserve legacy policy outside opt-in |
| C07 (S/M/B/H) | New discount limits/approvals can alter revenue and permissions | Permission forgery, limit boundaries, one-use approval races, cart/version changes, percentage rounding, stacking conflicts, below/unknown cost | Schema/policy disabled; backend and audit; approval UI; selected-role enablement only after business sign-off | Disable discounts without disabling sale reads; existing allocated charges/refunds stay fixed |
| C08 (M/B/H) | Provenance, precision/carrying values and prospective corrections affect valuation/COGS; all mutation paths must agree | Decimal/residual conservation, changed receipt cost, true-zero vs unknown, return after average changes, supplier return, direct adjustment, purchase deletion/reversal, negative balance, processing date policy | Separate approved release; approved valuation checkpoint; stage every purchase/sale/return/count/adjustment hook; reconcile shadow values before activation | Disable cost-dependent new operations if integrity uncertain; keep compatible valuation writer/reader. Do not switch blindly to old rounding after writes; use an audited prospective checkpoint/correction |
| C09 (M/B/H) | Return disposition/allocations/reversal; restricting deletion changes staff workflow | Concurrent/duplicate partial returns, full refund sum, mixed/box/manual discount return, damaged return with no sellable increment, already-returned cancellation, linked FK protection, legacy null snapshots | Expand records; deploy original-allocation reads and write protection; train replacement correction flow; enable returns before any pilot sale that would need them | Stop new refund/reversal writes if necessary, preserve inquiry and originals; use compatible release and audited corrections; never delete returns to undo a refund |
| C10 (S/M/H) | New category/discount/coverage calculations and exports affect business financial interpretation | Category sums equal net sales/COGS, no join-multiplied stock, partial legacy coverage, returns across periods, old exports unchanged, new archive round-trip completeness | Dual-format backend/readers first; compare baseline known data; expose category views only with accurate snapshots | Hide new reports/export version; keep old compatible views; retain all source records; fix calculation forward |
| C11 (S/M/B/H; separately approved) | New tender/refund/receipt state and external effects; financial correctness and customer funds | Provider sandbox, duplicate/out-of-order events, timeout/uncertain charge, insufficient stock after authorization, crash/reconciliation, receipt uniqueness | Scope business flow; schema/state machine; sandbox; reconciler before live provider enablement; separate production approval | Disable new payment initiation while reconciliation/refund handling continues; resolve outstanding provider states by durable IDs; never assume rollback reversed external money |
| C12 (S/B/H) | Release/migration gating, observability and mixed-version operation affect availability | Old binary with expanded schema, restored backup, bounded migration lock wait, populated upgrade, flags off/on, stale browser, monitoring alerts, minimum-compatible rollback rehearsal | Remove uncontrolled migration/deploy trigger risk through an approved release process; rehearse staging; expand first; compatible backend; frontend; pilot activation | Kill new writes, redeploy minimum-compatible release, keep expansion. Fix forward. Backup restoration only as an explicitly approved incident action with later-transaction recovery |

New tables/columns can still acquire locks or cause privilege failures. Inspect the generated migration operations and SQL before approval; do not assume a default or check constraint is cheap on actual table sizes. Prefer additions to small/new tables; nullable links on existing large tables; indexes built with an appropriate online strategy when needed; staged constraint validation if supported by the migration tooling. Set bounded lock/statement timeouts and schedule a low-traffic window where a required DDL lock cannot be avoided. Abort/retry rather than wait indefinitely behind live sales.

Do not assume the ORM supports online DDL or transaction options without checking the installed version during implementation. Keep generated `contract.prisma`, `contract.json`, `contract.d.ts` and migration snapshots consistent through the repository's tooling. Do not edit or regenerate already-applied migration history.

### Deployment sequence and transactions in flight

1. **Development:** review this plan/business policies; add baseline tests; implement one stage at a time. Use a feature branch and development resources. A local implementation approval does not authorize deployment.
2. **Staging:** restore an approved representative snapshot. Run expand migrations, verify immutable-field checks and totals, exercise legacy/new browsers concurrently, restore a backup into a separate environment, and rehearse rollback. Use no live payment endpoints.
3. **Production approval:** present exact reviewed migrations, measured lock duration/table sizes, backup/recovery evidence, chosen pilot companies/items, monitoring thresholds and a rollback owner. Obtain explicit deployment approval before pushing/releasing through any production-connected automatic path.
4. **Expand schema first:** add only compatible optional tables/fields/indexes and tenant grants/policies with features off. The old application continues to read/write current fields during this step. Run migrations once through a coordinated release job, not concurrent unreviewed builds.
5. **Deploy compatible backend:** it reads both legacy rows and new snapshots, rejects unsafe bypasses for enrolled products, and can process returns/reversals for new sales. Confirm old clients still work for all unconfigured items. Deploy the new frontend afterward; independent API/web auto-deploy order cannot be assumed safe.
6. **Enroll under the item lock:** verify package units, stock policy, supported clients, cost readiness and return capability. Assign the new rule version. A sale holding the lock before enrollment completes under its original retail path; a later old-path request sees enrollment and conflicts. A new quote created before an edit must be revalidated after the edit.
7. **Pilot:** enable a small selected set of products/shops with explicit review. No global catalog rewrite or backfill. Keep flags off elsewhere. Compare exact daily quantities/revenue/discount/COGS and return coverage to source snapshots.
8. **Expand gradually:** enroll more only after the acceptance/monitoring criteria hold. Keep schema expansion and compatible readers through the agreed observation period; no destructive contract step is needed for this feature.

The enrollment rule and price edit must use the same item lock as stock operations. For company-level kill switches or policy changes, define a consistent locking/version check order so an in-flight sale has a clear commit boundary; do not promise that toggling a flag cancels an already committed sale. Drain/review in-flight work before hard-stopping writers. New checkouts retry with their original idempotency keys after worker restarts.

### Monitoring and recovery

Reuse existing request IDs, exception reporting, readiness endpoint and optional Sentry. Add structured signals for quote/version conflicts, stock conflicts, key replays/payload conflicts, duplicate provider events (later), approval denials, transaction rollbacks, lock waits/deadlocks, missing-cost coverage, and reconciliation discrepancies. Include sale/company/item IDs with appropriate access controls, not credentials or customer payment details.

Any unexplained mismatch between a checkout's allocated totals and movements, duplicate business completion, unapproved negative pilot stock, or cross-tenant access blocks expansion and disables the affected new writer. Monitor errors/latency against a measured staging and pre-pilot baseline; agree numerical latency/availability thresholds before production rather than invent them without measurements.

Operational rollback primarily disables **new hybrid writes**. It must preserve reads, original-price returns and corrections for completed hybrid sales. The earliest safe rollback binary is the dual-compatible reader/writer release; the pre-feature binary is not a safe general rollback once new financial records exist. Turning flags off does not erase or reprice completed sales.

Never restore a whole production database merely to remove this feature: that could discard valid retail transactions occurring during rollout. Use forward fixes and auditable compensating records. A genuine database disaster requires an explicitly approved point-in-time recovery plus a plan to preserve/reconcile transactions after the recovery point, not a routine down migration. Test recovery in staging before rollout.

## F. Incremental implementation roadmap

The phases below begin only after this assessment and proposed solution are reviewed and explicitly approved. Each stage should be independently reviewable and testable; do not combine all database and POS changes in one release. “Acceptance” is a gate, not a claim that the feature is implemented.

| Phase | Dependencies / risk / migrations | Backend and frontend tasks | Tests and acceptance | Rollback |
|---|---|---|---|---|
| 0. Protect and characterize current behaviour | Approval of discovery findings; C01/C06/C12; no business-data migration | Add missing regression cases; distinguish committed write from refresh failure; confirm isolation; inventory API/client usage; document critical screens. No pricing UI yet | Current 76 unit + 39 integration tests continue passing; add HTTP DTO/role tests and writable sale/return browser path using isolated fixtures; reproduce/characterize existing limitations without silently fixing financial policies | Revert test-only/compatible local changes; no customer-data action |
| 1. Readiness, flags and configuration | Phase 0; C02–C04; additive config migration | Add tenant/product gating, versioned package/tier validation and administrator editor. Keep sale execution retail-only and feature disabled | Populated-snapshot upgrade changes no existing financial fields/balances; flags-off parity; rule/unit validation; tenant RLS and grants; old clients work. Config creation alone never changes stock | Disable flags, retain config tables; existing retail path continues |
| 2. Calculator and quote preview | Phase 1; C04; no extra migration unless reviewed quote/config fields require it | Pure exact-arithmetic calculator; quote endpoint; selected product preview including entered units/base conversion. No hybrid completion yet | All supplied examples and edge boundaries; property tests for sum/rounding/determinism; no stock effect; permission and quote-version checks; desktop/mobile review of breakdown | Disable preview; no completed hybrid records yet |
| 3. Durable sale records and atomic completion, still disabled | Phase 2; C05–C06/C10/C12; additive header/line/link/idempotency migration | Implement single-product new checkout first, same service capable of a cart; exact-cent component writes; sale lookup; dual-compatible snapshot/profit/export readers; new actor audit. UI reconciles uncertain completion by key | Race/idempotency/fault-injection tests; item-lock order; one stock effect; header/line/component invariant checks; legacy export parity. No activation until return support below is ready | Disable new writes; keep compatible reader release/schema |
| 4. Cost readiness and prospective valuation corrections | Phases 0/3 design; C08; separately reviewed provenance/checkpoint/precision migration if approved | Verify costs for pilot items; implement chosen residual/precision and return-value treatment across **all** company/item stock writers, including legacy purchase/return/count paths; audited cost corrections. No separate stock balance | Known/zero/unknown cases; repeated rounding; original-cost returns after a new average; supplier return/cancellation; direct-cost correction; aggregate value conservation. Pilot cannot claim complete profit/valuation until this passes | Stop affected cost-dependent writes; retain compatible cost support and checkpoint; forward correction only |
| 5. Original-allocation returns and reversals | Phases 3/4; C09; additive return/reversal/disposition records and approved deletion protection | Implement partial/full component returns, disposition, idempotent corrections; support legacy original movement references; replace destructive correction controls where approved | Original refund/cost sum exactly conserved; concurrent return cap; no sellable stock from damaged returns; already-returned cancellation; no duplicate refund/restock; legacy null snapshots preserved. Returns ready before pilot selling | Disable unsafe new correction writes, preserve originals/inquiry; use compatible backend |
| 6. Optional automatic-pricing pilot | Phases 1–5 and explicit production approval; C02–C06/C08–C10/C12; no backfill | Activate selected verified products; use quote/complete flow in `/sell`; add grouped sale summary and category reports/exports; keep manual discounts off | Existing retail remains unchanged elsewhere; supplied quantities charge expected amounts; daily totals reconcile; stale browsers/price changes safely conflict; safe disable/read/return rehearsal succeeds | Server kill switch for new hybrid sales; refresh retail quotes; preserve hybrid returns/readers |
| 7. Authorized manual discounts | Phase 6 and approved business limits/stacking/below-cost policy; C07; additive policy/approval fields/tables | Introduce fixed/% line discounts first, approval and audit UI; later transaction allocations once a cart exists | Limits/approver permission/approval replay, exact-cent allocations, stacking rejection, unknown/below cost, stale cost after purchase; approved example receipts/returns reconcile | Disable new manual discounts; keep original allocations for reporting/returns |
| 8. Multi-product UI and broader reporting | Phase 3 transaction boundary, validated pilot; C05/C10; only separately reviewed extra fields | Extend `/sell` with a cart; aggregate same-product entries; one atomic checkout; category/date filters and versioned complete exports | Insufficient stock or invalid quote on any item writes nothing; duplicate item aggregation; independent products concurrent; stock not multiplied by category joins; desktop/mobile critical paths | Disable cart UI/new writes; compatible single-product new path and history remain |
| 9. Payment/receipt expansion, if requested and approved | Scope decision, phase 8, C11; new payment/reservation/outbox/receipt migrations | Confirm real payment process; design and implement provider sandbox, durable states, reconciler, refund handling and receipt snapshots | External failure scenarios, event replay, lost response, reservation conversion/expiry, payment versus sale reconciliation, exact original refunds. Separate explicit production/provider approval | Stop initiation; keep reconciliation/refund workers; recover outstanding states through durable IDs |

Phase 4 is not permission to switch costing globally. Its final scope depends on the approved valuation policy and actual pilot data. If full future valuation accuracy is deferred, the release must explicitly limit its claims, retain cost-coverage disclosures, and leave affected cost-sensitive discounts/returns disabled rather than imply all requirements are satisfied.

### Critical regression and new-feature test matrix

Reuse Vitest, the separate-pool PostgreSQL harness, Nest HTTP tests and Playwright. Do not replace concurrency tests with mocks. Add tests in stages before their corresponding feature code, using expected business outcomes rather than mirroring helper implementation.

| Area | Existing protection | Required additional coverage |
|---|---|---|
| Legacy retail | Price snapshot preservation, unset/zero selling price, stale displayed price, administrator pricing | Unconfigured products unchanged with all feature combinations; endpoint payload compatibility; committed-write/refresh failure; repeat submission currently characterized, then new-path idempotency |
| Quantity/inventory | Per-location balances, transfers, overdraw conflict, opening/import rollback | Every pricing composition deducts precisely base quantity once; conversion overflow; zero/negative/fractional quantities rejected server-side; multi-item all-or-nothing and deterministic locking |
| Purchases/cost | Receipt cost/supplier and basic weighted average | Variable costs after partial sales, fractional average residuals, purchase concurrency with quote/sale/return, true-zero vs unknown, backdated receipt behaviour, supplier return and deletion/correction |
| Pricing | DTO and single-price arithmetic tests | All supplied examples; `threshold−1/threshold/threshold+1`; `box−1/box/box+1`; several boxes; no package/no tier; multiple qualifying tiers; invalid tier sets; component category/amount conservation |
| Manual discount | None | Fixed/% bounds and rounding; line/transaction allocation; limit and approval attacks; stacking conflict; zero revenue; below/unknown cost; changed quote/cost invalidates approval |
| Returns | Original price/cost, cumulative over-return protection, profit subtraction | Concurrent return attempts; idempotent lost response; mixed/partial box component allocation; full-return cent conservation; cost increase before return; damaged disposition; return then cancellation; legacy missing price/cost; original sale/configuration immutability |
| Reports/exports | Legacy cost coverage, damage/count losses, role/tenant export access | Mixed categories without double counting; transaction versus component count; returns crossing report periods; future date policy; incomplete-cost warnings; versioned archive includes all new tables; current CSV unchanged |
| Security | Tenant RLS/FKs, shop restrictions, demo protection | Pricing/approval/return/sale tables under runtime role; cross-tenant links rejected; approver authority distinct from manager role; direct client price injection; old-route bypass for enrolled products |
| Operations | Transaction rollback, lock contention, parallel products | Faults before/after commit and after success before refresh; key collision/replay; timeout retry; migration with old app active; feature toggle in flight; populated-data upgrade; backup restore and minimum-compatible rollback |
| Browser | Authentication/demo/mobile table tests | Writable isolated attendant sale, price conflict, purchase→transfer→sale→return→profit journey; hybrid breakdown; uncertain response; box/base entry; approval/return UI; mobile and desktop |

Existing integration tests primarily call the service directly, so they do not alone prove global HTTP DTO validation or full browser checkout. The current Playwright suite emphasizes authentication, demo protection, legal pages and responsive tables; it is not a writable POS regression suite.

### Required edge cases: expected versus current behaviour

Amounts below use the request's example configuration, not the current catalog. “Current charge” assumes an item with retail 15.00 and sufficient stock. Current stock-policy exceptions are stated where applicable.

| # | Scenario | Expected proposed behaviour | Current system behaviour | Change needed |
|---|---|---|---|---|
| 1 | Buy 19 pieces; box size 10 | 120 + 9×13 = **237**; deduct 19 base units | 19×15 = 285; deducts 19 | C03–C05: decomposition, mixed snapshot, quote |
| 2 | Buy 25 pieces with box and bulk pricing | 2×120 + 5×13 = **305**; deduct 25 | 25×15 = 375 | C03–C05 |
| 3 | Request 20, only 15 remain | Reject whole sale; no partial deduction/payment side effect | Rejects when negative-stock setting is off; API can allow it when on; browser caps quantity | C06: approved no-negative rule and pilot eligibility; preserve legacy setting outside opt-in |
| 4 | Two cashiers sell last pieces simultaneously | Serialize, only available quantity commits; loser gets conflict; no duplicate business request | Shared item lock and tested races already provide overdraw protection when setting off | Reuse current lock; add new checkout/rule/idempotency race tests (C05–C06) |
| 5 | Supplier cost rises with old stock remaining | Purchase snapshots actual cost; future moving average changes; prior sale COGS fixed | Already does purchase-weighted average across company locations, rounded to cents | Reuse method; C08 for precision/provenance/reconciled carrying value |
| 6 | Partially return a discounted sale | Original net allocation and original cost; cumulative exact cap; chosen disposition | Linked flat-price original snapshot return supported; no discounted/mixed allocation; every return restocks | C09 and C08; approve no retained-item repricing |
| 7 | Manual discount on wholesale line | Default reject stacking; allow only explicitly configured/authorized combination | No manual or wholesale discount path | C07; separate policy enablement and audit |
| 8 | Discount makes price below cost | Enforce approved block/override using known assigned cost; unknown cost does not mean zero | No below-cost check; ordinary price may already be below current cost | C07–C08; scope new policy to approved workflow rather than change legacy silently |
| 9 | Product has no box setup | Retail; bulk only if separately configured/enabled | Retail-only already works | Preserve fallback; no package migration/backfill |
| 10 | No known acquisition cost | Sale revenue/quantity can remain available under approved policy; profit/valuation incomplete; cost-based discounts restricted | Missing old snapshot excluded from costed profit; current item zero can be treated as a known recorded cost | C08/C10: provenance, explicit coverage and exception decision; no invented cost |
| 11 | Box size/price changes after sale | New quotes use new version; old amounts, quantity conversion and returns remain original | Retail unit-price snapshots already persist; no historical box data | C03–C05/C09: package/configuration snapshot and version |
| 12 | Cancel/reverse completed transaction | Append audited reversal of original remaining amounts/quantities; account for prior returns; payment reconciliation if applicable | Authorized staff can delete movement (subject to balances/FKs), changing history; no payment reversal | C09; behaviour-changing correction workflow, no mass legacy rewrite |
| 13 | Different products in one cart | Price each independently; lock deterministically; one atomic completion; failure on one commits none | No cart; separate movement requests would be separate sales with possible partial completion | C05/C06/C10; backend first, cart UI phase 8 |
| 14 | Theft/damage/expiration adjustment | Audited count/write-off at known current cost; preserve losses and movements | Damage and protected stock-count adjustments exist; reason policy configurable | Reuse; C08 for value conservation, C01 new-operation regression |
| 15 | Historical stock with no package size | Keep current unit, quantity, pricing and history; hybrid stays off until verified/configured | Already stores opening/movements with free-text unit and no numeric package | C03 only optional config; any re-uniting is separate B/H reconciliation |
| 16 | Payment starts, sale fails before stock finalization | Same durable order recovered; no double charge; void/refund as actual provider state requires; no unearned stock deduction | No payment initiation/integration found; current DB writes roll back atomically; lost response still creates retry ambiguity | C06 for current retry safety; C11 only after separate payment design/approval |
| 17 | Quantity qualifies for multiple tiers | Highest eligible minimum tier; all remainder pieces at that price; if no box configuration, use whole line; no cumulative tiers | No tier calculation | C04; threshold validation and boundary tests |
| 18 | Manual discount conflicts with automatic promotion | No implicit stacking; reject with actionable reason unless approved combination policy applies; snapshot allocation | No promotion/manual functionality found | C07; reuse automatic-price stage, no second promotion engine |

### Business decisions requiring explicit approval

These decisions should be resolved before their dependent implementation phases; they do not prevent review of the rest of the architecture.

1. **Pricing precedence:** approve full-box-first plus independently tiered remainder, highest qualifying all-units tier, and duplicate-product aggregation. Confirm that the default does not optimize globally for the lowest possible total.
2. **Package scope and existing units:** approve one active package size per product initially, label flexibility, base-unit enrollment checks, and a separate process for any existing carton-to-piece conversion. Confirm whether multiple active carton/box sizes are actually needed now.
3. **Negative-stock setting:** approve the no-negative pilot requirement and the longer-term rule for ordinary sales when a company has deliberately enabled negative stock. No existing setting will be flipped without approval.
4. **Manual discounts:** choose enabled roles, limits, fixed/% scopes, stacking exceptions, manager authority, below-cost override, unknown-cost handling, and approval validity. Default proposal is disabled and nonstacking.
5. **Cost provenance and valuation:** approve how to verify opening costs, distinguish genuine zero, retain company-wide moving average, select precision/residual treatment, handle supplier returns/direct cost edits, and establish prospective valuation checkpoints. No historical reconstruction without evidence.
6. **Partial returns:** approve original allocated per-piece refund without repricing retained pieces, deterministic allocation order for indistinguishable mixed-priced units, resellable/unsellable disposition, and treatment of historical missing price/cost.
7. **Corrections:** approve replacing deletion for new completed sales with append-only reversal, and decide whether/when to restrict legacy movement deletion. Provide staff an approved correction workflow first.
8. **Payments and receipts:** confirm the actual out-of-app payment workflow and whether tender tracking, payment integration, receipt numbering or printing is part of this project or a later phase. Do not infer that recording a sale proves payment.
9. **Reporting policy:** approve gross/list discount definitions, unclassified legacy category and cost coverage, business-date/timezone treatment, future/backdated entry policy, and currency snapshots without retroactive conversion. Tax remains unchanged pending a separate defined requirement.
10. **Pilot and release control:** approve selected businesses/products, client upgrade requirements, numerical monitoring thresholds after measurement, rollback owner/minimum compatible release, and exact production migration/deployment as a separate final authorization.

The recommended first implementation approval is phases 0–2 in development: protect current workflows, add disabled configuration, and validate authoritative quote calculations. Financial write-path, costing, return, payment and production changes should then be approved in concrete, tested stages using the gates above.


## Phase 4B development progress — 21 October 2026

The user selected exact future costs. The [development implementation](exact-costing-development.md) now connects verified per-item checkpoints, durable documented receipts, exact grouped-sale cost allocation, explicit current-value corrections, exact stock-value readers and workspace v4. Existing items are not enrolled automatically. Legacy writers for enrolled items are blocked until compatible; rollout is limited to a synthetic localhost company. The [test report](exact-costing-test-report.md) records the populated migration rehearsal, regression coverage and real TesterArmy checks.

This completes the bounded Phase 4B test workflow, not all of Phase 4's operational coverage. Compatible transfers, damage/count/supplier-return paths and Phase 5 original-allocation returns/refunds/reversals remain prerequisites for a real-business pilot. Production migration, deployment and activation still need explicit approval.


## Phase 4 stock operations and Phase 5 development progress — 21 October 2026

The user continued development and selected disposable local staging. Optional original-allocation customer returns and remaining-unit reversals now preserve historical prices/costs; damaged returns record an equal loss without sellable restock. Exact transfers, damage, stock counts, supplier returns and guarded receipt reversals now cover the enrolled-item operational paths. New requests and records are durable and auditable; the original sale/receipt remains intact. [Workflow and rollout details](returns-stock-development.md) and [validation evidence](remaining-phases-test-report.md) describe this stage.

This closes the earlier Phase 4 operational gap and implements Phase 5 on synthetic development data. It does not activate a real-business pilot or complete phases 6–9. Refund and supplier-credit amounts are recorded without processing payments. Manual discounts remain disabled pending explicit policies; reporting, the cart and payment/receipt expansion remain separate roadmap work. Production migration, deployment and activation are unapproved.
