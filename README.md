# StockLedger

StockLedger is a warehouse inventory dashboard built as a separate project from FieldFlow. It uses the same module, controller, provider, DTO and Prisma contract patterns from the FieldFlow API, with a React web client modeled on the supplied reference application.

The product's visual direction, component rules, and logo brief live in the [UI and brand style guide](docs/ui-style-guide.md).

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

Administrators can set a selling price when adding an item or under **Items → Selling prices**. The price applies across the company's shops. Items without a price cannot be sold; an explicit zero price is supported. Attendants see the unit price and total before submitting. The API records the current catalog price and rejects stale displayed prices with `409 Conflict` so the attendant can refresh and review it.

Historical sales retain their recorded unit price even after the catalog changes. Sales recorded before pricing was introduced show **Not recorded** for price and total. The migration leaves existing item prices unset instead of treating purchase cost as a selling price. Amounts use integer cents and display two decimal places. The application still uses its existing USD currency setting.

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

StockLedger owns the transactional sending domain. Individual businesses do not need to connect their own domains. Until a StockLedger domain is verified, an administrator can create a staff account with a copyable invitation link, or create a copyable password-reset link from the Team page. Each new link invalidates the previous link of the same type and should be shared through a private channel.

Browser access tokens live only in React memory and expire after 15 minutes. A rotating 30-day token stays in a secure HTTP-only cookie. Render and the API must use HTTPS for the cross-origin cookie.
