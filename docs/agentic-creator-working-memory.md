# Agentic Creator — Working Memory

Short and current. Read this first at the start of every session, before touching code.
Longer-lived material lives in the sibling docs: `-architecture.md`, `-decisions.md`,
`-implementation-log.md`, `-test-status.md`.

---

## Where we are

- **Phase:** 2b complete — all 15 seed personas written (migration 104). **Phase 3 is half-done: both
  migration 105 files exist and are correct, but its entire TypeScript half is missing** (two
  background agents died mid-task). That is the next thing to build.
- **Branch:** `feat/agentic-creator`, cut from `dev` at `1d93dea`
- **Plan of record:** `C:\Users\User\.claude\plans\kisago-agentic-creator-prompt-pack-imple-refactored-dragon.md`
- **Source pack:** `prompt-packs/Kisago_Agentic_Creator_Prompt_Pack/` (17 files, read in full during planning)

## What works right now

- Six feature flags exist in `supabase/migrations/102_agentic_creator_flags.sql`, all defaulting to
  `false`. **The migration has not been applied to any environment yet.**
- `lib/agentic/flags.ts` is the single read path for them, always with `fallback = false`.
- `/admin/agents` renders an Overview page: an off-state explainer, the master kill switch, and five
  subordinate toggles that are disabled while the master switch is off.
- A new **Agentic** group appears in the admin sidebar and mobile drawer.
- `/admin/agents/personas` renders a filterable catalogue (age group / language / genre / status /
  search) with create, edit, clone and status actions. The table is empty and correctly says so —
  distinguishing "migration 103 not applied" from "applied, no personas yet".
- `lib/agentic/personas.shared.ts` turns a persona into a real `StoryConfig`, forcing
  `imageGenerationMode: 'prompt_only'` for any image-off persona as its last, unconditional step.
- Nothing generates anything. There are no seeded personas, no jobs, no story writing.

## Next step

**Finish Phase 3 — the TypeScript half of memory and novelty.** Migration 105's forward and rollback
files already exist and are correct; do not rewrite them. Still to build:

- `lib/agentic/memory.shared.ts` — `scoreNovelty`, exported threshold constants,
  `needsModelAdjudication`, `buildNoveltyAdjudicationPrompt`. **Reuse
  `lib/ai/character-novelty.shared.ts`** (`normalizeCharacterName`, `findSimilarRecentName`,
  `appearanceSimilarity`, `CHARACTER_NAME_HISTORY_LIMIT`) rather than writing new similarity code.
- `lib/agentic/memory.shared.test.ts` — the critical case is **series continuity is not duplication**:
  recurring characters and a repeated setting inside one series must score `clear`, while the same
  reuse across unrelated stories must not.
- `lib/agentic/memory.ts` (`server-only`) — `findSimilarStories` (one trigram query),
  `recordStoryMemory`, `updatePersonaMemory`, `runNoveltyCheck` (always writes an
  `agent_novelty_checks` row, even for `clear`), and a **codes-only** `isMissingMemorySchemaError`
  latch. Degrade to `clear` when the schema is absent; never block generation on missing memory.
- New `TaskKey` `agent_novelty_assessment` in `lib/ai/model-config.shared.ts`
  (`gemini-2.5-flash`, temp 0.2) — registering it there gives the admin model editor the task free.
- `backfillStoryMemoryFromStorylines` + `app/actions/agentic-memory.ts`, cursor in the
  `agentic_memory_backfill_cursor` feature-flag value row.

Then Phase 4 (Editorial Supervisor and task pool, migration 106).

## Blockers

- **Migrations 102 and 103 are being applied by the owner now** (2026-09-06). 104 and 105 follow, in
  numeric order — 103 must precede both.
- No agentic UI has been browser-verified with real rows yet, because until these land there are no
  rows. Worth a manual pass at `/admin/agents` and `/admin/agents/personas` once 104 is in.

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
| 102 | `102_agentic_creator_flags.sql` | 1 | **written, NOT applied** | **written, NOT applied** |
| 103 | `103_agent_personas.sql` | 2a | **written, NOT applied** | **written, NOT applied** |
| 104 | `104_seed_agent_personas.sql` | 2b | **written, NOT applied** | **written, NOT applied** |
| 105 | `105_agent_story_memory.sql` | 3 | **written, NOT applied** | **written, NOT applied** |
| 105 | `105_agent_story_memory.sql` | 3 | not written | not written |
| 106 | `106_agent_tasks.sql` | 4 | not written | not written |
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
