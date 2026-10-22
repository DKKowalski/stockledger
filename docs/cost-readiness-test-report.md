# Phase 4A validation

Validated on 21 October 2026. This completes the current-cost review development slice, not the full Phase 4 valuation work. Production and staging were not connected, migrated, deployed or enabled.

| Check | Result |
|---|---|
| API unit tests | 135 passed |
| PostgreSQL/HTTP integration | 89 passed, including 11 current-cost review cases |
| Browser regression suite | 23 passed with zero retries, including five cost-review cases |
| Real browser → Nest → restricted PostgreSQL business scenarios | 12 passed in the final run |
| Actual TesterArmy desktop/mobile cost review | 2 passed with zero retries, cache off and 18 model calls |
| Web/API builds, web lint and whitespace | Passed |

The HTTP cases verify default-off and hard production refusal, active administrator permissions, tenant isolation, malformed/extra fields, intentional free acquisitions, unchanged business rows, concurrent retry deduplication, stale costs/units/revisions, changed-back costs, a real purchase changing the moving average, preserved null historical cost snapshots and profit, and archive retention. Dedicated lock-contention cases check both an intervening item-cost change and a currency edit. Reviews retain original currency and are ordered correctly after lock waits or clock skew.

Integration HTTP servers use unique temporary login roles that inherit the existing restricted `stockledger_app` policies and grants. They drop those roles after closing their pools instead of changing the shared application's password. The quote-expiry concurrency assertion tracks the generated role in the current test database.

The browser suite verifies default-hidden controls, reference/source requirements, an explicit free-acquisition acknowledgment, stale-review reload with changed cost/currency, persistence after reload and no stock writes at desktop/mobile widths. The real-stack scenario confirms a synthetic opening cost, reloads its saved review and checks that item values, stock and movements are unchanged.

TesterArmy used the pinned installed framework and saved model login against a generated localhost fixture. Each agent selected the product, chose purchase records, entered a unique synthetic reference and confirmed once through visible controls. Real API assertions compared item data, pricing, stock positions and movements before/after. Independent PostgreSQL evidence found exactly two additional agent review events with the expected cost, source and currency; recorded movements were unchanged. Agent sessions with secret fills withhold screenshots; separate real-browser screenshots cover visual review against the existing Items layout at desktop/mobile sizes.

The new cost-review reload exposed two ordering assumptions in the live test harness's stale-pricing scenario. The test now explicitly enters its intended quantity and waits for the initial pricing read before making its version stale. Earlier run evidence is retained; the final real-stack run passes all 12 business scenarios. No pricing-engine change was needed.

## Evidence and cleanup

- `test-results/phase4-final/`: unit/integration/build/lint logs and TesterArmy console output.
- `test-results/phase4-cost-review-currency/browser-regressions.log`: 23 passing current-code browser tests.
- `test-results/phase4-cost-review-verified/`: final 12 passing real-stack scenarios, database evidence, traces and cleanup result.
- `test-results/phase4-testerarmy/final/`: actual agent report, summary and traces; `persisted-evidence.json` alongside it contains independent database checks.
- `test-results/phase4-local-review-currency/`: local Hybrid Pricing Test screenshots and desktop/mobile verification.

Only the existing local Hybrid Pricing Test company was enabled for manual review. Its synthetic opening record was confirmed; checksums across all 11 business tables matched before/after. Authentication sessions and append-only review audit events are the intended new records. No current costs, quantities, selling prices, historical sales or profit values changed. The generated test database/container and its servers were stopped/removed; the user's local web/API and existing PostgreSQL remained running.

## Scope and remaining work

No schema migration was added. Confirmation is an administrator attestation of the current stored cost against referenced records. It does not automatically verify invoices or establish complete historical cost provenance. The existing moving-average rounding, sale cost snapshots and profitability math remain unchanged. Prospective valuation corrections, rounding residuals, supplier-return/cancellation accounting and original-allocation hybrid returns/reversals remain outstanding before a production pilot.

See [development and rollback details](cost-readiness-development.md). Production activation still requires a representative staging rehearsal and explicit approval.
