# StockLedger

StockLedger is a warehouse inventory dashboard built as a separate project from FieldFlow. It uses the same module, controller, provider, DTO and Prisma contract patterns from the FieldFlow API, with a React web client modeled on the supplied reference application.

## What is included

- Inventory dashboard with closing stock, stock value, low-stock, damage and dead-stock summaries
- Email and password login backed by Argon2 password hashing and expiring JWT sessions
- Administrator accounts can add inventory managers, who can record stock but cannot manage people
- Administrators can activate or deactivate staff accounts and send expiring password-reset links
- Inventory managers and shop attendants change passwords only through an administrator-issued reset link
- Protected API routes and session restoration after a browser refresh
- A read-only public demo enforced by the API, not only by disabled browser controls
- Public business-owner registration that creates the company and administrator atomically
- Resumable owner onboarding with business type, first stock location, and inventory-source setup
- A database-derived launch checklist for the first item, movement, and teammate
- Tally, an interactive SVG setup guide with reduced-motion support
- Item master with reorder levels, unit cost, and an opening balance at one place
- Atomic Excel and CSV catalog import with row validation, preview, and a downloadable template
- Warehouses and shops that each hold their own stock
- Transfers that leave one place and arrive at another, plus purchases, returns, and damage
- Shop attendant accounts assigned to one shop, with a sale that reduces only that shop
- Administrator-controlled selling prices, separate from unit cost, with the charged price saved on each sale
- Supplier directory and costed purchase receipts with moving weighted-average item costs
- Physical stock counts that preserve the expected quantity, counted quantity, variance, reason, and resulting adjustment
- Customer returns linked to their original sale, with over-return protection and historical price and cost snapshots
- Catalog editing and safe item archiving, with duplicate item-code protection
- In-app low-stock alerts derived from live balances at each place
- Owner-only profitability reporting for net sales, cost of goods sold, gross profit, margin, and inventory losses
- Current, low, fast, slow and dead-stock reports for 7, 30 or 90 days
- Transactional stock checks that prevent simultaneous outbound movements from taking stock below zero
- Responsive React UI with loading, empty and error states
- CSV exports, owner-confirmed workspace deletion, and public privacy and terms pages
- Optional Sentry reporting for unexpected API and browser errors
- Liveness and database-readiness endpoints for deployment and uptime checks

## Run locally

```bash
docker compose up -d
cd apps/api
npx prisma db migrate
cd ../..
npm run api:seed
npm run api:dev
```

In another terminal:

```bash
npm run web:dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:3000`.

If another project uses port 5173, set `VITE_DEV_PORT=5174` in `apps/web/.env` and `WEB_ORIGIN=http://localhost:5174` in `apps/api/.env`, then restart both dev servers. Vite fails clearly when the selected port is occupied instead of silently changing the browser origin.

Use the seeded administrator account:

```text
Email: admin@stockledger.app
Password: StockLedger123!
```

## Stock equation

```text
closing at a place = opening
          + purchases + returns in + transfers in
          - transfers out - returns to supplier - damaged - sales
```

The API owns this calculation. The React client renders the resulting snapshot and never maintains a second stock total.

Every movement creation or deletion locks its inventory item with `SELECT FOR UPDATE` inside a PostgreSQL transaction. The API reads the ledger after acquiring the lock, checks the resulting balance, and writes before releasing it. Two sales of four units against a balance of five produce one sale and one `409 Conflict`. Transfers and deletions share the same lock, including both ends of a transfer. Different items can change concurrently; operations on the same item wait even when they involve different locations.

The transaction explicitly uses Read Committed isolation so a request that waited for the lock sees the preceding request's committed movements. This follows PostgreSQL's [guidance for application consistency checks](https://www.postgresql.org/docs/17/applevel-consistency.html). New stock mutation paths must use the same locking rule. Item creation and its opening balance also commit or roll back together.

## Selling prices

Box and quantity deals are off by default. An owner turns them on under **Settings → Inventory → Selling → Box and quantity deals**. When on, each item's **Pricing** tab sets a box price and quantity discounts, the normal **Sell** screen charges them, customer returns refund the price actually paid, and **Profit** shows the discounts given. Items without deals keep their single price. The switch requires negative stock to be off. `PRICING_PREVIEW_COMPANY_IDS` and the development checkout allowlists remain as overrides for development/test. See the [pricing rollout notes](docs/pricing-preview-rollout.md).

Administrators can set a selling price when adding an item or under **Items → Selling prices**. The price applies across the company's shops. Items without a price cannot be sold; an explicit zero price is supported. Attendants see the unit price and total before submitting. The API records the current catalog price and rejects stale displayed prices with `409 Conflict` so the attendant can refresh and review it.

Historical sales retain their recorded unit price even after the catalog changes. Sales recorded before pricing was introduced show **Not recorded** for price and total. The migration leaves existing item prices unset instead of treating purchase cost as a selling price. Amounts use integer cents and display two decimal places. Currency is configurable per company and defaults to GHS.

## Tests

```bash
npm run api:test
docker compose up -d
npm run api:test:integration
npm run api:build
npm run web:build
npm run web:lint
npm run e2e:install
npm run e2e
```

The integration runner creates a uniquely named database inside the local Compose PostgreSQL service, applies migrations, runs the tests, and removes that database afterward. It overrides database connection variables for the test process. The tests cover competing sales and transfers, deletion races, rollback, company access boundaries, and attendant restrictions using separate connection pools. They hold an item lock until both competing requests are waiting in PostgreSQL before releasing it.

The Playwright suite starts the built API and Vite on isolated test ports. It covers public legal pages, demo login, refresh-cookie session restoration, and API-enforced demo write protection. GitHub Actions runs unit and isolated PostgreSQL integration tests, builds, lint, migrations, seed, and the Chromium suite on every pull request and push to `main`.

## Deploy with Render and Supabase

The repository includes a `render.yaml` Blueprint for:

- `stockledger-dkk-api`, a free NestJS web service in Frankfurt
- `stockledger-dkk-web`, a free React static site

Create the Supabase project first. Keep two database URLs in Render:

- `DIRECT_DATABASE_URL` uses the database owner and is available only to the build migration.
- `DATABASE_URL` uses the restricted `stockledger_runtime` login for the running NestJS process.

Apply the migrations with the owner URL first. Then create or rotate the runtime login without committing its password:

```bash
psql "$DIRECT_DATABASE_URL" -v runtime_password='generate-a-long-random-password' -f docs/production-database-role.sql
```

Build `DATABASE_URL` with that runtime login and the Supabase Session pooler connection details. The migration-created `stockledger_app` group has only the grants needed by the API. Its row-level security policies require each transaction to set `app.current_company_id`.

For local migration work, copy Supabase's direct connection URL into `DIRECT_DATABASE_URL`. The API runtime continues to use `DATABASE_URL`.

In Render, choose **New > Blueprint**, connect `DKKowalski/stockledger`, and apply `render.yaml`. Render generates `JWT_SECRET`; do not enter one manually.

Account email uses the Resend HTTP API. Add `RESEND_API_KEY` and `EMAIL_FROM` to the API service in Render. `EMAIL_FROM` must use a sender address verified in Resend, for example `StockLedger <accounts@example.com>`. Owner verification links last 24 hours, staff invitations last 72 hours, and password-reset links last 30 minutes by default.

Set `DEMO_COMPANY_ID` to the seeded company ID to keep the public demo read-only. The checked-in Blueprint uses `31000000-0000-4000-8000-000000000001`. Do not reuse that ID for a real customer.

For error reporting, create separate Sentry projects for the NestJS API and React client. Add the server DSN as `SENTRY_DSN` on the API service and the browser DSN as `VITE_SENTRY_DSN` on the static site. The application runs without either value. Unexpected API failures include the request ID and Cloudflare Ray ID when available; the React error boundary gives users a reload screen instead of a blank page.

Render checks `/health/ready`, which verifies that the API can query PostgreSQL. `/health` is a cheaper process-liveness endpoint. An external uptime provider can monitor the web URL and `/health/ready` later if alerts outside Render are needed.

### GitHub Actions wake request

The `Keep API awake` workflow sends a request to the lightweight `/health` endpoint every ten minutes. It runs from the default branch and is offset from the start of each hour, when scheduled GitHub Actions traffic is typically highest. It can also be triggered manually from the repository's Actions page. If the API URL changes, update `.github/workflows/keep-api-awake.yml`.

This reduces idle cold starts on the current Render Free API service, but GitHub can delay scheduled workflows and it does not provide an availability guarantee. GitHub automatically disables schedules in public repositories after 60 days without repository activity; re-enable the workflow from the Actions page if that happens. It consumes Render Free instance hours, and Render can still restart free services. The Render static frontend does not need a wake request. Use a paid Render API instance when StockLedger needs supported, continuously available production hosting.

StockLedger owns the transactional sending domain. Individual businesses do not need to connect their own domains. Until a StockLedger domain is verified, an administrator can create a staff account with a copyable invitation link, or create a copyable password-reset link from the Team page. Each new link invalidates the previous link of the same type and should be shared through a private channel.

Browser access tokens live only in React memory and expire after 15 minutes. A rotating 30-day token stays in a secure HTTP-only cookie. Render and the API must use HTTPS for the cross-origin cookie.

Phase 3 adds optional development-only [durable sale completion](docs/sale-completion-development.md), with idempotent recovery and grouped ledger records. In production it is enabled per business by the owner switch described under Selling prices.

Phase 4A adds optional administrator [current-cost review](docs/cost-readiness-development.md). `COST_READINESS_COMPANY_IDS` enables **Items → Review purchase costs** only in development/test. Reviews append supporting-record references to the existing audit log; they never change costs, stock or historical profit. See Phase 4B below for the prospective exact-value workflow.

Phase 4B adds optional [exact future stock costs](docs/exact-costing-development.md), approved for development/test only. `EXACT_COSTING_COMPANY_IDS` enables **Items → Exact stock costs**; individual items still require explicit verified opening balances. Exact receipts, future development sales and documented current-value corrections preserve all cents. Unsupported enrolled-item stock operations are blocked until their compatible workflows exist. Existing items and historical sales are unchanged. Production rollout remains unapproved.

Phase 4 stock operations and Phase 5 now add [original-allocation returns, reversals and exact stock operations](docs/returns-stock-development.md). In development/test, `SALE_RETURNS_COMPANY_IDS` enables **Movements → Customer returns** for administrators, and `STOCK_OPERATIONS_COMPANY_IDS` plus exact-cost activation enables **Exact stock changes** for administrators/managers. Actual refund/credit payments are not processed. Workspace v5 includes the new immutable records. Local staging uses synthetic businesses; real-business deployment and activation remain separately approved actions.
