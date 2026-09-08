# Agentic Creator — Decisions

Each entry records the decision, the evidence in this codebase that drove it, the alternative that was
rejected, and what it costs us. Concise rationale only — never chain-of-thought.

---

## D1 — Agent-generated stories are owned by a dedicated system user, and bypass the coin reserve

**Decision.** A single Supabase auth user, identified by a new `AGENTIC_SYSTEM_USER_ID` env var, owns
every agent-generated story. Its billable actions skip the coin reservation but still write real cost
rows to `ai_cost_events`.

**Evidence.** `authorizeBillableAction` (`lib/pricing/enforcement.ts:212`) denies outright with
`sign_in_required` when `userId` is null, so an owner is mandatory. A bypass branch already exists at
L279 returning `{status:'bypassed', reason:'admin_bypass'}`, gated by `isAdminBypassEnabledForUser`
(L834) — so the shape is proven, not invented.

**Rejected.** (a) Giving the agent account a real wallet — a hard spend ceiling, but it couples
platform content production to the consumer coin economy and would make every persona run a support
question. (b) Reusing the owner's admin account — agent stories would land in the owner's personal
library.

**Cost.** Platform AI spend is no longer visible in the coin ledger. Mitigated by keeping
`ai_cost_events` writes with `activity_key: 'agentic_creator'`, so `/admin/cost` still shows the truth,
and by defaulting `agentic_billing_bypass_enabled` to off.

---

## D2 — Seed-authoring functions move to a plain lib module; the client keeps importing from where it always did

**Decision.** `generateSeedPlanPreview` and `materializeSeededBeat` move from
`app/actions/story-runtime.ts` into a new `lib/ai/seed-authoring.ts` with **no** `'use client'` /
`'use server'` directive. `story-runtime.ts` re-exports them.

**Evidence.** `story-runtime.ts` is `'use client'` (line 1) only because `generateCharacterPortrait`
(L1050) and `generateReelDraft` (L432) call `compressImage` / `sanitizeStoryboardGridImage`, which use
`document.createElement('canvas')`. The two seed functions (L146-321) were read line by line and touch
no DOM API — they import from `lib/ai/*` and call `callGeminiText`. Importing a `'use client'` module
from server code yields client-reference stubs, not values (GOTCHAS), so a server caller cannot use
them where they are. `lib/ai/beat-orchestration.ts` already carries exactly this arrangement, with a
header comment explaining that imported server actions resolve to POST references in the browser and
to direct calls on the server; `story-runtime.ts` already re-exports four functions from it (L114-120).

**Rejected.** (a) Duplicating the logic in a server module — two copies of prompt building, parsing,
validation and strict-fidelity handling, guaranteed to drift. (b) Also extracting the multi-beat loop
out of `lib/store/story-store.ts` — the right long-term architecture, but that file is ~8000 lines and
the most load-bearing in the app; not a price worth paying to ship V1.

**Cost.** A core file is touched. Mitigated by moving code verbatim, changing no consumer, and
verifying with `git diff --stat` plus one manual run of the seeded-story path before new code is added.

---

## D3 — Memory is Postgres and trigram similarity, not a vector store

**Decision.** `agent_story_memory` holds structured fields with `pg_trgm` GIN indexes. Deterministic
scoring reuses the existing character-novelty helpers; an Economy-tier model call adjudicates only the
ambiguous band over the top-N trigram candidates.

**Evidence.** There is no pgvector and no embedding column anywhere in 101 migrations. `pg_trgm` is
already enabled (migration 094) and already backs gallery search. A working similarity implementation
already exists in `lib/ai/character-novelty.shared.ts` (`normalizeCharacterName`,
`findSimilarRecentName`, `appearanceSimilarity`, `validateCharacterNovelty`) with tests and a smoke
suite.

**Rejected.** Adding pgvector and an embedding pipeline — better recall, but new infrastructure, a new
per-story cost, and a migration the owner must apply before anything works. The pack explicitly warns
against adding a vector database blindly.

**Cost.** Weaker semantic recall: a genuine near-duplicate phrased differently can slip past the
deterministic pass. Mitigated by the LLM adjudication step and by the post-generation check. Nothing
here blocks adding embeddings later — the table already has the fields to attach them to.

---

## D4 — Task-role model routing is implemented as new TaskKeys, not a parallel role system

**Decision.** `Economy | Standard | Creative` is a documented mapping from role to concrete `TaskKey`s
added to the existing registry. Precedence is persona override → `model_config` row → `DEFAULT_MODELS`.

**Evidence.** `lib/ai/model-config.shared.ts` already defines 18 `TaskKey`s with `TASK_DEFINITIONS`
(label + description) and `DEFAULT_MODELS`; `getModelConfig(task)` resolves from the `model_config`
table with a 60s cache and falls back to defaults; `updateModelConfig()` writes `model_config_history`
for audit; and the admin editor renders every task from `TASK_DEFINITIONS`. Adding a key therefore
yields an admin-configurable, audited, cached, fail-safe model mapping with no new UI.

**Rejected.** A separate `agent_model_roles` table with its own admin page — duplicates caching,
audit and UI that already exist, and gives the owner two places to change a model.

**Cost.** The role concept lives in code (`lib/agentic/routing.shared.ts`) rather than the database, so
re-grouping tasks into roles is a code change. Acceptable: roles are an engineering concept; the model
behind each task is the thing the owner actually tunes.

---

## D5 — The image gate is `imageGenerationMode: 'prompt_only'`

**Decision.** A persona with `allow_image_generation = false` resolves to a `StoryConfig` with
`imageGenerationMode: 'prompt_only'`. No separate policy check guards image calls.

**Evidence.** `imageGenerationMode: 'generate' | 'prompt_only'` is an existing, load-bearing field of
`StoryConfig` (`lib/types/story.ts:326`) already used to run stories with no image generation. Enforcing
image-off through the same field the human pipeline uses means the prevention is structural: there is
no code path that can generate an image from such a config.

**Rejected.** A permission check at each image call site — a policy check can be forgotten at a new
call site; a config value that produces no image prompt cannot.

**Cost.** None material. Phase 10 flips the same field when permission and the global flag both allow it.

---

## D6 — Reviewers get their own additive table, not a role column on the user mirror

**Decision.** `agent_reviewers (user_id PK, status, can_publish, can_trigger_media, …)` plus a
`requireReviewer()` helper mirroring `verifyAdmin()`. `ADMIN_USER_ID` is implicitly a reviewer.

**Evidence.** There is no role system at all: `verifyAdmin()` (`lib/supabase/admin.ts`) is a single
`user.id === process.env.ADMIN_USER_ID` comparison, and `admin_user_directory` (migration 083) has no
role column — it is a trigger-synced mirror of `auth.users`.

**Rejected.** Adding a role column to `admin_user_directory` — puts authorization state inside a
mirror table whose rows are maintained by a sync trigger, mixing a projection with a source of truth.

**Cost.** One more table. In exchange the ordinary-user auth model is untouched and the whole reviewer
concept is removable with one rollback file.

---

## D7 — Scheduling piggybacks the existing daily cron plus an admin "Run now"

**Decision.** `/api/batch/reconcile` gains a flag-guarded call to `drainAgentRuns()`, and the admin UI
can kick `/api/agentic/run` directly.

**Evidence.** `vercel.json` declares exactly one cron (`/api/batch/reconcile`, `0 3 * * *`) because of
the Vercel Hobby plan's one-cron, daily-frequency limit — documented in `PROJECT_STATE.md`. The repo
already solves "work longer than one request" with `after()` plus `rekickWorker()` in
`lib/media/image-job-runner.ts`.

**Rejected.** A dedicated frequent cron — the deploy fails or the schedule silently never fires on the
current plan.

**Cost.** Autonomous throughput is capped at roughly one batch per day until the hosting plan changes.
Recorded as a known limit; the admin kick makes it a non-issue during development and review.

---

## D8 — One kill switch, and every flag read fails closed

**Decision.** `agentic_creator_enabled = false` — the default, and the effective value on any database
without migration 102 — means no route render, no worker drain, no supervisor tick, no generation.
Every read goes through `lib/agentic/flags.ts` passing `fallback = false`.

**Evidence.** `getFeatureFlag(key, fallback)` catches every Supabase error and returns the caller's
fallback, so passing `false` is what makes a missing table safe. Dev and prod drift by design: the
owner applies migrations by hand per environment, and an unapplied migration has already caused one
production outage (`069_narration_accent.sql`, batch narration 500).

**Rejected.** Reading flags ad hoc at each call site — one call site defaulting to `true` would break
the guarantee that a production database missing migration 102 behaves exactly as it does today.

**Cost.** None. This is the property the entire pack is built around.

---

## D9 — Evaluation never stops a run, and the model gets no vote on its verdict

**Decision.** The `evaluated` stage has **no failure path**. It always advances to
`awaiting_review`. `verdict` and `review_readiness` are decided by the deterministic layer alone;
the grading model contributes only `scores` (six subjective dimensions) and advisory `warnings`,
and its own recommendation is recorded as a warning when it disagrees. The model call takes cost
telemetry but no coin reservation.

**Evidence.** By the time `evaluated` runs, `runDraftCreatedStage` has already written a real row
to `stories`. `advanceRun` (`lib/agentic/orchestrator.ts:807-813`) routes a thrown or `failed`
executor outcome into `handleStageFailure`, and every reviewer surface — including Phase 9's
planned queue — keys on runs at `awaiting_review`. So a failure here strands a finished story:
invisible to review, still in the database, with all the paid generation already spent.

On who decides the verdict, this extends `32f2c65` rather than contradicting it. That commit's
rule — a model may soften a deterministic verdict, never harden one — exists because a novelty
`block` was **terminal**, and a too-harsh threshold would otherwise kill a good story. The softening
vote is a rescue valve with a real cost if absent. Here nothing is terminal, so there is nothing to
rescue from, and an over-cautious verdict costs a reviewer one closer look. Granting the model a
softening vote would instead let an unauditable call talk a story past objective facts — wrong
script, restricted theme present, beats missing. **Where the model's opinion has no cost to be
rescued from, the model gets no vote.** The underlying principle is unchanged: a model call may
never be the sole cause of an automatic consequence.

**Rejected.** (a) Failing the run on a deterministic `fail` — the literal reading of the novelty
precedent, and the reason it was rejected is above: an orphan draft no surface will show.
(b) Letting the model move `review_readiness` in the restrictive direction only — it reads
appealing for safety, but `review_readiness` is the field Phase 9's queue will key on, so it is a
machine decision, and the whole point of the rule is that a model does not make those. Its safety
concern still reaches the reviewer, as a warning. (c) Billing the call through
`authorizeAgenticSpend` — there is no fitting `PricingActionKey`, and adding one means a migration
plus an admin pricing entry for a platform-internal check no user triggers.

**Cost.** A reviewer can be handed a draft the deterministic layer called `pass` while the model
flagged a safety concern. Mitigated by showing both in the same panel, with `source` on every
warning, so "the deterministic layer passed it" and "the model was uneasy" are never conflated.
`model_status` separately distinguishes "the model said nothing bad" from "the model was never
asked".
