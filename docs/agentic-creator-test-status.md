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

### Phase 4 — Editorial Supervisor, task pool and admin surface (2026-09-07)

| Gate | Result | Delta vs baseline |
|---|---|---|
| `npx tsc --noEmit` | pass | none |
| `npm run lint` | pass | none — still 0 warnings |
| `npm test` | pass | **89 files, 675 tests, 675 passed** (+1 file, +34 tests) |
| `npm run build:verify` | pass | `/admin/agents/tasks` added to the manifest as `f` (dynamic) |
| `npm run test:e2e` | not run | no signed-out surface changed; last green run was Phase 1 |

Both delegations reported their own gate numbers; **the typecheck, suite and lint were re-run
independently afterwards and matched.** Agent-reported results are not accepted as verification here.

**New tests:** `lib/agentic/supervisor.shared.test.ts`, 33 tests, plus one additive assertion in
`lib/admin/nav.test.ts` (reviewed: purely additive, no existing assertion weakened or removed).

The tests that matter most pin the state the system is **actually in today**, not a hypothetical one:
with zero active personas the coverage matrix yields no servable cells and gap ranking returns empty.
That is the first thing that will really happen, and it must be provably calm rather than a crash or a
garbage proposal. `rankCoverageGaps` is also pinned as deterministic — same input, identical order —
because a supervisor that answers the same question differently each time cannot be audited.
`validateCommissionProposals` has one test per rejection reason, treating model output as hostile.

**Not covered — be honest about this:**

- **Nothing in Phase 4 has touched a real `agent_tasks` table.** Migration 106 is applied nowhere, so
  every query in `lib/agentic/supervisor.ts` currently returns via its fail-closed path. The happy path
  of every read and write in that file is unexercised.
- **`proposeCommissions` has never made a model call**, and `commissionTasks` has never written a row.
  The prompt builder and the response validator are tested; the round trip between them is not.
- **No browser verification.** `/admin/agents/tasks` has never been rendered with an admin session.
  Playwright runs signed-out and cannot reach it.
- `lib/agentic/supervisor.ts` has no unit tests, for the same reason as `memory.ts`: it is `server-only`
  and needs a live Supabase client, which this repo has no harness for.
- **A standing gap, unchanged:** rollback files are validated only by reading them. 106's drop order was
  reviewed by hand against the bug found in 103, not by execution.

### Phase 6c — wiring, enqueue, and the Persona Test Lab (2026-09-07)

## Phase 7 (complete: units 7a-7d) — 2026-09-08

| Gate | Result | Delta vs Phase 6c |
|---|---|---|
| `npx tsc --noEmit` | pass | none |
| `npm run lint` | pass | none — still 0 warnings |
| `npm test` | pass | **94 files, 833 tests** (from 93/752): +69 `evaluation.shared.test.ts` (+1 file), +3 source-fidelity, +5 `resumeStageFromCheckpoint`, +4 `toEvaluatedBeats` |
| `npm run build:verify` | pass | no route change — Phase 7 adds no page; 7c and 7d both extend existing admin surfaces |
| `npm run test:e2e` | pass | **15 passed, 0 skipped** on the units. One later full-suite run had `auth-dialog.spec.ts:52` fail and then pass 3/3 in isolation — untouched by this phase, recorded as suspected flake, **not proven one** |

Every gate above was re-run independently after each delegated unit landed, not taken on report.
Reading the diff caught six defects the 821 tests could not — two of them unreachable without a
live database (a thrown read that could still fail the "cannot fail" stage; a time-budget guard
that could never fire), fixed in `09be807`; the rest were comments, docs or rendered copy that
asserted something untrue, the last of them in 7c's own panel (`1cff69f`). All are recorded in the
working-memory handoff.

**Unit 7c adds no test.** It is a client component reading a server action, and this repo has no
component-render harness — the `/admin/agents/runs` e2e assertion covers that the page still
renders, and the three-state panel logic is a ternary over data the run row already carries. Worth
naming rather than leaving implicit: the panel's correctness currently rests on the diff review
above and on the fresh run that has **not yet happened**, not on the suite.

`lib/agentic/evaluation.ts` has **no unit tests, deliberately** — it is `server-only`, so vitest
cannot import it, exactly like `memory.ts` and `story-assembly.ts`. Everything decidable without a
database lives in `evaluation.shared.ts` and is tested there.

---

## Phase 6c — 2026-09-07

| Gate | Result | Delta vs Phase 6b |
|---|---|---|
| `npx tsc --noEmit` | pass | none |
| `npm run lint` | pass | none — still 0 warnings |
| `npm test` | pass | **93 files, 747 tests** (from 92/729): +9 `selectTasksToEnqueue`, +9 `buildTestLabBrief`, +1 file |
| `npm run build:verify` | pass | `/admin/agents/test-lab` added to the route manifest as `ƒ` (dynamic); 48 → 48 static pages |
| `npm run test:e2e` | pass | 14 passed, **1 skipped**. Agent dev server started on 3100 and stopped afterwards |

Every gate above was re-run independently after the delegated work landed, not taken on report.

**New tests, and why these and not others.**

- `selectTasksToEnqueue` (9 tests) pins the enqueue *eligibility policy*, which is the part worth
  testing: a null persona is never eligible, a non-`active` persona is never eligible, ordering is
  oldest-first with `id` as a tiebreaker so the same input always enqueues the same tasks in the same
  order regardless of the order Postgres returned rows in, `limit <= 0` yields nothing, and the input
  array is never mutated. The determinism test runs the same set forwards and reversed and asserts an
  identical result — an enqueue that answers differently run to run cannot be reasoned about.
- `buildTestLabBrief` (9 tests) covers theme present / absent / whitespace-only, a persona with no
  speciality, a persona with no genres, and the length cap.

**The skipped e2e test is the one that matters most, and it is skipped silently.**
`e2e/agentic-admin.spec.ts` gained `/admin/agents/test-lab` this phase, but the whole spec is guarded by
`test.skip(!EMAIL || !PASSWORD)` and **`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` are not present in
`.env.local` on this machine**. The suite therefore reports green while proving nothing about any
agentic admin route. The previous session's handoff recorded this spec as passing, so the credentials
must have been supplied transiently and are gone. Setting them restores real browser proof with no code
change; until then, **no agentic admin surface — including the Test Lab — has been rendered in a
browser this session**.

**Not covered — be honest about this:**

- **Nothing in Phase 6c has executed.** `agentic_creator_enabled` is `false` on every environment, so
  `enqueueCommissionedTasks` has never created a run, `executeRunNow` has never claimed one, the
  `stopAfterStage` park has never happened against a real row, and the Test Lab has never generated a
  story. Every server function added this phase is unexercised at runtime.
- `lib/agentic/test-lab.ts` and the new code in `lib/agentic/orchestrator.ts` carry no direct unit tests,
  for the standing reason: both are `server-only` and need a live Supabase client, which this repo has no
  harness for. The pure halves (`test-lab.shared.ts`, `orchestrator.shared.ts`) are where the testable
  policy was deliberately placed.
- **Two defects this phase were found by diff review, not by tests, and no test would have caught either.**
  A migration-latch cross-wire that would have killed the run pipeline on a transient PostgREST error
  (`aa950db`), and a blind read-modify-write of `agent_runs.checkpoint` that could have erased completed
  beats or caused a second story to be saved (`3455430`). Both were silent-corruption class: correct-looking
  output, wrong state. This is the second phase running in which review, not the suite, caught the real bugs.
- **A standing gap, unchanged:** rollback files are validated only by reading them. No migration was added
  this phase, so nothing new was introduced here.
