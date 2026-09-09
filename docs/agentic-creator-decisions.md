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

---

## D10 — Narration is a reviewer action, not a pipeline stage

**Decision.** `narration_pending` and `narration_complete` stay free advances. The pipeline never
generates audio. A human narrates an agent draft after review, with the batch narration flow that
already exists. Phase 8 ships no narration stage executor, no narration feature flag, and no
migration for one.

**Evidence.** The batch narration path is already complete and already hardened:
`submitStoryNarrationBatch` → `narration_batch_jobs` → the self-re-kicking worker at
`/api/batch/generate-narration` → per-beat `beats.audio_status`, with the daily reconcile cron, the
banner's Resume button and the per-beat narrate button as recovery. It already bills through the real
reserve→finalize/release cycle (`runMeteredNarrationOperation`, `app/actions/narration.ts:85`), and
`generate_story_narration` is already a priced `PricingActionKey` (0.50 beats on dev, plus 0.30 for
`align_story_text_overlay` riding inside the same call). A pipeline stage would have reimplemented an
orchestration that exists, to reach a button a human has to press anyway.

Two facts decided it rather than taste. First, **`drainAgentRuns` has no self re-kick** — it runs on
the daily cron plus the admin button — so an in-stage per-beat loop bounded by `RUN_TIME_BUDGET_MS`
(20s) would narrate roughly one beat per day. Second, the stages sit **before** `awaiting_review`, so
the pipeline would pay TTS on every draft including the ones a reviewer discards: ~5 beats of spend
per story, before anyone decided the story was worth keeping.

**How this stands to D9.** D9's rule is that a model call may never be the sole cause of an automatic
consequence. Narration has no opinion to overrule — it produces an artifact or it does not — so that
rule is not the operative one here. The operative constraint is D9's sibling, and it is the half that
generalizes: **a stage that runs after a draft exists may never be the sole cause of that draft
becoming invisible to review.** A narration stage would have had to honour it (no failure path, and
no unbounded wait for an async job), and the cheapest way to honour it turned out to be not having
the stage. Nothing here weakens D9; the reviewer gate it protects is now the only thing standing
between a draft and its audio.

**Rejected.** (a) A narration stage that submits a batch job and waits — a deferred run at
`narration_pending` is a finished draft invisible to review for up to a day, a time-boxed version of
exactly the harm D9 exists to prevent. (b) The same stage without waiting — then
`narration_complete` means "dispatched", not "complete", and the run's recorded counts are a snapshot
taken seconds after submit, which `beats.audio_status` already tells you better. (c) An
`agentic_narration_enabled` flag mirroring `agentic_image_generation_enabled` — with a human pressing
the button, the human **is** the kill switch, and `agent_personas.allow_narration` remains the
persona-level signal to that human.

**Cost.** Agent drafts reach `awaiting_review` with no audio, and someone must press a button. That
is the intended shape: V1 has no autonomous publish, so a reviewer is already in the loop. Two pieces
of real work survive and are not optional — the reviewer cannot press that button today
(`submitStoryNarrationBatch` throws `Forbidden.` on a story it does not own, `narration-batch.ts:132`,
which is Phase 9's reviewer-authorization problem), and agent-owned narration cannot bill the agent
until `authorizeCoinOperationForUser` forwards `actorKind` (`lib/pricing/coin-economy.ts:69`), so the
agentic bypass is currently unreachable from every narration path.

**This supersedes** the Phase 8 note in the 2026-09-08 working-memory handoff, which anticipated a
paid, long-running narration stage needing the reserve→finalize/release cycle. The billing half of
that note was right and survives; the stage half does not. It also supersedes the architecture doc's
safety-property row reading "Narration independent of images | Separate `allow_narration` column and
a separate run stage" — the column is real, the separate run stage is not.

---

## D11 — One persona, one fixed voice, from the list the reader-facing picker exposes

**Decision.** `agent_personas.preferred_voice` becomes the persona's single, fixed narration voice,
chosen in the admin editor from a dropdown built from the same voice lists the consumer "advanced
settings" picker offers. `approved_voice_pool` is retired as a concept — column and data untouched,
simply never read. Uniqueness across personas is **not** enforced.

**Evidence.** The column has held a real value for all 15 seed personas since migration 104, and
**nothing in the codebase read it.** Traced end to end: `stories.narrator_voice` is null on every
agent story on dev, so `resolveNarrationVoiceServer` resolves `narration_voice_mode` to
`'legacy_auto'`, `resolveNarrationVoiceDecision` (`lib/ai/narration-voice-resolver.ts:37-54`) returns
`shouldUseLegacySelector: true`, and `selectLegacyNarratorVoiceServer` fires a **Gemini call** that
picks from all 30 provider voices by genre and tone. The persona's voice was decorative, and because
`narrator_voice` locks on first use, that model-chosen voice would then have become permanent for the
story and every episode extended from it.

Parity is structural, not copied: both the admin dropdown and the reader's picker read
`getNarrationVoiceSettings()`, so changing the admin voice-list flag moves both at once.

**Why uniqueness is not enforced.** 15 personas, 12 exposed voices (6 male + 6 female) — it is
arithmetically impossible, and enforcing it would make three personas unsavable. Sharing barely
matters anyway: of the four shared voices, three pairs write in different languages and never reach a
listener's ear side by side. Exactly one real collision existed — **Leda, held by `madhurima-bose`
and `riya-sen`, both Bangla** — and migration 110 moves `riya-sen` to Callirrhoe, which was already
inside that persona's own seeded pool. The dropdown therefore *informs* rather than blocks: it names
every other persona on a voice, and distinguishes the same-language case, which is the only one worth
acting on.

**Rejected.** (a) Widening the exposed voice list to make uniqueness reachable — that changes the
consumer product to solve an internal problem. (b) Letting a model pick from the persona's approved
pool per story — it reintroduces exactly the unauditable choice this decision removes, and would have
needed a new agentic model call and the `AgenticJsonCallParams.task` widening Phase 7 warned about.
Because voice is deterministic config, Phase 8 makes **no** agentic model call and that gap never
opens. (c) A free-text voice field, i.e. today's editor — it is how a persona can be configured with
a voice the product does not offer, silently.

**Cost.** Some personas share a voice, and nothing stops an admin creating a new same-language
collision. Mitigated by the dropdown's hints, which state the collision plainly at the moment of
choosing. `approved_voice_pool` lingers as a populated column nothing reads; recorded here and in
`lib/agentic/persona-voice.shared.ts`'s header so a later reader treats it as history rather than
configuration.

---

## D12 — Persona memory nudges the brief; the deterministic check still decides; a block re-briefs

**Decision.** `agent_persona_memory` is injected into the brief prompt as a **bounded** nudge, and
`runNoveltyCheck` remains the sole authority on whether a story is too similar. When it blocks, the
run clears its `brief_ready` checkpoint and its cached verdict, records what to avoid, and
regenerates a fresh brief on the next attempt — bounded by the existing `max_attempts`, with no
separate re-brief counter.

**Evidence.** The table was written and read by nothing. Its only two reads in the codebase were
inside `updatePersonaMemory`'s own read-modify-write; `buildStoryBriefPrompt` never received any of
it. Observed live: persona Kabir Sinha produced the title `कट-ऑफ`, and forty minutes later produced
`कट-ऑफ` again and was terminally blocked at 100% title similarity, 0 of 8 beats generated, while its
`recent_titles` held that exact title the whole time. Same defect class as `preferred_voice` (D11).

It was near-deterministic rather than unlucky: the Test Lab's task brief is identical boilerplate for
a given persona, so an identical prompt with no memory reproduces the story. The retries made it
worse — `brief_ready` was checkpointed and the verdict cached (`32f2c65`, deliberately, so a block is
not a lottery), so attempts 2 and 3 replayed a verdict that could not change.

**How this stands to D9.** The model gets another attempt, never a vote. The deterministic layer
still decides every verdict, and a regenerated brief is re-checked from scratch rather than being
waved through. The memory block reduces how often a collision happens; it never decides whether one
has. That distinction is written at both call sites, because the tempting future mistake is to drop
the check on the grounds that the prompt now handles it.

**On the token objection, which was raised and is the reason the caps exist.** Storage keeps up to 50
entries per field; **injection uses its own much smaller caps** — 5 titles, 3 premises truncated to
120 characters, 10 character names, 5 settings, 5 themes — under a hard 1500-character ceiling on the
rendered block, with a test that stuffs every field to its storage cap and asserts the render still
fits. The prompt does not grow with the persona's history.

**Rejected.** (a) **Stateful model continuity**, so each story is a turn in an ongoing session. It is
not cheaper — the model still attends over prior context, and a capped title list is far smaller than
any session; it makes the strength of the novelty guarantee vary silently by provider, which is
exactly what D9 forbids; it does not survive an architecture where runs are checkpointed, deferred
across days and retried across process boundaries; and since a model without it needs the list-based
path anyway, that path has to exist and be correct regardless. Build only the one that always works.
(b) **Querying `stories` live instead of the memory table** — the memory table already *is* that
projection, maintained by 103's trigger, and where the data is fetched from has no bearing on prompt
size: whatever is retrieved still has to be injected. (c) **A separate re-brief counter** —
`max_attempts` is the existing, correct bound, and a second one is a second thing to get wrong.

**Cost.** A re-brief is real spend: each regenerated brief is a `preview_seed_plan` authorization, so
a persona that keeps colliding now pays up to three brief calls instead of one. That is the intended
trade — those attempts previously bought nothing at all. Separately, `retryRun` does not clear the
checkpoint, so an admin pressing **Retry** on a novelty-failed run still replays the cached block; the
automatic path self-corrects while the manual button cannot. Recorded in PROJECT_STATE's deferred
list rather than fixed here.
