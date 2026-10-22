# Pricing preview development stage

This implements the first development stage from the [assessment](hybrid-pricing-assessment.md): regression protection, optional versioned pricing configuration, and authoritative quote previews. It does not enable hybrid sale completion. Nothing has been deployed or applied to production or staging databases.

## Delivered behaviour

- Existing sale endpoints still charge the catalog retail price, even when a pricing preview is configured and enabled. Stock, returns, purchase costing and financial calculations retain their existing meanings.
- Pricing previews are hidden by default. An explicit server-side company UUID allowlist enables the administrator editor under Items → Box and quantity pricing. An item separately controls whether its rules apply to previews.
- Administrators verify the existing base unit before saving; no historical quantities are converted or multiplied.
- Each save appends an immutable configuration version, authenticated actor, verified base unit, package conversion/price, bulk tiers and audit event. Expected-version checks and the existing item lock prevent concurrent lost edits.
- Quotes price full packages first, then the highest qualifying all-units tier for the remainder. Without package pricing, tiers apply to the entire item quantity. Duplicate item entries are aggregated first.
- Package input converts to base units. Exact integer-cent component allocations preserve indivisible package totals. Unsafe totals and conversion overflow are rejected. Quotes identify quantity boundaries where adding a unit reduces total cost.
- Quotes return `previewOnly: true` and `canComplete: false`. They do not reserve/sell/deduct stock, assign costs, initiate payment or promise availability.
- A changed item unit invalidates its enabled preview until reviewed. Changed retail prices are revalidated. Administrators can disable a preview even if a retail-price change invalidates its tiers.
- A confirmed successful write followed by a failed refresh now clears the submitted form and reports that it was saved. It does not invite retrying that confirmed write. Uncertain write responses still require the later durable-idempotency phase.
- Tenant transactions explicitly set Read Committed before company context, matching the documented post-lock read contract. Tests also use connections whose default is Serializable.

## Controls and API

`PRICING_PREVIEW_COMPANY_IDS` is a comma-separated UUID list. Empty/unset enables no companies; wildcards and malformed IDs are rejected. Configure only approved development/staging companies. No production configuration is supplied by this branch, and the public demo retains its API write protection.

Removing an allowlisted company stops configuration writes and makes quotes retail-only. A request with an old expected version conflicts and must reload. History remains readable by its administrator. Disabling an item appends a version rather than altering or deleting prior configuration. There is no flag to activate discounted checkout in this stage.

| Method and path | Access and effect |
|---|---|
| `GET /inventory/pricing-preview` | Administrator; reads company preview availability |
| `GET /inventory/items/:id/pricing-preview` | Administrator; latest company-owned item configuration |
| `PATCH /inventory/items/:id/pricing-preview` | Allowlisted administrator; append validated configuration and audit event |
| `POST /inventory/pricing-preview/quote` | Active company member; read-only quote. Attendants require a valid assigned shop; cost/profit fields are excluded |
| `GET /settings/exports/workspace-v2` | Administrator; new complete archive including pricing versions |

Configuration bodies contain `expectedVersion` (0 initially), `previewEnabled`, `baseUnit`, `baseUnitVerified: true`, optional `package: {label,size,priceCents}`, and increasing `bulkTiers: [{minimumQuantity,unitPriceCents}]`. Disabled configurations retain structural validation but can be switched off without first correcting prices invalidated by a retail-price edit.

Quote bodies contain `lines: [{itemId,quantity,quantityUnit?,expectedVersion?}]`. Units are `base` (default) or `package`. A preview may exceed available stock because it does not reserve anything. Limits: 100 inputs, 100 tiers, integer base quantities at most 2,147,483,647, and safe integer-cent totals. Unknown fields, fractional/negative quantities, manual discounts and client-supplied charges are rejected.

Existing routes, archive v1 at `workspace`, and CSV columns remain available. The frontend's complete archive action uses `workspace-v2`. Owner-confirmed workspace deletion includes the new table under its existing guarded deletion context; ordinary configuration updates/deletions are forbidden.

## Migration and recovery

New migration: `apps/api/migrations/app/20261020T2308_add_pricing_preview_versions`.

Classification: **Migration required / safe extension while disabled**. Explicit isolation and confirmed-write/refresh handling are accompanying safety changes. The migration's 12 operations create one table, constraints/indexes/company-scoped foreign keys, narrow runtime grants, and RLS policies. No existing business rows are updated/deleted, no units/costs are recalculated, and no historical values are fabricated.

`item_pricing_versions` references company/item and company/creator using restrictive deletion. Runtime grants allow SELECT/INSERT and DELETE only through the workspace-deletion RLS policy; UPDATE is not granted. Bulk tiers are a bounded, backend-validated JSON array inside each immutable version. No second stock balance or mutable tier hierarchy is introduced.

Before production release:

1. Review the exact new migration and grants. Leave all prior migrations untouched.
2. Rehearse on an approved staging snapshot and verify actual migration/schema state. Local synthetic-upgrade evidence does not validate actual customer records or production lock duration.
3. Measure DDL/foreign-key locking and use bounded deployment timeouts. Leave the allowlist empty initially. Render's current automatic deploy/build-time migration configuration is unchanged; pushing to its deployment branch requires explicit production approval.
4. Apply the expansion first, deploy backend, then frontend. The prior backend can use the expanded schema. The new frontend's complete archive action requires backend support for `workspace-v2`.
5. Verify retail regression flows before selected staging/pilot previews. Production deployment and pilot activation require separate explicit approval.

Recovery for this preview-only stage: remove the allowlist or disable previews, retaining history/schema. There are no completed hybrid financial records to reverse. A coordinated app/backend rollback can restore the old UI/v1 archive action while leaving the new table unused. Do not drop configuration records or restore the database just to disable previews. Later hybrid completion will require a stricter minimum-compatible-reader rollback boundary.

## Validation

Completed checks: 125 unit tests, 55 PostgreSQL/HTTP integration tests, and 14 Chromium browser tests passed. API/web builds, web lint, and migration integrity checks passed. Browser tests passed with retries disabled. Test databases ran only in disposable localhost PostgreSQL resources.

- Unit tests cover all supplied pricing examples, tier boundaries, no-package fallback, unset/zero prices, indivisible cents, conservation/determinism, overflow, boundary warnings, nested DTOs and default-off flag validation.
- PostgreSQL tests cover original price/cost preservation, rejected-purchase rollback, competing returns, preview/retail separation, concurrent version saves, disabling invalidated rules, runtime grants/RLS, immutable history, exports, guarded workspace deletion and explicit isolation.
- The integration runner applies the old schema, creates synthetic legacy stock/purchase/sale/return rows including missing snapshots and carton units, snapshots every existing business table, applies the new migration, and checks all original rows remain identical.
- Built-Nest HTTP tests exercise real authentication, DTO validation and controllers: permission checks, input/stale-version rejection, quote non-mutation, unchanged retail charging, and purchase → transfer → sale → return → profit.
- Browser tests cover default-hidden controls, administrator preview configuration at 1440px and 390px, no preview movement writes, and confirmed-save/failed-refresh form recovery. Browser fixture tests exercise the UI; persistence is covered separately by HTTP/PostgreSQL tests. The existing browser suite is retained.
- Desktop/mobile screenshots were inspected for grid alignment, overflow and unnecessary text. The panel uses one heading, a necessary retail-price limitation, controls and actual results. Existing typography, surfaces and tables are reused; no decorative motion or non-interactive hover was added.

## Remaining work

Sale headers/lines, durable idempotency, atomic completion and persisted pricing components are now implemented behind a separate development-only gate in [Phase 3](sale-completion-development.md). Costing/provenance improvements, damaged/partial returns and reversals, manual discounts, category financial reporting, and payment/receipt workflows remain in later stages of the assessment. Configuring a preview does not enable charging its prices.

## Administrator setup simplification — 21 October 2026

The administrator screen now separates saved pricing from **Try a quantity**. It shows the existing individual price, a choice between individual-only pricing and box/quantity discounts, optional box/carton inputs, quantity discounts, and one **Save pricing** action. The calculator explains the box-first/remainder policy and shows **You save** against the individual-price total. One visible notice retains the testing/development-checkout restriction.

Classification: safe extension to the interface, with a behaviour change to repeated unit confirmation. First-time setup and a saved configuration whose base unit differs from the current item still require an explicit stock-unit confirmation. A saved version for the current unit already records that confirmation; routine price edits and reloads reuse it. The API still requires `baseUnitVerified: true`, checks the actual unit, and uses the same expected-version, authorization and tenant validation. Choosing individual-only pricing preserves the previously saved box/discount values while disabling their application; incomplete unsaved discount edits do not prevent disabling them.

No schema migration, stock conversion, selling-price change or financial-record rewrite is involved. Deployment can update the web client against the existing API. Recovery is a web-client rollback; saved version history and feature flags remain compatible.

Validation: web build and lint passed; 18 browser regressions passed with zero retries, including first-time/unit-change confirmation, reload without repeated confirmation, and disabling despite incomplete edits. All 12 real-stack runner scenarios passed (11 business scenarios plus the browser-suite wrapper), covering the requested quantity examples, retail compatibility and durable checkout recovery. The existing local Hybrid Pricing Test workspace also calculated 18 bottles at GHS 165 on desktop and mobile without saving prices or completing a sale. Screenshots were compared with the existing Items/Selling prices interface for consistent alignment and unnecessary copy at both widths. Evidence is under `test-results/admin-pricing-simplified/`.
