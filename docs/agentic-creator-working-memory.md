# Agentic Creator — Working Memory

Short and current. Read this first at the start of every session, before touching code.
Longer-lived material lives in the sibling docs: `-architecture.md`, `-decisions.md`,
`-implementation-log.md`, `-test-status.md`.

---

## Session handoff — 2026-09-08 (Phase 7 core landed; the evaluator has NOT yet run)

**Phase 7's two code units are done and independently verified.** The `evaluated` stage is no
longer a free advance: it computes a real grade, records it, and hands the run to a human. What is
**not** done: the admin surface (Unit 7c) and the Test Lab preview (Unit 7d). Both were designed
and agreed with the owner, neither is written.

### The decision this phase turned on — read before touching the evaluator

**An evaluation never stops a run.** The `evaluated` stage has no failure path at all. Not a
missing persona, not a missing checkpoint, not a model timeout, not an unapplied migration 108 —
every one becomes an `agent_run_events` warn line plus an advance. The only non-advance exit is
`deferred` (master flag off, or the run's budget already gone), which loses no work.

Why: by the time `evaluated` runs, `draft_created` has already saved a real row to `stories`.
`advanceRun` routes a thrown or `failed` executor outcome into `handleStageFailure`, and every
reviewer surface keys on runs at `awaiting_review`. Failing here strands a finished story —
invisible to review, still in the database, all the generation already paid for.

**And the model gets no vote on `verdict` or `review_readiness`, in either direction.** This
extends `32f2c65` rather than contradicting it. There, a model could *soften* a deterministic
verdict because a `block` was terminal and a too-harsh threshold would kill a good story — a rescue
valve with a real cost if absent. Here nothing is terminal, so there is nothing to rescue from, and
a softening vote would let an unauditable call talk a story past objective facts (wrong script,
restricted theme present, beats missing). Same principle, different stakes: **a model call may
never be the sole cause of an automatic consequence.** Full reasoning in decision **D9**.

### Commits this session, all reviewed by diff rather than by report

| SHA | What |
|---|---|
| `c0d33dc` | `evaluation.shared.ts` + tests, and migration 108 with its rollback twin |
| `464dbac` | **Review fix** — three corrections to the pure evaluator (below) |
| `59bf800` | `evaluation.ts` (server half) + the two `story-assembly.ts` wiring changes |
| `09be807` | **Review fix** — two holes in the stage that cannot fail (below) |

Gate, re-run independently rather than taken on report: **tsc 0, lint clean, 94 files / 821 tests
(+1 file, +69 from the 752 baseline), `build:verify` green, `test:e2e` 15 passed / 0 skipped.**

### What reading the diff caught that the tests did not

Five real defects, none of which the 821-test suite could have found — two are unreachable without
a live database, three are accuracy of the record.

1. **A thrown read could still fail the stage.** `runEvaluatedStage` awaited
   `getPipelineEvaluationForRun` bare. That function only swallows the schema-missing cases it
   latches on and rethrows everything else, and a thrown executor goes straight to
   `handleStageFailure`. One transient Postgres error would have stranded a saved draft — the exact
   outcome the whole stage exists to prevent. The "no failure path" rule was true of every branch
   that returned and false of the one line that threw.
2. **The time-budget guard was dead code.** It measured from `Date.now()` at the top of
   `runEvaluatedStage` and then checked after a flag read and three short queries — ~200ms against a
   20s budget, so it could never fire. Now measured from `run.claimed_at`, the meaningful origin: if
   `draft_created` already burned the pass's budget, this stage starts over it.
3. A comment claimed every JSON parser in the codebase strips markdown fences. It is false, and the
   subagent that wrote it had already verified it was false. Fence-stripping here is a deliberate
   *departure* from `parseStoryBrief`, and the comment now says why.
4. `detectDominantScript` counted **U+FEFF as an Arabic character** — it is the last code point of
   Arabic Presentation Forms-B but is the BOM, not a letter. The range now stops at U+FEFC.
5. The restricted-theme check's real coverage was overstated — see the known limit below.

### Things that will bite you if you do not know them

- **THE EVALUATOR HAS NEVER RUN, and the two existing drafts can never run it.** Both
  `awaiting_review` runs on dev (`e9cd7325`, `ca2bb41b`) already have `evaluated` in their
  `checkpoint`, banked by the Phase 6 placeholder that advanced the stage for free. `isCheckpointed`
  is therefore true and `advanceRun` applies the stage without calling the executor — forever.
  **Proving Phase 7 needs a brand-new run**, not a retry of either of those; `retryRun` does not
  clear the checkpoint.
- **Migration 108 is applied NOWHERE** — not dev, not prod. The code fails closed without it: the
  evaluation is still computed and still written into `agent_run_events`, only the persist is
  skipped. So a run today produces a grade in the timeline and no `agent_evaluations` row.
- **The restricted-theme check is effectively English-only against beat text.** Verified by query,
  not assumed: all 15 seeded personas store `restricted_themes` as English phrases, including the 12
  writing in Hindi, Bangla, Gujarati or Marathi. JS `\b` is defined over `[A-Za-z0-9_]` and never
  holds beside a Devanagari/Bengali/Gujarati/Arabic character. The `briefThemes` half works for
  every persona, because `buildStoryBriefPrompt` asks for themes *in English* while the prose goes
  in the target language. It fails **open** — a missed restriction, never a false one — and the
  model's `safety` dimension covers the same ground advisorily.
- **`evaluation.ts` has no unit tests, deliberately.** It is `server-only`, like `memory.ts` and
  `story-assembly.ts`, so vitest cannot import it. Everything decidable without a database lives in
  `evaluation.shared.ts` and is tested there. Do not add a mock-Supabase harness for it; that is not
  how this codebase is organised.
- **`getPipelineEvaluationForRun` is load-bearing, not defensive.**
  `idx_agent_evaluations_pipeline_run` is a *partial* unique index on `(run_id) WHERE
  trigger_source = 'pipeline'`, so a second pipeline insert is a constraint violation. Without the
  read-first check, a crash between the insert landing and the orchestrator's checkpoint write would
  make every retry pay for a fresh model call and then fail to record it at all.
- **`app/actions/gemini-proxy.ts` needed widening.** `AgenticJsonCallParams.task` never listed
  `agent_story_evaluation`, even though that TaskKey was pre-registered in `model-config.shared.ts`.
  Additive one-literal fix in `59bf800`. If Phase 8 adds a narration-side agentic call, expect the
  same gap.

### THE NEXT STEP

1. **Apply `108_agent_evaluations.sql` on dev** by hand in the Supabase dashboard. Then confirm:
   `select * from public.schema_migration_ledger where migration_number = 108;`
   `select count(*) from public.agent_evaluations;   -- expect 0`
2. **Start a fresh run** — Test Lab against a persona, then promote — and watch it reach
   `evaluated`. Verify:

```sql
select verdict, review_readiness, model_status, model_id,
       jsonb_array_length(warnings) as warning_count, scores
  from public.agent_evaluations;
select stage, level, message from public.agent_run_events
 where stage = 'evaluated' order by created_at;
select action_key, activity_key, phase from public.ai_cost_events
 where activity_key = 'agentic_creator' and phase = 'evaluated';
```

   Expect exactly one `agent_evaluations` row per run, one `evaluated` event, and one cost row with
   `phase = 'evaluated'` — and **no** coin movement on the system user (D9: telemetry, no reserve).
3. **Then Unit 7c** — surface the evaluation in `RunMonitor.tsx`'s expandable detail, beside the
   stage timeline and checkpoint JSON. `getRunAction` returns `AgentRunWithTimeline`; extend it
   using `listEvaluationsForRun`. No new route, no nav change — the existing `/admin/agents/runs`
   e2e assertion then covers it. Show `verdict`, `review_readiness`, `model_status`, the six scores,
   and every warning **with its `source` and `severity` visible**, so "the deterministic layer
   decided this" and "the model was uneasy" are never conflated.
4. **Then Unit 7d** — the Test Lab's free deterministic preview. The Test Lab parks at
   `story_generated`, before any draft exists, so `runDeterministicEvaluation` runs on the parked
   beats with no model call and no cost. Agreed as worth doing: you see the structural verdict
   before pressing "Create draft".

---

## Session handoff — 2026-09-07 (Phase 6c complete; THE PIPELINE HAS RUN)

**The Agentic Creator has generated stories.** Two complete five-beat drafts exist on dev, owned by
the system user, sitting at `awaiting_review`. Every claim below was measured, not argued.

| Proof | Result |
|---|---|
| Full pipeline, brief → 5 beats → draft | `awaiting_review` / `succeeded`, stories `6e627a39`, `be0080f7` |
| Canonical chain | beat 1 root; 2-4 linked by `parentId` + a real `selectedOptionId`; beat 5 ending with 0 options |
| Normal Kissago story | 5 normalized `beats` rows, 5 `story_map` nodes, root node present, provenance stamped |
| `agent_story_memory` before promotion | **0 rows** — the Test Lab safety property holds |
| Gallery | **0 storylines** — no autonomous publish |
| `image_generation_jobs` | **0** — `prompt_only` genuinely prevents image spend |
| `ai_cost_events` @ `activity_key='agentic_creator'` | 26+ real rows |
| System user beat balance | **5.00, unchanged** — the billing bypass works |
| Deferral/resume | 5 passes, `attempts 0/3` — every attempt returned, as designed |
| Novelty vs a real catalogue | story 2 flagged for reusing the character "Kabir" from story 1 |
| `e2e/agentic-admin.spec.ts` | **15 passed, 0 skipped** — all six agentic routes render for an admin |

**Running it immediately found three defects that review had not** (all fixed in `fe9406f`): the
headless session never set `currentBeat`, so no story could exceed one beat; the post-generation
novelty check ran *after* `recordStoryMemory`, comparing every story against itself and returning
`block` always; and deferral events were filed under the previous stage. A fourth was in the test
harness — `playwright.config.ts` never loaded `.env.local`, so the admin e2e spec had never run from
its own documented setup.

### Resolved 2026-09-08 — a `block` is decided once, by the tested layer (`32f2c65`)

The first live runs showed a `block` was neither stable nor auditable: it failed the stage, the
retry re-ran the whole check, and the adjudicator returned block, block, warn, block on identical
input -- so a block meant "blocked unless one of up to three coin flips disagrees". Worse, the
deterministic layer had never said block (2 reused names against `CHARACTER_REUSE_BLOCK_COUNT` 4);
the model alone escalated a warn into a terminal failure.

Both halves are fixed. `applyAdjudication` (pure, tested) lets the model soften a verdict but never
harden one, and an attempted escalation is still recorded in `reasons`. The verdict is cached under
its own checkpoint key -- **not** the `novelty_checked` stage key, which would make `isCheckpointed`
true and let advanceRun skip the stage entirely, sailing a blocked run straight past its block.

---

## Earlier in this session (code delivery)

**Phase 6 is code-complete, including the Test Lab (6c).** The pipeline is wired end to end:
a commissioned `agent_task` becomes an `agent_run`, `drainAgentRuns` advances it with the real
`storyAssemblyExecutor`, and `/admin/agents/test-lab` drives the whole thing on demand against a
persona of your choosing.

**It has now executed end to end** — see the proof table at the top. `agentic_creator_enabled` and
`agentic_billing_bypass_enabled` are **on** on dev as of this session.

### Commits this session (all on `feat/agentic-creator`, all reviewed by diff, not by report)

| SHA | What |
|---|---|
| `5e14249` | `storyAssemblyExecutor` is `drainAgentRuns`'s default, via a lazy dynamic import |
| `52b46e8` | Commissioned tasks become runs; task lifecycle follows; test runs excluded from the cron |
| `aa950db` | **Review fix** — the enqueue read must never latch migration 107 |
| `1b3f424` | **Review fix** — the Agents overview stopped listing shipped phases as missing |
| `9d96cd5` | Persona Test Lab server half, parked one stage before draft creation |
| `3455430` | **Review fix** — guarded the test lab's checkpoint write; netted `executeRunNow` |
| `f1ce8e9` | Persona Test Lab admin surface |

Gate at handoff, re-run independently rather than taken on report:
**93 files / 747 tests passing, `npx tsc --noEmit` exit 0, `npm run lint` clean,
`npm run build:verify` green (`/admin/agents/test-lab` present as a dynamic route), and
`npm run test:e2e` 14 passed / 1 skipped.** The skip is `e2e/agentic-admin.spec.ts` — see below.

### THE NEXT STEP — run it

Everything below is blocked on flags only. In order:

1. **Turn on `agentic_creator_enabled`** on dev, from `/admin/agents`.
2. **Turn on `agentic_billing_bypass_enabled` too — this is not optional in practice.**
   Every paid call in this pipeline costs **0.50 beats** (`preview_seed_plan`,
   `start_story_initial_beat_prompt_only`, `continue_story_new_beat_prompt_only` — verified
   against `pricing_action_costs` on dev). A run costs `1.5 + N` beats for an N-beat story;
   persona `beat_count_min` ranges 4-8, so **5.5 to 9.5 beats per run**. The system user has
   **one grant with 5.00 beats remaining**. Without the bypass (or a top-up to ~20 beats)
   every run dies on `insufficient_balance` near the end, after real Gemini spend on the calls
   that already succeeded. Recoverable — the completed beats are checkpointed, so a top-up and
   retry resumes rather than re-paying — but it presents as a pipeline bug and is not one.
3. **Run `/admin/agents/test-lab`** against a persona. Then verify against the database:

```sql
select id, stage, status, attempt_count, jsonb_object_keys(checkpoint) from public.agent_runs;
select stage, level, message, created_at from public.agent_run_events order by created_at;
select action_key, activity_key, phase from public.ai_cost_events where activity_key = 'agentic_creator';
select count(*) from public.agent_story_memory;   -- MUST still be 0 before promotion
select count(*) from public.image_generation_jobs where created_at > now() - interval '1 hour';  -- expect 0
```

4. **Then press "Create draft"** and re-check: `agent_story_memory` gains exactly one row,
   `agent_runs.story_id` is stamped, and the task moves to `awaiting_review`.

### Things that will bite you if you do not know them

- **An admin can read an agent draft but cannot edit or continue it.** `stories` RLS on dev:
  SELECT is permissive (`is_archived = false AND auth.uid() IS NOT NULL`), UPDATE is owner-only
  (`auth.uid() = user_id`). Agent drafts are owned by `AGENTIC_SYSTEM_USER_ID`, so `/story/[id]`
  renders for an admin and then refuses every write. **The plan's Phase 6 acceptance criterion —
  "it renders, is editable, continues normally" — is therefore only half reachable.**
  This lands squarely on **Phase 9**, which plans to "reuse the existing story editor at
  `/story/[id]`" for reviewers: reviewers will not own agent stories either, so Phase 9 needs a
  reviewer RLS policy or an admin-client server-action path. `persistence.ts`'s existing
  `serverAuth` escape hatch does **not** solve this — it is scoped to worker media-state patches.
- **The two schema-missing classifiers are code-identical.** `isMissingRunSchemaError` (107) and
  `isMissingTaskSchemaError` (106) both accept `42P01`, `42703`, `PGRST200`, `PGRST204`. They are
  told apart **only by which table the failing query touched** — never by the error itself.
  Classify by the query, not by trying both. `aa950db` fixed exactly this: an `agent_tasks`-only
  read was latching the 107 latch, which would have killed the whole run pipeline and blanked
  `/admin/agents/runs` behind a false "migration 107 is not applied" message.
- **The task-status writes are load-bearing, not bookkeeping.** `idx_agent_runs_active_task` only
  blocks a *second live* run per task. Leave a task `commissioned`/`assigned` after its run stops
  being live and the next drain commissions another one — forever, each pass a paid model call.
  Flipping the task to `running` the moment a run exists is what makes enqueue one-shot.
- **The double-charging guard is still load-bearing and fragile.** Unchanged from the last
  session: `story_generated` persists progress after every beat AND mutates `run.checkpoint` in
  place, because `advanceRun` reads that field after the executor returns. Hoisting that read
  above the executor call silently restores double-charging. See `lib/agentic/orchestrator.ts`.
  A new instance of the same hazard was found and fixed this session in `3455430`: the Test Lab's
  novelty-preview cache did a blind read-modify-write of the whole `checkpoint` object from a path
  that does not own the run's claim. It now re-reads immediately before merging and writes only
  under `.eq('status','pending').eq('stage','story_generated')`.
- **`saveStory` cannot be called headlessly** and `saveStoryForUser` must never be exported from a
  `'use server'` file. Unchanged; see `lib/story/save-story.ts`.
- **`AGENTIC_SYSTEM_USER_ID` is dev-only.** Verified this session: it resolves to a real
  `auth.users` row owning zero stories.

### Verified by query this session, so nobody re-derives it

- `idx_agent_runs_active_task` on dev is
  `UNIQUE (task_id) WHERE status = ANY (ARRAY['pending','processing'])` — unique *and* partial,
  so both halves of the no-double-run guarantee hold. **This closes the old open item asking for
  `docs/snippets/107-verify-run-dedup.sql` to be run by hand**; the index definition proves what
  that script would demonstrate. `idx_agent_tasks_queue` is `(status, created_at) WHERE
  is_test = false`, which is exactly the shape `enqueueCommissionedTasks` queries on.
- All five agentic `TaskKey`s have real `DEFAULT_MODELS` entries, so model resolution will not be
  the first thing to fail.
- `agent_personas.status` allows `draft/testing/active/paused/archived`. The Test Lab accepts
  everything but `archived` (so it is usable today, when all 15 seeds are `draft`); the cron
  enqueue requires `active`. A paused persona can be tested but never auto-scheduled — deliberate.
- Dev state at handoff: 15 personas (all `draft`), 0 tasks, 0 runs, 0 story-memory rows,
  0 novelty checks, all six agentic flags `false`.

### Known limits accepted this session, not defects

- **`e2e/agentic-admin.spec.ts` skips on this machine.** `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`
  are **not** in `.env.local`, so the admin-authenticated spec never runs — including the
  `/admin/agents/test-lab` route just added to it. The previous session's handoff reported this
  spec green; it must have supplied the credentials transiently. The spec is designed to skip
  rather than fail, so this is silent. **The Test Lab has never been opened in a browser.**
- The Test Lab's post-generation novelty check is a *preview*. Promotion runs the check again
  inside `draft_created`, so the economy-tier adjudicator can be paid for twice in the ambiguous
  band. Deliberate: cheap, and showing both verdicts before promotion is the point of the tool.
- Agent spend still reuses existing `PricingActionKey`s, so it is indistinguishable from human
  spend *by action key*; `activity_key = 'agentic_creator'` is what separates it. Revisit in
  Phase 12.
- Checkpoints store full `StoryBeat` objects. Safe while this stage emits only text prompts.
  **If a future phase moves portrait generation here, beats must be trimmed first.**
- `agent_schedules` (migration 107) is still unused. Enqueue ignores cadence entirely and simply
  drains whatever is commissioned. Wiring schedules to enqueue is unclaimed work.

### Still open, none blocking

- Run the memory backfill on staging (`runStoryMemoryBackfillBatch()`, needs
  `agentic_creator_enabled` on) so the first agent story is checked against a real catalogue
  rather than an empty table.
- Production: see the promotion checklist in `docs/agent-context/PROJECT_STATE.md`. It needs its
  **own** `AGENTIC_SYSTEM_USER_ID` (a different UUID from dev's). `CRON_SECRET` needs no action.

---

## Where we are

- **Phase:** Phases 1-6 shipped in full, and the pipeline has produced two real drafts.
  **Phase 7 is core-complete but unproven:** the pure evaluator (7a) and its server half wired into
  a no-failure `evaluated` stage (7b) are landed and gated; the Run monitor surface (7c) and the
  Test Lab deterministic preview (7d) are designed and agreed but not written. **The evaluator has
  never executed** — migration 108 is applied nowhere, and both existing `awaiting_review` runs
  already banked `evaluated` from the Phase 6 placeholder, so proving it needs a brand-new run.
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

**Apply migration 108 on dev, start one fresh run to prove the evaluator, then build units 7c and
7d.** The exact SQL to verify each claim, and the specs for both remaining units, are in the
session handoff at the top of this file. 7c and 7d need code; the proof run does not.

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

None blocking work. Three open items:

- **Migration 108 is applied nowhere, so the evaluator cannot persist a grade.** Not a defect: the
  code fails closed, computing the evaluation and writing it into `agent_run_events` while skipping
  the `agent_evaluations` insert. Apply `108_agent_evaluations.sql` on dev to turn the record on.
- **Production has none of 102-108, and needs two more things besides the migrations.** See the
  "Promoting the agentic system to production" checklist in `docs/agent-context/PROJECT_STATE.md`:
  prod needs its own `AGENTIC_SYSTEM_USER_ID` auth user (a *different* UUID from dev's, set as a Vercel
  env var), while `CRON_SECRET` needs no action. Nothing on prod changes until then, by design.
- **`e2e/agentic-admin.spec.ts` currently skips**, because `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`
  are not set in `.env.local`. It is the vehicle for browser proof of every agentic admin surface,
  including the newly added `/admin/agents/test-lab`, so until those are set the Test Lab has never
  been opened in a browser. Setting them turns the proof back on with no code change.
- **The evaluator has never executed.** The pipeline itself has — two drafts exist on dev — but the
  `evaluated` stage was still a free advance when those ran, and both banked it in their checkpoint.
  A brand-new run is the only way to exercise Phase 7. See the handoff at the top.

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
| 108 | `108_agent_evaluations.sql` | 7 | **WRITTEN, NOT APPLIED** | not applied |
| 109–110 | reviewers / labels | 9, 11 | not written | not written |

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
