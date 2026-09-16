# StockLedger

StockLedger is a warehouse inventory dashboard built as a separate project from FieldFlow. It uses the same module, controller, provider, DTO and Prisma contract patterns from the FieldFlow API, with a React web client modeled on the supplied reference application.

The product's visual direction, component rules, and logo brief live in the [UI and brand style guide](docs/ui-style-guide.md).

## What is included

- Inventory dashboard with closing stock, stock value, low-stock, damage and dead-stock summaries
- Email and password login backed by Argon2 password hashing and expiring JWT sessions
- Protected API routes and session restoration after a browser refresh
- Item master with opening balances, reorder levels and unit cost
- Immutable stock movement ledger for purchases, shop transfers, returns and damage
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
closing = opening + purchases + returns in
          - transfers to shop - returns to supplier - damaged
```

The API owns this calculation. The React client renders the resulting snapshot and never maintains a second stock total.
