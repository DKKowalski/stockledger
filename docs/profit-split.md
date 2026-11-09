# Banking / profit split

The owner-only **Banking** page (main navigation, right after Finance, route `/banking`) divides a month's Net Profit / Loss (the same actual figure Finance already reports) into parts, for example tax, reserve, owner's draw and growth, and records what has been banked. It has its own Year and Month pickers, opening on the last completed month. Finance's Month view only shows a "Split this profit in Banking →" link under the net profit.

## Banked in <year>

The top of the page totals what has been banked in the selected year: one row per account (the destination saved on each Done tick) with the part name(s) and the amount, plus a grand total. Amounts come from the snapshot stored when a part was ticked Done, so later settings changes never rewrite them. A tick counts towards the year of the profit month it belongs to (not the date it was ticked). Rows follow the current settings' part order where the destination still exists, then alphabetical. With no ticks: "Nothing banked yet in <year>. Tick a part as Done once you've moved the money."

API: `GET /finance/profit-split/summary?year=YYYY` (administrator only, company-scoped) returns `{ year, accounts: [{ destination, partNames, amountCents, count }], totalCents }`.

It is a plan and a record only. StockLedger does not move money: ticking a part "Done" just records that you did it.

## Default parts

| Part | Destination | Percent |
| --- | --- | --- |
| Tax reserve | Tax account | 10% |
| Top up emergency reserve | Reserve account (Target: 1–3 months of expenses) | 20% |
| Reinvest in inventory/tools | Business (high-margin SKUs) | 20% |
| Pay owner's draw | Personal account | 20% |
| Repay debt / clear supplier | Creditors | 10% |
| Growth fund | Growth savings account | 20% |

The reserve target is text only; no target is calculated. Until a company saves its own settings the defaults are used and nothing is stored.

## Settings

"Split settings" (Banking page) lets the owner rename parts, change destinations and percents, and add or remove parts. Rules, enforced by the API as well as the form:

- 1 to 10 parts, each with a name (80 characters) and a destination (120 characters).
- Percents are above 0, whole numbers or up to 2 decimals, and must total exactly 100%.

## Rounding rule

Work is done in integer cents and basis points (0.01%). Each part first gets the floor of its exact share. The cents still unassigned go one each to the parts with the largest fractional remainder (the earlier part wins a tie). The parts therefore always add up to exactly the month's net profit.

## Month status

- Completed month with a profit: parts can be marked done.
- Current month: shown as "Estimate so far — the month isn't finished"; marking done is disabled.
- Future month: nothing to split.
- Loss or zero: "No profit to split this month." and no parts.

## Marking done

Each part can be ticked Done with a date (default today in the company time zone, not in the future) and an optional note (up to 200 characters). Unticking removes the record. The amount and percent are stored when the part is marked done, so later settings changes do not rewrite history. If the month's profit later changes (for example a late expense), the part shows "Profit changed since this was marked done (was GH₵X)". Parts removed from the settings after being marked done stay visible under "Marked done under earlier settings".

## Access

Owner (administrator) only. The API returns 403 to other roles and the Finance page is not shown to them. The read-only demo company cannot save settings or mark parts done. Settings and completion changes are written to the audit log.

## API

- `GET /finance/profit-split?month=YYYY-MM`
- `PUT /finance/profit-split/settings` with `{ parts: [{ key?, name, destination, percent }] }`
- `PUT /finance/profit-split/:month/parts/:partKey` with `{ doneOn?, note? }`
- `DELETE /finance/profit-split/:month/parts/:partKey`
