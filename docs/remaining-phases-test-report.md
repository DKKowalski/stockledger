# Remaining hybrid phases: validation

21 October 2026. Scope: Phase 4 stock-operation coverage and Phase 5 returns/reversals. Local development and disposable local staging only. The user selected disposable staging; production/remote deployment is not authorized.

| Check | Result |
|---|---|
| Unit tests | 158 passed |
| API/database tests, including populated upgrade | 117 passed |
| Existing browser regressions | 27 passed |
| Live authentication/API/browser scenarios | 14 passed |
| New return/transfer/count journeys | Passed at 1440 and 390 pixels |
| Actual TesterArmy return and transfer tasks | All 4 passed, desktop and mobile |
| Web lint and production build | Passed |
| Historical preservation at local schema upgrade | All 16 existing business tables unchanged |
| Independent database reconciliation | All 8 checks: zero discrepancies |

The schema rehearsal upgrades a populated pre-pricing database through pricing, durable sales, exact valuation and the new return records. Before/after row comparisons preserve historical movements, unknown snapshots, completed sales, verified checkpoints and exact receipt entries. Local application followed a verified full backup; hashes of all 16 existing business tables matched immediately afterward.

The final API/database suite covers original refund/cost conservation, later cost increases, damaged returns without sellable stock, remaining-unit reversals, known/unknown legacy snapshots, simultaneous request keys, cancellation tombstones, tenant/role/production guards, exact transfers, damage, count gains/shortages, supplier-credit separation, receipt-dependency rejection, immutable runtime grants, v5/v4 archive compatibility and verified-owner deletion. Existing regression suites remain included.

The live browser suite retains the previous retail, pricing, current-cost review and checkout checks. New real-browser scenarios at 1440 and 390 pixels cover a one-unit original refund of 184 cents, lost committed response/reload recovery, a 366-cent reversal of the remaining damaged goods, an unchanged original sale, 201 cents of loss and no damaged restock. They transfer all three units worth 302 cents, then count down to one unit worth 101 cents. Only an opaque request UUID is stored in the browser. A final count-history check verifies a 201-cent value impact from the original exact portions; the old rounded-unit multiplication would have shown 202 cents. The optional response field preserves legacy fields and does not modify stored historical counts.

Actual TesterArmy uses the installed e2e framework and visible controls to return one original unit and transfer all three exact-cost units on desktop/mobile. API and independent database reconciliation verify the resulting stock/value and immutable source sale; it is not a substituted Playwright-only run. Final counts and results are saved under `test-results/phase5-final/` and its linked logs.

`tests/e2e-live/reconcile-remaining.mjs` is a read-only disposable-staging check for sale/header/portion totals, return caps/header amounts, checkpoint quantity versus the original stock ledger, nonnegative per-location stock, original return price/cost snapshots, and contiguous exact quantity/value entry chains. No production database is used.

Visual checks compare the new panels with the existing Movements interface at desktop/mobile sizes. Identical displayed allocation rows are grouped without changing their stored cost/price portions. Currency values stay on one line; wide tables scroll within their panel. No decorative text, fabricated status or noninteractive hover animation was introduced.

The earlier runs retain their failure evidence. One run was interrupted by a long host pause and expired sessions. A later attempt re-entered login while already authenticated, then concurrent test suites exceeded the existing eight-logins-per-minute limit. The test harness now restores sessions correctly, caches fixture API logins and runs suites in sequence. Application login protections were not weakened. TesterArmy also exposed an empty-place source default, and one attempt was interrupted by a development-server reload. The form now selects a place holding stock, clears stale destinations and the server refuses invalid transfer previews. The agent waits for loaded controls. The final disposable rehearsal uses a compiled production frontend without development WebSockets; its unfinished forms cannot be discarded by hot reload. Earlier failed attempts are not reported as passes.

The local synthetic company now contains **Returns test item**, its original boxed test sale, and **Stock operations test item**. Existing products were not enrolled or modified. Refund amounts and supplier credits are recorded as amounts/evidence; no actual cash/provider refund or credit payment is processed. These operational settlement procedures and a measured, explicitly approved deployment remain prerequisites for real-business activation.

This stage completes Phase 4 stock operations and Phase 5 returns/reversals locally. The full roadmap still includes grouped/category reporting and the selected-product pilot, approved manual-discount policies, the multi-product cart and separately scoped payment/receipt work. See [the remaining roadmap](returns-stock-development.md#remaining-roadmap).


The four TesterArmy tasks passed on the compiled staging build before the final, separate count-history display correction. The final API suite and targeted desktop/mobile browser journeys additionally validate that correction. Return and transfer behaviour was unchanged by the reader fix. Agent evidence: `test-results/phase5-final/testerarmy-summary.md`; its independent database check: `testerarmy-reconciliation.json`. The final reader rehearsal and cleanup are recorded separately under `test-results/phase5-count-reader/`.


Final evidence is under `test-results/phase5-final/`: `api-unit.log`, `api-integration.log`, `web-lint.log`, `web-build.log`, `browser-regressions.log`, `new-browser.log`, `browser-proof.json`, `testerarmy-summary.md`, `testerarmy.log`, `historical-preservation.json`, `testerarmy-reconciliation.json`, `reconciliation.json`, `local-ready.json` and `cleanup.json`. Screenshots show both preview panels and the exact count-history result. The earlier full compiled rehearsal records 14/14 live scenarios and 27/27 browser regressions in `test-results/phase5-static-staging/`; the final targeted reader rehearsal records 13/13 live scenarios plus both new browser journeys in `test-results/phase5-count-reader/`. The latter does not repeat the unchanged 27-test regression or four-task agent suite.

Cleanup passed: all owned disposable staging services/containers and integration databases/roles were removed. The user’s API on port 3000 and web on port 5174 remained ready. The two local synthetic sample items and original test sale remain available for manual testing. No production or remote staging was modified.
