# Pricing preview E2E test report

Latest Phase 3 validation is recorded separately in [the durable sale completion test report](sale-completion-test-report.md).

Tested the current development working tree on 20 October 2026. No application implementation was changed. Existing uncommitted work was preserved.

## Independent live browser test

**Result: 8/8 scenarios passed; no application defects found in this scope.** This run used an independent testing agent and Playwright Chromium. The separate genuine TesterArmy run is recorded below.

Reproduce from the repository root:

```sh
node tests/e2e-live/pricing-preview.mjs
```

Prerequisites: installed project dependencies, Chromium installed for Playwright, and Docker with `postgres:17-alpine`. The runner creates a unique PostgreSQL container with `--rm`, tmpfs storage, and a random port bound to `127.0.0.1`. It applies migrations only there, seeds two synthetic non-demo businesses, and runs Nest/Vite on ephemeral localhost ports. It does not load project `.env` files. The actual API connects as restricted `stockledger_app`, with neither superuser nor RLS bypass privileges. The allowlist contains only the synthetic enabled company.

| Scenario | Evidence |
|---|---|
| Administrator saves optional pricing in the real UI | Real PATCH, immutable version 1 and audit row persisted in PostgreSQL; base-unit acknowledgement required |
| Quotes match all nine examples | Base quantities 2, 7, 10, 11, 15, 19, 20, 23 and 25 return 3000, 9100, 12000, 13500, 18500, 23700, 24000, 28500 and 30500 cents; two packages convert to 20 base units and 24000 cents |
| Quotes leave inventory untouched | Both `location_stocks` rows remained byte-for-byte equivalent; zero stock movements existed after configuration/quotes |
| Persistence and mobile interaction | Reload restores package/tier values; 390px page has no horizontal overflow; visible preview controls have labels and keyboard tab order works |
| Stale configuration and competing writes | Stale browser quote produces a conflict and reload recovers; simultaneous saves yield one 200 and one 409, with consecutive versions 1–3 |
| Input, tenant and role boundaries | Fractional/negative/zero/overflow quantities and injected totals/discounts rejected; foreign item inaccessible; attendants/managers cannot configure; non-allowlisted tenant keeps retail-only quotes and hidden controls |
| Existing retail sale | Real attendant browser sale of seven units remains 1500 cents/unit, stock becomes 23; net sales 10500, cost 7000 and gross profit 3500 cents |
| Successful write followed by failed refresh | A second real sale of two units commits, then only the following snapshot GET is fault-injected with 503; the form clears, Sell disables, and retry refreshes without resubmitting. Exactly two movements exist and closing stock is 21 |

All normal browser business requests reached the real API/database. The sole mocked response was the deliberately failed **post-commit snapshot GET**; its preceding sale POST was real and verified in PostgreSQL. Additional negative/security/concurrency assertions called the same live API directly.

Artifacts from the passing fresh run are under `test-results/live-pricing-agent-verified/`:

- `results.json` and `evidence.json`: all eight results, real runtime endpoints/role, persisted configuration versions and sale price/cost snapshots.
- `desktop-pricing.png`, `mobile-pricing.png`, `mobile-saved-refresh-failure.png`: visually inspected screenshots.
- `admin-trace.zip`: Playwright trace for the live administrator session.
- `migration.log`, `build.log`, `api.log`, `integration.log`: migration/build/API and regression evidence.

Both the verified run and the fixture used by TesterArmy stopped their API/Vite servers and removed their tmpfs PostgreSQL containers and temporary working directories. The TesterArmy fixture's web/API ports were independently confirmed closed, its container was absent, and disposable credential files were removed. The repository's pre-existing PostgreSQL container was untouched.

## Actual TesterArmy agent tests

**All four desktop/mobile scenarios have passing results.** Used the official [TesterArmy E2E framework](https://github.com/tester-army/e2e) and its [E2E skill](https://github.com/tester-army/e2e/blob/main/skills/e2e/SKILL.md), with `e2e@0.21.2`, `@e2e-dev/web@0.15.2`, Chromium 156.0.8078.4, and `chatgpt.responses/gpt-6-luna`. The existing saved subscription login worked. No replacement login or application dependency changes were needed.

| Run | Result | Actual model calls |
|---|---|---|
| Desktop, 1440×1000 | 2/2 passed | 17 |
| Initial mobile, 390×844 | Retail sale passed; administrator preview interrupted by a development-server reload | 19 |
| Mobile administrator rerun, with no concurrent workspace edits | 1/1 passed | 14 |

Each runner invocation had one worker, zero automatic retries, tracing enabled, telemetry disabled, and replay caching disabled. Provider prompt caching still appeared in token accounting; the actions above made real model calls.

The agent navigated to Items, selected the product, acknowledged its existing base unit, saved a new immutable configuration version, and calculated a preview. Exact assertions then checked all nine requested quantity totals and confirmed the real API's stock positions and movement history were unchanged. On both viewports, the agent also prepared and submitted exactly one five-unit attendant sale: each recorded 1500 cents/unit, 7500 cents total, and exactly one stock deduction. All business requests reached the live Nest API and disposable PostgreSQL database; this suite mocked no responses.

Direct PostgreSQL inspection after these runs confirmed consecutive pricing versions 1–6 and exactly four sale movements: the independent fixture's quantities 7 and 2, then TesterArmy's quantities 5 and 5. Every sale retained the 1500-cent retail price and existing 1000-cent cost snapshot. The real API reported closing stock 11, consistent with opening stock 30 minus those 19 sold units.

The initial mobile preview failure is retained rather than hidden. Its trace records `[vite] server connection lost. Polling for restart...`, followed by full-page navigation and reset of the unsaved item selection. Test package files were being copied into the workspace at that time. The same unchanged test passed when rerun without concurrent workspace edits. This is classified as a development-environment interruption; no pricing or inventory defect was reproduced. The agent also initially attempted the offscreen mobile navigation link before opening the navigation menu and recovering.

Reproducible sources and pinned standalone dependencies: `tests/testerarmy/`; follow its README to create a new disposable fixture. The executed test/config/helper sources are preserved there. Framework artifacts are under `test-results/testerarmy/desktop/`, `mobile-initial/`, and `mobile-verified/`, including `report.json` and per-test `trace.md`. Final database evidence is in `persisted-evidence.json`, and cleanup verification is in `cleanup-evidence.json`.

TesterArmy withholds screenshots after filling a secret credential. Its evidence here is browser trees, action traces, model-call accounting, exact assertions, and persisted records; visual screenshots come from the independent browser run above.

## Database and HTTP regressions

**55/55 tests passed** across `apps/api/test/inventory.integration.spec.ts` (51) and `apps/api/test/pricing-http.integration.spec.ts` (4), via the existing `apps/api/test/run-integration.mjs` runner. It ran with `CI=1`, `DOTENV_CONFIG_PATH=/dev/null` and an explicit localhost URL for the disposable container; the runner created and dropped its own random database.

The populated-upgrade check applied the existing 15 migrations, created legacy stock/purchase/sale/return fixtures including missing historical snapshots, applied the one new migration, and confirmed existing business rows were unchanged. Compiled API builds also passed.

## Scope and limitations

No production/staging connections, deployment, customer data, external payments, or receipt delivery were exercised. The current stage supports previews; actual discounted checkout is not implemented. Chromium desktop/mobile emulation was tested, not physical devices or other browser engines. Label/focus/overflow checks are targeted accessibility checks, not a complete accessibility audit. Synthetic migration success does not establish production migration lock duration or actual customer-data readiness.

The initial test harness needed corrections to match the real 200 login response and to exclude intentional `aria-hidden` library inputs from its label check; these were test assumptions, not application defects. The fresh final run passed all eight scenarios.
