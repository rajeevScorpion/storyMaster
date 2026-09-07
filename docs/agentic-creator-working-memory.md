# Agentic Creator — Working Memory

Short and current. Read this first at the start of every session, before touching code.
Longer-lived material lives in the sibling docs: `-architecture.md`, `-decisions.md`,
`-implementation-log.md`, `-test-status.md`.

---

## Session handoff — 2026-09-07 (end of session, 90% usage ceiling)

**Phase 6 is code-complete except the Test Lab UI (6c).** Nothing has ever executed:
no live database call, no real Gemini response, flags off everywhere. That is the
single most important fact for whoever picks this up.

### Commits this session (all on `feat/agentic-creator`, all independently verified)

| SHA | What |
|---|---|
| `e89f9ef` | 6a — seed authoring extracted; `saveStoryForUser`; agentic billing bypass |
| `95fe875` | Docs corrected; production promotion checklist |
| `ce0d61a` | Pure story assembly — canonical map linking, 18 tests |
| `8198a6c` | `clampBeatCount` deduplicated and hardened (zero-beats bug) |
| `06b23cf` | Headless story assembly pipeline (`storyAssemblyExecutor`) |
| `253b790` | Defensive warning at the read that guards against double-charging |

Gate at handoff, re-run independently rather than taken on report:
**92 files / 729 tests passing, `npx tsc --noEmit` exit 0, `npm run lint` clean.**

### THE NEXT STEP — Phase 6c

Two pieces remain before the vertical slice is provable:

1. **Wire `storyAssemblyExecutor` into `drainAgentRuns`.** It is exported from
   `lib/agentic/story-assembly.ts` but deliberately not yet the default executor.
   Keep `defaultAgentRunExecutor` exported (the deferral path and tests want it).
2. **`createRunForTask()` still has no caller** — nothing turns a commissioned
   `agent_task` into an `agent_run`, so the pipeline has no input. At drain time,
   create runs for tasks in status `commissioned`/`assigned` with no live run.
   A duplicate insert raising `23505` is the partial unique index
   (`idx_agent_runs_active_task`) doing its job — swallow it as a benign race, never
   surface it as an error. Skip `is_test = true`; only `status = 'active'` personas.
3. **`/admin/agents/test-lab`** — pick a persona, run the pipeline with
   `agent_tasks.is_test = true`, show brief / source text / seed plan / resolved
   config / model routing / both novelty verdicts. Test runs must **never** reach
   `agent_story_memory` or the gallery. A separate explicit button promotes to a draft.

### Things that will bite you if you do not know them

- **`saveStory` cannot be called headlessly.** It resolves the user from a cookie
  session and throws `'Not authenticated'` in a worker. Use `saveStoryForUser` from
  `lib/story/save-story.ts` with `createAdminClient()`. **Never export
  `saveStoryForUser` from a `'use server'` file** — it takes a caller-supplied
  `userId`, so as a server action any browser could save a story as another user.
- **The double-charging guard is load-bearing and fragile.** `story_generated` makes
  ~2N+2 paid calls for N beats. It persists progress to `agent_runs.checkpoint` after
  every beat AND mutates `run.checkpoint` in place, because `advanceRun` reads that
  field after the executor returns and would otherwise overwrite the progress with a
  stale value. Hoisting that read above the executor call silently restores
  double-charging — correct stories, duplicated spend, no error. See the comment at
  `lib/agentic/orchestrator.ts` in the `outcome.kind === 'advanced'` branch.
  Verified: `returnRunToPending` and `handleStageFailure` never write `checkpoint`, so
  progress survives both the time-budget deferral and a failed-then-retried run.
- **Never return `deferred` for the narration/evaluation stages.** Deferring returns
  the run to `pending` without consuming an attempt, so it would loop forever and
  never reach `awaiting_review`.
- **`AGENTIC_SYSTEM_USER_ID` is set on dev only.** Unset or mismatched, the billing
  bypass stops matching and runs are *denied* — fail-closed, but it presents as
  "agent runs mysteriously fail", not as a config error.

### Known limits accepted this session, not defects

- Agent spend reuses existing `PricingActionKey`s (`preview_seed_plan`,
  `start_story_initial_beat_prompt_only`), so it is indistinguishable from human spend
  *by action key*. `activity_key = 'agentic_creator'` does separate it, so `/admin/cost`
  stays accurate. Revisit in Phase 12.
- Checkpoints store full `StoryBeat` objects. Safe now — this stage emits only text
  prompts, never image bytes. **If a future phase moves portrait generation into this
  stage, beats must be trimmed first** or the row size becomes a real problem.
- The five agentic TaskKeys are absent from every admin model editor (they are excluded
  from `PromptTaskKey`). Persona `model_overrides` is the only working lever.

### Still open, none blocking

- Run `docs/snippets/107-verify-run-dedup.sql` by hand — the dedup index half of the
  no-double-charge guarantee is argued, not proven.
- **No agentic admin surface has ever been opened in a browser.** Playwright runs
  signed-out and cannot cover it.
- Run the memory backfill on staging (`runStoryMemoryBackfillBatch()`, needs
  `agentic_creator_enabled` on) so the first agent story is checked against a real
  catalogue rather than an empty table.
- Production: see the promotion checklist in `docs/agent-context/PROJECT_STATE.md`.
  It needs its **own** `AGENTIC_SYSTEM_USER_ID` (a different UUID from dev's), not just
  the migrations. `CRON_SECRET` needs no action.

---

## Where we are

- **Phase:** 6a and 6b complete. Phases 1-5 shipped in full. The headless pipeline exists and
  compiles; **it has never run.** Phase 6c (wiring + Test Lab) is next and is what makes the
  vertical slice provable.
- **Branch:** `feat/agentic-creator`, cut from `dev` at `1d93dea`
- **Plan of record:** `C:\Users\User\.claude\plans\kisago-agentic-creator-prompt-pack-imple-refactored-dragon.md`
- **Source pack:** `prompt-packs/Kisago_Agentic_Creator_Prompt_Pack/` (17 files, read in full during planning)

## What works right now

**Migrations 102-107 are all applied on the dev/staging database** (102-105 on 2026-09-06, 106-107 on
2026-09-07), re-verified against `schema_migration_ledger` on 2026-09-07. Verified by query, not assumed:

- Six `agentic_*` flags exist, **all still `false`**. `lib/agentic/flags.ts` is the single read path,
  always with `fallback = false`.
- **15 seed personas, and 15 `agent_persona_memory` rows** — the memory rows were created by the
  migration-103 AFTER INSERT trigger, so the pack's "every persona automatically receives memory"
  requirement is verified live rather than assumed.
- All 15 personas are image-off, narration-off, `status = 'draft'`, `schedule_eligible = false`, with
  `default_story_config.imageGenerationMode = 'prompt_only'`. Zero exceptions on any of those.
- `agent_story_memory` and `agent_novelty_checks` exist and are empty.
- `/admin/agents` renders an Overview page: an off-state explainer, the master kill switch, and five
  subordinate toggles disabled while the master switch is off.
- `/admin/agents/personas` renders a filterable catalogue with create, edit, clone and status actions.
- `lib/agentic/personas.shared.ts` turns a persona into a real `StoryConfig`, forcing
  `imageGenerationMode: 'prompt_only'` for any image-off persona as its last, unconditional step.
- `lib/agentic/memory.shared.ts` scores novelty deterministically; `lib/agentic/memory.ts` fetches
  priors, calls the economy-tier adjudicator only inside the ambiguous band, and records every verdict.
  `trigramSimilarity` is **verified exactly equal** to Postgres `pg_trgm.similarity()` on five pairs
  measured against staging, and those values are pinned as a test.
- `lib/agentic/supervisor.shared.ts` computes catalogue coverage and ranks gaps **deterministically**
  (stable ordering is a tested property — an unauditable supervisor is worse than none), and validates
  model-written commission proposals as hostile input. `supervisor.ts` skips the model call entirely when
  there are no gaps or no active personas.
- `/admin/agents/tasks` renders the coverage report, the task pool, and a two-step commissioning flow
  where proposals are shown for human sight-check before any row is written. Rejected proposals and their
  reasons are shown too, never hidden.
- **Nothing generates anything yet.** No jobs, no runs, no story writing. `runNoveltyCheck` has never
  executed end to end, `proposeCommissions` has never made a model call, and `commissionTasks` has never
  written a row. The pure halves are well covered; every server half is unproven at runtime.

**Today's real state is the one to design against:** all 15 personas are `status = 'draft'` (so zero are
commissionable) and migration 106 is unapplied (so every task query returns empty). Both are handled
explicitly rather than incidentally — that is why the three empty states are distinguished in the UI.

## Next step

**Phase 6b — headless story assembly.** See "What Phase 6a shipped" below for the seams it plugs into.

### Superseded: Phase 5b (complete, landed at `78e8aaa`)

**Phase 5b — worker route, reconcile integration, runs admin page.** Migration 107 and its
schema, the pure state machine, routing, and the orchestrator itself are done (5a, below). Still
needed: a `CRON_SECRET`-guarded `app/api/agentic/run/route.ts` that calls `drainAgentRuns()`; an
`agentic_scheduler_enabled`-guarded call from the existing daily `/api/batch/reconcile` tick —
**wrapped so an agentic failure can never break the narration and image reconcile work that
already runs there**; and `/admin/agents/runs` (list + `agent_run_events` timeline, using
`app/actions/agentic-runs.ts`, already written). `kickAgenticWorker()` (the admin "Run now"
button's server action) belongs here too, once the worker route it calls exists.

### What Phase 6a shipped (commit `e89f9ef`)

Groundwork only, **zero behaviour change** — verified by re-running the gate independently
(tsc 0, lint 0, 91 files / 715 tests, exactly baseline) and by diffing the moved bodies line by line.

- `lib/ai/seed-authoring.ts` — `generateSeedPlanPreview` and `materializeSeededBeat` moved out of the
  `'use client'` `app/actions/story-runtime.ts` into a directive-free dual-context module, mirroring
  `lib/ai/beat-orchestration.ts`. `story-runtime.ts` re-exports them, so `story-store.ts`,
  `LandingScreen.tsx` and `ContinueAsEpisodeDialog.tsx` are untouched — confirmed by `git show --stat`.
- `lib/story/save-story.ts` (`server-only`) — `saveStoryForUser(supabase, userId, session, storyMap, options?)`.
  **`saveStory` could not be called headlessly**: it resolves the user from a cookie session and throws
  `'Not authenticated'`, which a cron worker always would. `saveStory` is now a thin cookie-bound wrapper
  over it. The move was larger than planned (656 lines) because the row-shaping helpers are shared with
  `saveBeat`/`loadStory` and a `'use server'` file can only export async functions; they moved too and are
  imported back. Verified no invented logic: every added line is an import, an `export` prefix, a
  `user.id` -> `userId` swap, or the two optional provenance keys.
  **`saveStoryForUser` must never be exported from a `'use server'` file** — it takes a caller-supplied
  `userId`, so as a server action it would let any browser save a story as another user.
- `lib/pricing/enforcement.ts` — an `agentic_system` bypass branch ahead of `admin_bypass`, requiring all
  three of `actorKind === 'agentic_system'`, the `agentic_billing_bypass_enabled` flag, and
  `userId === AGENTIC_SYSTEM_USER_ID`. `actorKind` is checked first so the human path does no extra I/O.
- `AGENTIC_SYSTEM_USER_ID` added to `.env.example` and `docs/onboarding-new-machine.md`. **Created on dev
  and set in `.env.local` on 2026-09-07.**

Corrections to the plan found while verifying 6a, for whoever picks up 6b:

- `CostActivityKey` (`lib/ai/cost-telemetry.shared.ts:10`) is a **closed union** with no `agentic_creator`
  member — the plan assumed the key just works. It must be added. There is **no CHECK constraint** on
  `ai_cost_events.activity_key` (verified against dev), so this is a TypeScript change with no migration.
- `app/admin/cost/page.tsx:59` holds a label map keyed by activity key; a new key needs a label there or
  the dashboard renders the raw string.

### What Phase 5a actually shipped

- `supabase/migrations/107_agent_runs.sql` + rollback — `agent_runs`, `agent_run_events`,
  `agent_schedules`. Written, **not applied anywhere yet**.
- `lib/agentic/orchestrator.shared.ts` (pure, tested): the stage machine (`STAGE_SEQUENCE`,
  `nextStage`), the checkpoint contract (`isCheckpointed`/`recordCheckpoint` — the idempotency
  guarantee that stops a retry from paying twice), retry/backoff, stale-run detection, and
  `classifyRunError`/`isMissingRunSchemaError` (its own dedicated latch classifier for 107).
- `lib/agentic/routing.shared.ts` (pure, tested): `AGENT_TASK_ROLES` and `resolveAgentModel()`,
  precedence persona override → model_config row → `DEFAULT_MODELS`.
- `lib/agentic/orchestrator.ts` (`server-only`): `reclaimStaleAgentRuns`, `createRunForTask`,
  `appendRunEvent`, `drainAgentRuns(budgetMs, executor?)`, plus `listRuns`/`getRun`/`cancelRun`/
  `retryRun` for the admin surface. Fails closed on migration 107 (its own latch, never reused)
  and on the master flag (`drainAgentRuns` returns 0 without touching `agent_runs` when
  `agentic_creator_enabled` is off).
- **Story generation does not exist yet — that's Phase 6, deliberately.** `drainAgentRuns` takes a
  `StageExecutor` and defaults to `defaultAgentRunExecutor`, which defers on the very first
  content-generation stage (records an `agent_run_events` entry, returns the run to `pending`
  without consuming an attempt) rather than inventing generation or failing the run. This is the
  one seam Phase 6 plugs a real executor into.
- `app/actions/agentic-runs.ts` (`'use server'`): `listRunsAction`, `getRunAction`,
  `cancelRunAction`, `retryRunAction`. No `kickAgenticWorker` — see Phase 5b above.
- Three new TaskKeys (`agent_story_brief`, `agent_seed_story_writing`, `agent_story_evaluation`) in
  `lib/ai/model-config.shared.ts`, all added to the `PromptTaskKey` exclusion list in
  `lib/ai/prompt-config.shared.ts` alongside the existing two agentic keys.
- Gate: `npx tsc --noEmit` clean, `npm run lint` warning-free, `npm test` 91 files / 714 tests
  passing (baseline 89/675 + 39 new), `npm run build:verify` green.

Still worth doing, neither blocking:

- **Run the memory backfill on staging.** `runStoryMemoryBackfillBatch()` seeds `agent_story_memory` from
  published storylines so the first agent story is checked against the real catalogue instead of an empty
  table. Requires `agentic_creator_enabled` on. Call repeatedly until `done`; resumable and idempotent.
- **Browser-verify the admin surfaces** — see Blockers.

## Blockers

None blocking work. Two open items:

- **Production has none of 102-107, and needs two more things besides the migrations.** See the
  "Promoting the agentic system to production" checklist in `docs/agent-context/PROJECT_STATE.md`:
  prod needs its own `AGENTIC_SYSTEM_USER_ID` auth user (a *different* UUID from dev's, set as a Vercel
  env var), while `CRON_SECRET` needs no action. Nothing on prod changes until then, by design.
- **No agentic UI has been browser-verified yet.** Staging has real persona rows, so `/admin/agents` and
  `/admin/agents/personas` are worth a manual pass with an admin session — filters, the editor drawer,
  clone, and the toggle round-trip. `/admin/agents/tasks` needs migration 106 first to show anything but
  its empty state. Playwright cannot cover any of this; it runs signed-out.

## Active flags

All six exist in migration 102 and default to `false`. Read them **only** through
`lib/agentic/flags.ts` — never call `getFeatureFlag` with these keys directly, or the fail-closed
guarantee stops being a guarantee.

| Flag | Purpose |
|---|---|
| `agentic_creator_enabled` | Master kill switch — off means no route, no worker, no generation |
| `agentic_scheduler_enabled` | Lets the daily reconcile cron drain the agent queue |
| `agentic_supervisor_enabled` | Lets the Editorial Supervisor commission tasks |
| `agentic_reviewer_workflow_enabled` | Turns on `/admin/authors` and the review queue |
| `agentic_billing_bypass_enabled` | Lets the system user skip the coin reserve (telemetry still recorded) |
| `agentic_image_generation_enabled` | Global gate above each persona's own image permission |

## Migrations

| # | File | Phase | dev | prod |
|---|---|---|---|---|
| 102 | `102_agentic_creator_flags.sql` | 1 | **APPLIED** 2026-09-06 | not applied |
| 103 | `103_agent_personas.sql` | 2a | **APPLIED** 2026-09-06 | not applied |
| 104 | `104_seed_agent_personas.sql` | 2b | **APPLIED** 2026-09-06 — 15 personas, 15 memory rows | not applied |
| 105 | `105_agent_story_memory.sql` | 3 | **APPLIED** 2026-09-06 | not applied |
| 106 | `106_agent_tasks.sql` | 4 | **APPLIED** 2026-09-07 | not applied |
| 107 | `107_agent_runs.sql` | 5 | **APPLIED** 2026-09-07 | not applied |
| 108–110 | evaluation / reviewers / labels | 7, 9, 11 | not written | not written |

Migrations are applied **by hand by the owner** in the Supabase dashboard, per environment.
Never run the Supabase CLI. Verify with
`select * from public.schema_migration_ledger where migration_number between 102 and 110;`

## Files that matter most

| Path | Why |
|---|---|
| `lib/ai/seed-authoring.ts` | Phase 6 creates it by **moving** two functions out of `app/actions/story-runtime.ts` |
| `app/actions/story-runtime.ts` | `'use client'`; keeps re-exporting the moved functions so no consumer changes |
| `lib/ai/beat-orchestration.ts` | The precedent for a directive-free dual-context module — copy its header rationale |
| `lib/media/image-job-runner.ts` | The claim / reclaim / re-kick pattern `lib/agentic/orchestrator.ts` copies (re-kick itself is Phase 5b, in the worker route) |
| `lib/agentic/orchestrator.shared.ts` | The stage machine + checkpoint contract Phase 6 must respect: `isCheckpointed`/`recordCheckpoint` is what stops a retry from double-billing a model call |
| `lib/agentic/orchestrator.ts` | `drainAgentRuns`'s `StageExecutor` parameter is Phase 6's plug-in point — see `defaultAgentRunExecutor` |
| `lib/ai/character-novelty.shared.ts` | Existing similarity helpers the novelty check reuses instead of rewriting |
| `lib/ai/model-config.shared.ts` | Add agentic `TaskKey`s here and the admin model editor picks them up free |
| `lib/pricing/enforcement.ts` | `authorizeBillableAction` L212; the `admin_bypass` branch at L279 is the model for the agentic bypass |
| `lib/admin/nav.ts` | Single source of truth for admin navigation |

## Test state

See `agentic-creator-test-status.md`. Pre-existing failures recorded there are **the baseline** and
must never be attributed to this work.
