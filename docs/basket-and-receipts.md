# Basket checkout

The Sell screen offers **Basket sale** for businesses using normal retail prices. Businesses with box/quantity deals use basket checkout directly. Add products, edit quantities or remove lines, then review the combined total and complete once. A single item can also be reviewed directly without adding it first.

Current item/pricing/currency details and date-aware stock balances are rechecked on completion under the existing sorted item locks. A conflict preserves the basket and requires a new review. **Refresh stock and prices** updates the form before another review can start. Every basket uses one durable completion key across all its lines; reload and check/retry that same pending request after an uncertain response. Do not clear browser recovery data to work around an uncertain sale.

The normal single-item screen remains for compatibility and recovery of existing retail requests. Basket availability does not turn on discounts: only the owner's switch (or the existing non-production enrollment) enables deal pricing. A quote prepared with development deals becomes stale when those deals are unavailable in production. Negative-stock businesses must turn off that setting before basket completion.

The basket does not reserve stock while a customer browses. Unsaved drafts are kept in memory; the completion intent is stored before sending. Inventory valuation and historical COGS policies are unchanged.

## Manual payment record and receipt

Basket checkout (including a one-item basket) can record **Cash received**, **MoMo received — confirmed manually**, or **Unpaid**. The safe default is **Payment not recorded**. Cash must cover the total and the receipt shows change to give. A manually confirmed MoMo amount must equal the total; unpaid records zero received. These are immutable manual records saved in the same transaction and idempotency request as the sale. The application does not collect, verify or refund money. A later retry cannot change the recorded tender.

After completion or pending-sale recovery, **View customer receipt** opens a shop-scoped authenticated receipt. It uses the original sale's item labels, quantities, discounts, totals and currency, with a full stable sale UUID reference. Print it, download text, or share/copy the receipt text. The link itself requires workspace sign-in; it is not a public customer URL. Business/shop headings use current workspace names. Returns/refunds are separate; an original receipt is not rewritten to imply a refund occurred.

Historical grouped sales and old browsers omitting tender retain null payment fields and show **Payment not recorded**. Legacy quick single-item movement sales retain their existing recovery flow; use **Basket sale** (also for one item) when a tender/receipt is needed. No historical tenders are inferred from revenue.

Deliberately excluded: split/partial payments, collection of unpaid debts, payment-provider integration, refund settlement, cash drawer shifts, daily tender reconciliation/totals, tax-invoice rules and a public receipt service. Those require a separate settlement policy and reconciliation tests. This version is a manual sale record and customer receipt, not a day-end system.

Deployment adds nullable `sales.tender_method` and `sales.amount_received_cents` with a consistency constraint. No backfill, defaults or historical financial changes occur. The application is compatible with older requests after migration; run migrations before the new API. The owner recovery checklist applies because deploy runs migrations automatically. A constraint validation scans existing sales, so rehearse populated data and use the documented bounded migration lock/statement timeouts before deployment.
