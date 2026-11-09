# Dependency security checks

Run `npm run security:check` on the lockfile before release. This checks installed production dependencies and fails for high/critical advisories. Run `npm audit --json` separately to review development tooling. These checks consult the current registry; an audit inventory is not proof of exploitability. CI wiring is intentionally left to the repository owner because this task excludes `.github` changes.

The November 2026 audit fix uses Nest's first patched 12.x platform release (12.3.0, bringing Express 5.3.0/body-parser 2.4.0 and Multer 2.5.0), Zod 4.6.6, Vite 8.3.3, and source-map-js 1.2.2. No force upgrade or framework major upgrade was used. Zod has no patched v3 release for GHSA-mrhx-c7xc-m3w5; v4 is explicitly reviewed with strict input, UUID normalization, quantity/date limits and overflow regressions. Existing application schemas use the supported API without source changes.

Reachability: Nest's JSON parser is public, so the compressed-request body-parser issue is relevant. No application Multer interceptors/file filters exist, but its installed API runtime copy is patched. Zod validates return/valuation requests and environment settings. Vite editor/file-serving advisories affect development servers, and source maps are tooling input; patching them does not establish prior public API exposure. Do not expose a development server to untrusted networks.

Advisories: [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828), [Multer](https://github.com/advisories/GHSA-q7qp-rjg7-q26m), [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). See the implementation report for the exact resolved inventory and any remaining advisories.

Remaining production audit entries (7 November 2026): four moderate entries, `@sentry/node` → `@sentry/bundler-plugins` → `glob`/`minimatch`. They concern build/source traversal and cancellation; no user-supplied glob pattern is passed by the application's API code. Their telemetry/toolchain upgrade is deferred to keep this security change limited to the requested high-severity patches. Both production-only and full audits report zero high/critical entries after the fix; rerun at release because advisories change.

## F15 moderate advisory patch (2026-11-09)

- Bumped `@sentry/node` to `^11.11.0` in `apps/api` (fixes the `@sentry/bundler-plugins` glob/minimatch advisory; its `glob` is now 14.0.4).
- Refreshed within-major dev tooling via `npm update`: `@nestjs/cli` 12.0.12, `vitest` 4.1.12, `fast-uri` 3.1.9.
- `npm audit`: 32 total (18 moderate, 14 high) before, 25 total (11 moderate, 14 high) after. `npm audit --omit=dev` reports 0. No high entries were touched; the 14 high entries are outside this change (Prisma/undici/sharp/chevrotain and related) and still need their own review.
- Remaining moderate entries have no non-major fix: `glob` 13 via `@vercel/nft` and `@prisma/compute-sdk` (Prisma 7 major), `valibot` via Prisma, `minimatch` 10.x via `typescript-eslint` (every 10.x is in the advisory range, so no in-major pin exists), `@effect/vitest`/`@vitest/mocker` via Prisma. `npm audit` proposes Prisma 7 and typescript-eslint 8.36 (a downgrade); not applied. No `overrides` were added.
- The earlier note above said "four moderate entries"; the live inventory was 18 moderate, of which the Sentry chain was one group.
- Verified: `security:check` 0 vulnerabilities; `api:test` 25 files / 223 tests passed; `api:build`, `web:build`, `web:lint` exit 0.
