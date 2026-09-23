# StockLedger

StockLedger is a warehouse inventory dashboard built as a separate project from FieldFlow. It uses the same module, controller, provider, DTO and Prisma contract patterns from the FieldFlow API, with a React web client modeled on the supplied reference application.

The product's visual direction, component rules, and logo brief live in the [UI and brand style guide](docs/ui-style-guide.md).

## What is included

- Inventory dashboard with closing stock, stock value, low-stock, damage and dead-stock summaries
- Email and password login backed by Argon2 password hashing and expiring JWT sessions
- Administrator accounts can add inventory managers, who can record stock but cannot manage people
- Protected API routes and session restoration after a browser refresh
- Item master with reorder levels, unit cost, and an opening balance at one place
- Warehouses and shops that each hold their own stock
- Transfers that leave one place and arrive at another, plus purchases, returns, and damage
- Shop attendant accounts assigned to one shop, with a sale that reduces only that shop
- Administrator-controlled selling prices, separate from unit cost, with the charged price saved on each sale
- Current, low, fast, slow and dead-stock reports for 7, 30 or 90 days
- Transactional stock checks that prevent simultaneous outbound movements from taking stock below zero
- Responsive React UI with loading, empty and error states

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
```

The integration runner creates a uniquely named database inside the local Compose PostgreSQL service, applies migrations, runs the tests, and removes that database afterward. It overrides database connection variables for the test process. The tests cover competing sales and transfers, deletion races, rollback, company access boundaries, and attendant restrictions using separate connection pools. They hold an item lock until both competing requests are waiting in PostgreSQL before releasing it.

## Deploy with Render and Supabase

The repository includes a `render.yaml` Blueprint for:

- `stockledger-dkk-api`, a free NestJS web service in Frankfurt
- `stockledger-dkk-web`, a free React static site

Create the Supabase project first. In **Connect**, copy the **Session pooler** URL on port `5432`. Use that value for the Blueprint's `DATABASE_URL` prompt. The Render build applies committed migrations, and the first successful deploy seeds the demo account and inventory data.

For local migration work, copy Supabase's direct connection URL into `DIRECT_DATABASE_URL`. The API runtime continues to use `DATABASE_URL`.

In Render, choose **New > Blueprint**, connect `DKKowalski/stockledger`, and apply `render.yaml`. Render generates `JWT_SECRET`; do not enter one manually.
