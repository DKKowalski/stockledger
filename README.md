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
- Current, low, fast, slow and dead-stock reports for 7, 30 or 90 days
- Server-side validation that prevents outbound movements from taking stock below zero
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

## Deploy with Render and Supabase

The repository includes a `render.yaml` Blueprint for:

- `stockledger-dkk-api`, a free NestJS web service in Frankfurt
- `stockledger-dkk-web`, a free React static site

Create the Supabase project first. In **Connect**, copy the **Session pooler** URL on port `5432`. Use that value for the Blueprint's `DATABASE_URL` prompt. The Render build applies committed migrations, and the first successful deploy seeds the demo account and inventory data.

For local migration work, copy Supabase's direct connection URL into `DIRECT_DATABASE_URL`. The API runtime continues to use `DATABASE_URL`.

In Render, choose **New > Blueprint**, connect `DKKowalski/stockledger`, and apply `render.yaml`. Render generates `JWT_SECRET`; do not enter one manually.
