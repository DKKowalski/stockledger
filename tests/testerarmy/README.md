# TesterArmy pricing checks

This isolated test package uses TesterArmy's actual `e2e` runner and model-driven `agent.act` actions. Its dependencies do not change the API or web application packages. Only synthetic localhost fixtures created by the live runner are accepted.

From the repository root, start the disposable fixture in one terminal:

```sh
E2E_LIVE_HOLD=1 node tests/e2e-live/pricing-preview.mjs
```

Wait until it prints `Keeping disposable fixture live`. The runner has already passed its eight live regression scenarios before this point. It creates a private `test-results/live-pricing-agent/local-fixture.json` with disposable credentials; do not commit or share that file.

In another terminal, from `tests/testerarmy`:

```sh
npm ci --no-audit --no-fund
# Only if no saved OpenAI login exists:
E2E_TELEMETRY_DISABLED=1 npx --no-install e2e login openai
E2E_TELEMETRY_DISABLED=1 STOCKLEDGER_TEST_FIXTURE="$PWD/../../test-results/live-pricing-agent/local-fixture.json" npx --no-install e2e run tests/pricing.e2e.ts --no-cache --trace on
```

The model must be available to the saved login. The pinned configuration uses `gpt-6-luna`; model actions consume the account's model allowance. Tests run desktop (1440×1000) and mobile (390×844), with one worker, zero retries, and replay caching disabled. Provider prompt caching can still appear in token accounting. Both targets save a configuration version, preview nine quantities without stock writes, and record exactly one five-unit retail sale. No business response is mocked by this suite.

Inspect `.e2e/report.json` and each result's `trace.md`. Passwords use opaque credential handles. TesterArmy withholds screenshots for sessions after a secret fill; browser trees and action traces remain available. The independent runner provides separate visual screenshots.

When finished, from the repository root:

```sh
rm test-results/live-pricing-agent/hold-open
```

Wait for the first terminal to exit and confirm `results.json` records cleanup. It stops the local services and removes the generated tmpfs database container. The fixture also has a 30-minute hold limit. Delete `local-fixture.json` after cleanup. Recreate the fixture before another complete run, so stock and configuration versions start from a known state.

## Phase 3 development checkout

Start the fixture with `E2E_LIVE_SALE_COMPLETION=1 E2E_LIVE_HOLD=1 node tests/e2e-live/pricing-preview.mjs` from the repository root. It runs all eight retail/preview scenarios and three recovery scenarios, then adds 30 synthetic units through a normal purchase for this separate agent run. Wait for the hold message. From this package directory:

```sh
E2E_TELEMETRY_DISABLED=1 STOCKLEDGER_TEST_SALE_COMPLETION=1 STOCKLEDGER_TEST_FIXTURE="$PWD/../../test-results/live-pricing-agent/local-fixture.json" npx --no-install e2e run tests/sale-completion.e2e.ts --no-cache --trace on
```

Each target explicitly opens development checkout and completes one 15-unit sale for 18500 cents, verifying the header, two ledger components, and one 15-unit stock effect. This file skips unless `STOCKLEDGER_TEST_SALE_COMPLETION=1` is explicit. Release the hold as above afterward.

## Phase 4A current-cost review

Start the disposable fixture with `E2E_LIVE_OUTPUT_NAME=phase4-cost-review-verified E2E_LIVE_SALE_COMPLETION=1 E2E_LIVE_HOLD=1 node tests/e2e-live/pricing-preview.mjs`. Wait for the hold message. From this package directory:

```sh
E2E_TELEMETRY_DISABLED=1 STOCKLEDGER_TEST_COST_REVIEW=1 STOCKLEDGER_TEST_FIXTURE="$PWD/../../test-results/phase4-cost-review-verified/local-fixture.json" npx --no-install e2e run tests/cost-review.e2e.ts --no-cache --trace on --output .e2e-phase4-cost
```

Each desktop/mobile agent selects the product under **Review purchase costs**, chooses purchase records, enters a unique synthetic reference, and confirms once. Assertions read the real API to check the saved source, amount and currency and that item data, stock, movements and pricing configuration are unchanged. This is an administrator's attestation; no invoice-verification service or historical cost reconstruction is claimed. Remove this fixture's `hold-open` file afterward and wait for cleanup.


## Returns and exact stock operations

Start the full disposable rehearsal from the repository root:

```sh
E2E_LIVE_OUTPUT_NAME=phase5-static-staging E2E_LIVE_STATIC_WEB=1 E2E_LIVE_HOLD=1 E2E_LIVE_REMAINING_PHASES=1 E2E_LIVE_EXACT_COSTING=1 E2E_LIVE_SALE_COMPLETION=1 E2E_LIVE_BROWSER_REGRESSIONS=1 node tests/e2e-live/pricing-preview.mjs
```

Wait for the hold message and run the new browser suite from the root:

```sh
STOCKLEDGER_TEST_FIXTURE="$PWD/test-results/phase5-static-staging/local-fixture.json" node tests/e2e-live/remaining-phases.mjs
```

Run suites sequentially. Allow the existing login rate-limit window to clear before the agent suite; keep application authentication limits intact. From `tests/testerarmy`:

```sh
E2E_TELEMETRY_DISABLED=1 STOCKLEDGER_TEST_REMAINING_PHASES=1 STOCKLEDGER_TEST_FIXTURE="$PWD/../../test-results/phase5-static-staging/local-fixture.json" npx --no-install e2e run tests/remaining-phases.e2e.ts --no-cache --trace on --output .e2e-phase5-static
```

Both desktop and mobile agents review and confirm one original-allocation customer return and one exact-cost stock transfer through visible controls. The real API verifies the immutable original sale and conservation of quantity/value. This rehearsal serves a compiled production frontend from a private temporary directory. It has no development WebSocket or hot reload, so unrelated development activity cannot reset an unfinished form. The optional default development-server mode remains available for debugging.

Before releasing the hold, run the read-only reconciliation from the root:

```sh
STOCKLEDGER_TEST_FIXTURE="$PWD/test-results/phase5-static-staging/local-fixture.json" node tests/e2e-live/reconcile-remaining.mjs
```

Remove this fixture's `hold-open` file and wait for its runner to report cleanup. Keep report/trace evidence; never publish the private fixture credentials.
