# Phase 3 validation

Validated on 21 October 2026 against synthetic localhost resources. Production/staging were not connected, migrated, deployed or enabled. Existing uncommitted project work was preserved.

| Check | Final result |
|---|---|
| API unit tests | 130 passed |
| PostgreSQL/HTTP integration tests | 78 passed: 51 existing inventory, 4 preview workflow, 23 durable-completion cases |
| Existing browser regressions plus cross-tab cases | 16 passed, zero retries |
| Real browser → Nest → restricted-role PostgreSQL business scenarios | All 11 passed |
| Actual TesterArmy, final desktop/mobile checkout | 2 passed in one final run, zero retries, 18 actual model calls |
| API/web builds, web lint, migration integrity, whitespace | Passed |

## Behaviour verified

- Existing retail purchase, transfer, sale, original-price return, stock count, profit, tenant permissions and legacy exports remain compatible. The populated upgrade applies the 15 legacy migrations, checks the preview migration without rewriting existing rows, creates preview history, then applies the new sale migration and confirms both business rows and pricing history are unchanged. Missing historical prices/costs remain missing.
- Optional pricing rules price all nine requested examples correctly. Configuration and previews never create stock movements. Retail remains the default UI even for a development-enabled company; entering development checkout requires an explicit action. Production refuses the new writer even if an allowlist is configured.
- Completion creates exact immutable header/line/component records and corresponding existing-ledger movements in one transaction. Two price components for 15 units total 18500 cents and deduct 15 units in total. Indivisible package cents are conserved; oversized values fail before writes.
- Same-key retries, including mixed-case key representations, return one sale. Different payloads on a used key conflict. Different keys competing for the last stock, concurrent legacy/new sales, reversed cart input order, duplicate-product aggregation and insufficient stock on one basket line are covered. An injected failure during a later component insert rolls back headers, lines, movements and completion audit together.
- Stale prices, rules, costs, units, currency, negative-stock policy, expired quotes, quotes expiring while blocked on an item lock, forged quotes, role/shop/tenant substitution and client-supplied charges are rejected without financial writes.
- Confirmed writes followed by refresh failure clear the request. A lost completion response after real commit survives a browser reload and resolves by lookup without another POST. A request lost before reaching the server retries with its original key and commits once. Committed lookup/replay still works with the writer disabled.
- Cross-tab tests deliberately queue two tabs behind one Web Lock and verify one persisted intent/one completion POST. A second test installs event suppression before the app loads, lets tab A finish, then verifies suspended tab B cannot use its earlier quote to create another sale. These two UI-boundary tests mock business responses; separate real-stack and HTTP tests establish persistence and financial correctness.
- Archive v3 observes one repeatable-read snapshot: a deterministic regression pauses after the ledger read, commits a sale, then resumes the export and confirms it contains neither half of that sale. A subsequent archive contains the complete linked records.
- Original item, price and cost snapshots survive catalog changes. Grouped movements reject legacy partial returns/deletion; the UI omits those unsupported actions. Existing owner-confirmed workspace deletion still clears populated new dependencies under its guarded deletion context.

An independent tester identified UUID-case handling, cross-tab coordination, archive consistency and unsupported correction controls during review. Each was fixed and covered; the focused re-review found no remaining defect in those fixes.

## Actual TesterArmy

Used the official [TesterArmy E2E framework](https://github.com/tester-army/e2e), `e2e@0.21.2`, `@e2e-dev/web@0.15.2`, and the saved `chatgpt.responses/gpt-6-luna` login. Sources and pinned standalone dependencies are in `tests/testerarmy/`. The final run used cache off, one worker, zero automatic retries, and traces on. Provider prompt caching in token accounting is separate from test replay caching.

On desktop 1440×1000 and mobile 390×844, the agent explicitly opened development checkout, reviewed 15 pcs for 18500 cents, completed once, and verified the persisted sale, two component movements and exactly 15 units deducted. The final run passed 2/2 and used 18 model calls. No business responses were mocked in these agent tests. An earlier mobile attempt had a model-provider connection timeout before submitting; the final clean run supersedes that attempt.

TesterArmy withholds screenshots after secret credential entry. Its evidence consists of browser trees, actions, exact assertions and persisted records; visual screenshots come from the separate real-browser runner. Desktop/mobile screenshots were inspected for spacing, overflow, consistent controls and unnecessary copy. No decorative motion was introduced.

## Reproduction and evidence

From the repository root, with project dependencies, Chromium and Docker installed:

```sh
npm run api:test
npm run api:test:integration
E2E_LIVE_SALE_COMPLETION=1 E2E_LIVE_BROWSER_REGRESSIONS=1 node tests/e2e-live/pricing-preview.mjs
```

The integration command creates/drops a random database in the configured local test service. The live runner instead creates its own unique tmpfs PostgreSQL container, restricted application role, random localhost ports and synthetic businesses; it does not load project `.env` files. For agent tests, follow the separate hold-fixture instructions in `tests/testerarmy/README.md`.

Final evidence:

- `test-results/phase3/integration.log`: 78 passing tests and populated migration preservation.
- `test-results/phase3/browser-final.log`: 16 passing browser tests; artifacts under `browser-final/`.
- `test-results/phase3-complete/`: 11 passing real business scenarios, screenshots, database evidence, API/migration/build logs and cleanup. Its combined-run wrapper retains an initial failure of the suspended-tab test arrangement; after installing event suppression before the app, the separate final browser run passed all 16. The original result was not overwritten.
- `test-results/phase3-testerarmy/final/`: final passing agent `report.json`, summary and per-test traces.
- `test-results/phase3-testerarmy/final-persisted-evidence.json` and `final-cleanup-evidence.json`: persisted financial evidence and independent cleanup checks.

All generated database containers and test servers were removed/stopped, their ports were confirmed closed, and disposable credential files were removed. Unrelated local containers were left untouched.

## Release limits

This is a development-only inventory-sale implementation. It does not process money, issue formal receipts, enable manual discounts, implement grouped returns/reversals, or establish verified cost provenance. Those remain later stages before a production pilot. Chromium mobile emulation is not physical-device or cross-browser validation.

One disposable API exceeded the graceful process-exit budget after closing its listener/database sessions. The harness bounds that wait and stops only its own child; production shutdown/drain, populated-data lock timing, monitoring, backup recovery and rollback still require a separate staging rehearsal and explicit production approval. The web build also retains its existing large-chunk advisory.
