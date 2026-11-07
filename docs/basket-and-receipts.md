# Basket checkout

The Sell screen offers **Basket sale** for businesses using normal retail prices. Businesses with box/quantity deals use basket checkout directly. Add products, edit quantities or remove lines, then review the combined total and complete once. A single item can also be reviewed directly without adding it first.

Current item/pricing/currency details and date-aware stock balances are rechecked on completion under the existing sorted item locks. A conflict preserves the basket and requires a new review. **Refresh stock and prices** updates the form before another review can start. Every basket uses one durable completion key across all its lines; reload and check/retry that same pending request after an uncertain response. Do not clear browser recovery data to work around an uncertain sale.

The normal single-item screen remains for compatibility and recovery of existing retail requests. Basket availability does not turn on discounts: only the owner's switch (or the existing non-production enrollment) enables deal pricing. A quote prepared with development deals becomes stale when those deals are unavailable in production. Negative-stock businesses must turn off that setting before basket completion.

The basket does not reserve stock while a customer browses. Unsaved drafts are kept in memory; the completion intent is stored before sending. Inventory valuation and historical COGS policies are unchanged.
