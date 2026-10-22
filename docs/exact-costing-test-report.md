# Phase 4B exact-costing test report

Verified on 21 October 2026 using disposable local PostgreSQL databases, the restricted runtime role, real API authentication and Chromium. No production/staging database or deployed service was changed. Local development was backed up before its expansion migration; existing business rows matched before/after.

## Results

| Check | Result | Evidence |
|---|---|---|
| API unit regressions and integer conservation | 145 passed | `test-results/phase4b-final/unit.log` |
| Disposable populated upgrade and PostgreSQL/API regressions | 106 passed | `test-results/phase4b-final/integration.log` |
| Browser regressions, including four new recovery/coordination cases | 27 passed | `test-results/phase4b-verified/browser-regressions.log` |
| Full real browser/API/RLS scenarios | 14 passed | `test-results/phase4b-verified/results.json` |
| Exact-cost attendant checkout through the real desktop/mobile UI | 2 passed | `test-results/phase4b-final/attendant-checkout.json` |
| Actual TesterArmy administrator purchase tests | 2 passed | `test-results/phase4b-final/testerarmy-summary.md` |
| Final targeted recovery/coordination rerun after UI updates | 4 passed | `test-results/phase4b-final/browser.log` |
| API/web builds, web lint, migration integrity, whitespace checks | Passed | Build/lint/migration logs in `test-results/phase4b-final/` |

TesterArmy used the installed `e2e 0.21.2` framework with `@e2e-dev/web 0.15.2`, the configured model and the existing authentication provider. It made 19 model calls over desktop 1440×1000 and mobile 390×844. Each target used a newly created synthetic item. The agent selected the item, entered a two-unit purchase at GHS 1.01, reviewed it, confirmed it and inspected the resulting GHS 3.02 total. Independent PostgreSQL queries confirmed two purchase movements, three units and exactly 302 cents for both items. These were actual agent/UI tests, not substituted Playwright tests.

The separate attendant UI checks sold three units as a box for GHS 5.50, at both desktop and mobile sizes. Each sent one completion request, recorded 302 cents COGS and 248 cents gross profit, and exhausted both quantity and remaining value to zero. The existing general checkout fault-injection cases also passed.

## Financial and compatibility coverage

- A populated pre-pricing database upgrades through configuration, durable sales and exact valuation without changing existing business records. A completed old sale line retains every financial field; its new checkpoint field is null. The legacy `COGS = quantity × unit cost` constraint still rejects an inconsistent old line after upgrade.
- Purchases of one unit at 100 cents and two at 101 cents retain 302 cents. Separate sales allocate 101, 101 and 100 cents. A combined sale records line COGS of 302 with truthful integer-cost movement portions; quantities, revenue and costs conserve.
- Exact location value and current inventory totals reconcile, including initially empty receiving places. Old completed sale snapshots and unknown historical costs are preserved; v1/v2/v3 archive shapes remain available. v4 contains the new request/checkpoint/entry records.
- Same-key retries and concurrent confirmations produce one receipt. Two different keys using the same old pool revision yield one application and one stale conflict. Competing exact sales cannot oversell. Waiting behind an old receipt invalidates stale opening verification.
- A changed precise value invalidates an old quote even when its rounded displayed average stays the same. Explicit documented current-value write-downs do not falsely declare goods to have been acquired free.
- Unknown or zero acquisition cost is not automatically free. Nonempty zero-value opening enrollment needs explicit free-stock evidence; empty enrollment requires zero total value. Negative stock, overflow, fractional quantities, unsupported fields, stale currency/unit/revision and ledger divergence cannot create partial financial writes.
- Administrator-only permissions, tenant isolation, immutable ledger grants, immutable request payload grants and guarded verified-owner deletion were tested with the restricted database role.
- Gate-off and production refuse new exact writes. Existing terminal requests remain recoverable. Unsupported legacy writers, direct cost/unit edits, currency changes and negative-stock activation refuse enrolled items without bypassing their valuation ledger.
- Browser failures after preparation or after commit recover with the original key. Two tabs prepare one request. The browser stores only a UUID, not administrator purchase/cost payloads. Cancelling an unknown request creates a server tombstone; delayed preparation/application cannot execute it.

## Visual and local verification

Compared the new controls with the existing Items panels at desktop and mobile sizes. Shared spacing, field widths, labels and buttons match the established app. Checked for redundant copy, decorative labels, fake status and horizontal overflow. No new hover animation was introduced. Local screenshots are `test-results/phase4b-final/local-exact-1440.png` and `local-exact-390.png`.

Only **Hybrid Pricing Test** is locally allowlisted for exact-cost writes. **Exact cost test item** was created as empty synthetic stock, explicitly enrolled at zero, then given documented synthetic receipts of one at GHS 1.00 and two at GHS 1.01. It is ready to inspect with three units worth GHS 3.02. Existing customer/demo items were not enrolled or reconciled. No local sample sale was performed against this item.

The earlier `phase4b-live` attempt exposed an empty receiving-place UI bug and an unrelated full-page screenshot timeout. The bug was fixed, screenshot capture was scoped to its panel, and the fresh `phase4b-verified` run passed all scenarios. Earlier attempt artifacts remain available; they are not reported as passes.

## Remaining boundary

This verifies the bounded Phase 4B development workflow, not production readiness or all inventory operations. Compatible transfers, losses/counts, supplier returns and Phase 5 original-allocation returns/refunds/reversals remain required before real-business activation. Value corrections are audited valuation adjustments, not expense/cash/payment postings. A populated staging maintenance/deployment rehearsal and explicit approval remain prerequisites for production.
