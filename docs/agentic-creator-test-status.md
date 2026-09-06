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

_(appended as each phase lands)_
