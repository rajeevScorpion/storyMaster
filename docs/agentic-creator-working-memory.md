# Agentic Creator — Working Memory

Short and current. Read this first at the start of every session, before touching code.
Longer-lived material lives in the sibling docs: `-architecture.md`, `-decisions.md`,
`-implementation-log.md`, `-test-status.md`.

---

## Where we are

- **Phase:** 4 complete — Editorial Supervisor, task pool and the coverage/commissioning admin surface.
  Next is Phase 5 (orchestrator, scheduler and task-role model routing, migration 107).
- **Branch:** `feat/agentic-creator`, cut from `dev` at `1d93dea`
- **Plan of record:** `C:\Users\User\.claude\plans\kisago-agentic-creator-prompt-pack-imple-refactored-dragon.md`
- **Source pack:** `prompt-packs/Kisago_Agentic_Creator_Prompt_Pack/` (17 files, read in full during planning)

## What works right now

**Migrations 102–105 are applied on the dev/staging database as of 2026-09-06; 106 is written but applied
nowhere.** Verified by query, not assumed:

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

**Phase 5 — Orchestrator, scheduler and model routing (migration 107).** Per the plan file:
`agent_runs` + `agent_run_events` + `agent_schedules`; `lib/agentic/routing.shared.ts` mapping
role -> TaskKey with persona-override precedence; `lib/agentic/orchestrator.ts` copying the proven
claim / reclaim / re-kick shape from `lib/media/image-job-runner.ts`; a `CRON_SECRET`-guarded
`app/api/agentic/run/route.ts`; and an `agentic_scheduler_enabled`-guarded call from the existing daily
`/api/batch/reconcile` tick — **wrapped so an agentic failure can never break the narration and image
reconcile work that already runs there.**

The load-bearing property is idempotency: **every expensive step writes its result into
`agent_runs.checkpoint` before advancing, and is skipped on retry if already present.** That is the whole
contract that stops a retry from paying twice.

Four more TaskKeys land here (`agent_story_brief`, `agent_seed_story_writing`, `agent_story_evaluation`,
plus routing for the existing two). Remember the `PromptTaskKey` exclusion list in
`lib/ai/prompt-config.shared.ts` — a TaskKey added without it breaks the typecheck in three unrelated files.

Still worth doing, neither blocking:

- **Run the memory backfill on staging.** `runStoryMemoryBackfillBatch()` seeds `agent_story_memory` from
  published storylines so the first agent story is checked against the real catalogue instead of an empty
  table. Requires `agentic_creator_enabled` on. Call repeatedly until `done`; resumable and idempotent.
- **Browser-verify the admin surfaces** — see Blockers.

## Blockers

None blocking work. Two open items:

- **Migration 106 is applied nowhere — not even dev.** Until it is, `/admin/agents/tasks` renders its
  "migration not applied" notice and every task query returns empty. This is by design and safe, but it
  also means nothing in Phase 4 has been exercised against a real table.
- **Production has none of 102–106.** Apply in numeric order when the branch is ready to promote; 103
  must precede 104, 105 and 106. Nothing on prod changes until then, by design.
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
| 106 | `106_agent_tasks.sql` | 4 | **written, NOT applied** | not applied |
| 107 | `107_agent_runs.sql` | 5 | not written | not written |
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
| `lib/media/image-job-runner.ts` | The claim / reclaim / re-kick pattern the orchestrator copies |
| `lib/ai/character-novelty.shared.ts` | Existing similarity helpers the novelty check reuses instead of rewriting |
| `lib/ai/model-config.shared.ts` | Add agentic `TaskKey`s here and the admin model editor picks them up free |
| `lib/pricing/enforcement.ts` | `authorizeBillableAction` L212; the `admin_bypass` branch at L279 is the model for the agentic bypass |
| `lib/admin/nav.ts` | Single source of truth for admin navigation |

## Test state

See `agentic-creator-test-status.md`. Pre-existing failures recorded there are **the baseline** and
must never be attributed to this work.
