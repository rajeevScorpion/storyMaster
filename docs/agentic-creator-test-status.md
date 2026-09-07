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

### Phase 2a — persona schema, logic and catalogue UI (2026-09-06)

| Gate | Result | Delta vs baseline |
|---|---|---|
| `npx tsc --noEmit` | pass | none |
| `npm run lint` | pass | none — still 0 warnings |
| `npm test` | pass | **87 files, 614 tests, 614 passed** (+1 file, +20 tests) |
| `npm run build:verify` | pass | `/admin/agents/personas` added to the manifest as `ƒ` |
| `npm run test:e2e` | not run | This phase adds no signed-out surface; last green run was Phase 1 |

**New tests:** `lib/agentic/personas.shared.test.ts`, 20 tests. The load-bearing ones assert the image
gate from both directions — an image-off persona resolves to `prompt_only` even when an override
explicitly asks for `'generate'`, and an image-on persona can still reach `'generate'`.

**Two review fixes, both with tests or comments pinning them:**

- The rollback's `DROP TABLE` order was wrong and the file would have failed to execute — see the
  implementation log. Not covered by any automated test; migrations are not exercised by the suite.
  **This is a standing gap: rollback files are only ever validated by reading them.**
- `isMissingPersonaSchemaError` was matching on message text and would have classified a duplicate-slug
  violation as a missing migration. The pre-existing test missed it because its 23505 fixture used a
  message without the table name. Fixture replaced with a realistic one, plus a check-constraint case.

**Not covered:** everything in the catalogue UI. With migration 103 unapplied there are no rows to
render, and Playwright cannot sign in as admin. Filters, the editor drawer, clone, and the two empty
states are **unverified in a browser.**

### Phase 2b — the 15 seed personas (2026-09-06)

SQL only; the suite does not exercise migrations. Validated by script against the migration's own text:
15 unique slugs, 15 valid JSONB blobs, exactly 3 per age group and 3 per language, every identifier
checked against the real code constants, all 15 image-off / narration-off / draft / `prompt_only`, no
unterminated string literal, balanced parens, rollback slug list matching the insert list.

**Then verified live** after the owner applied 102–105 to staging: 15 personas, **15
`agent_persona_memory` rows created by the migration-103 trigger**, 0 image-on, 0 narration-on, 0
non-draft, 0 with a bad image mode, 6 flags present and 0 enabled.

### Phase 3 — story memory and novelty checks (2026-09-07)

| Gate | Result | Delta vs baseline |
|---|---|---|
| `npx tsc --noEmit` | pass | none |
| `npm run lint` | pass | none — still 0 warnings |
| `npm test` | pass | **88 files, 641 tests, 641 passed** (+1 file, +27 tests) |
| `npm run build:verify` | pass | no route change |
| `npm run test:e2e` | not run | no signed-out surface changed; last green run was Phase 1 |

**New tests:** `lib/agentic/memory.shared.test.ts`, 27 tests. Six cover series continuity from both
directions — the case the module exists to get right. Two pin `trigramSimilarity` against values
measured on the live staging database with `select similarity(...)`; they matched to six decimal
places, so the claim that the in-process scorer agrees with the SQL index is now tested rather than
asserted. This is the failure that would otherwise be invisible: if the two drift, the GIN index
silently stops surfacing rows the scorer would have flagged, with no error anywhere.

**Not covered — be honest about this:**

- `lib/agentic/memory.ts` has **no unit tests.** It is `server-only` and every function takes a live
  Supabase client, and this repo has no harness for that (consistent with the rest of the codebase,
  where tests target the `.shared.ts` halves). Its column names were verified by querying
  `information_schema.columns` on staging, not by test.
- **`runNoveltyCheck` has never executed end to end.** No novelty check has run against real data, the
  adjudication model call has never been made, and no `agent_novelty_checks` row has ever been written.
- The backfill has never been run.
