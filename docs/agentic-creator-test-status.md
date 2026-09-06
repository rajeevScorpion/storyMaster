# Agentic Creator — Test Status

## Baseline (before any agentic-creator code)

- Date: 2026-09-06
- Branch: `feat/agentic-creator`
- Base commit: `1d93dea`

| Gate | Command | Result | Notes |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | pass | clean, zero errors, exit code 0 |
| Lint | `npm run lint` | pass | 0 warnings, 0 errors, exit code 0 |
| Unit tests | `npm test` | pass | 86 files, 594 tests, 594 passed, 0 failed |
| Production build | `npm run build:verify` | pass | built into `.next-verify/`, compiled in 11.9s, TypeScript check in build finished in 3.1s, all 48 pages generated, no errors |
| E2E smoke | `npm run test:e2e` | pass | 14 passed, 0 failed, 20.8s, chromium, 1 worker; agent dev server started on port 3100 (pid 4544) and was stopped afterward via `npm run dev:agent:stop` |

### Pre-existing failures

None. All five gates passed cleanly on the base commit before any agentic-creator code was introduced.

Minor non-error notices observed (not failures, recorded for completeness):
- `npm run build:verify` printed a routine Browserslist staleness notice (`caniuse-lite` data is 6 months old, suggests `npx update-browserslist-db@latest`) — informational only, does not affect build success.
- `npm run build:verify` reported that Next.js auto-reconfigured `tsconfig.json`'s `include` array to add `.next-verify/types/**/*.ts` and `.next-verify/dev/types/**/*.ts` during the build, then restored the generated files (`next-env.d.ts`, `tsconfig.json`) afterward — this is the script's own documented behavior (`scripts/agent-build.mjs` builds into `.next-verify/` and restores generated files when done), not a modification left behind.
- Playwright's chromium browser was already installed; no `npx playwright install chromium` was needed.

## Per-phase deltas

### Phase 1 — feature isolation and admin shell (2026-09-06)

| Gate | Result | Delta vs baseline |
|---|---|---|
| `npx tsc --noEmit` | pass | none |
| `npm run lint` | pass | none — still 0 warnings |
| `npm test` | pass | 86 files, 594 tests, 594 passed — **identical to baseline** |
| `npm run build:verify` | pass | `/admin/agents` added to the route manifest as `ƒ` (dynamic) |
| `npm run test:e2e` | pass | 14/14, 19.0s. Agent dev server started on 3100 and stopped afterwards |

**New tests:** none. This phase adds no pure logic worth pinning; the nav tree it touches is already
covered by `lib/admin/nav.test.ts`.

**Test file modified:** `lib/admin/nav.test.ts` — `/admin/agents` added to the hub-self-link
exclusion list in the duplicate-href test, alongside the pre-existing `/admin/settings` and
`/admin/pricing`. Reviewed: this follows the established pattern for a hub item that deliberately
shares an href with its overview child. It does not weaken the assertion.

**Not covered:** Playwright runs signed-out, so it proves only that `/admin/agents` stays behind the
admin guard — the same thing `smoke.spec.ts` already asserts for `/admin`. The Overview page's
toggles, the off-state card and the disabled-subordinate behaviour are **unverified in a browser**;
they need an admin session. Worth a manual pass once migration 102 is applied to dev.
