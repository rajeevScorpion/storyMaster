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

---

## D13 — A reviewer's narration of an agent draft bills nobody; the system user is the payer of record

**Decision.** When the story is agent-owned, `submitStoryNarrationBatch` stamps the narration job's
`user_id` with the **story owner** — `AGENTIC_SYSTEM_USER_ID` — rather than the reviewer who pressed the
button, and records the submitting reviewer in the job's metadata instead. `processNarrationJob` then
derives `actorKind` from `job.user_id`, the agentic bypass in `authorizeBillableAction` fires, and no
coins move. The provider spend is still real and still lands in `ai_cost_events`.

**Evidence — and it is a correction, not a confirmation.** Unit 8d was specified in the 2026-09-09
handoff as "derive `actorKind` inside `processNarrationJob` from
`job.user_id === process.env.AGENTIC_SYSTEM_USER_ID`". That condition can never be true on the path 8d
exists to serve. `submitStoryNarrationBatch` (`app/actions/narration-batch.ts:141`) writes
`user_id: user.id` — the caller, resolved from the session cookie. A reviewer pressing narrate writes
their own id, so the derivation would always yield `'user'`, the bypass would never fire, and the
reviewer's personal wallet would be charged 0.50 + 0.30 = **0.80 beats per beat**, 6.40 for an eight-beat
story. The unit would have compiled, passed the whole suite, changed nothing observable, and looked done.

That reframed 8d from plumbing into a question about whose money funds platform-owned content, which is
why it became a decision rather than an implementation note.

**Why the payer of record is the right lever.** `narration_batch_jobs.user_id` already means "the account
this job bills"; it was only incidentally the caller because, until Phase 9, the caller was always the
owner. Writing the owner there makes the column mean what the rest of the chain already assumes, and it
makes the handoff's stated derivation correct rather than requiring a different one.

**What makes it safe.** The bypass is not a claim the caller can forge: `authorizeBillableAction`
(`lib/pricing/enforcement.ts:281-294`) independently re-checks four things — `actorKind`, the
`agentic_billing_bypass_enabled` flag, that `AGENTIC_SYSTEM_USER_ID` is set at all, and that the request's
`userId` **is** that account. Stamping the owner is what satisfies the fourth; asserting `actorKind`
alone never would.

**Rejected.** (a) **The reviewer pays personally** — a human's coin balance funding platform content,
and a review queue that costs the reviewer 6.40 beats per story to work through. (b) **Keep the reviewer
as the job's user and derive `actorKind` from `stories.agent_persona_id IS NOT NULL`** — this preserves
the reviewer's RLS visibility of their own job, but `userId` is then the reviewer and the bypass's fourth
condition fails. Making it pass would mean weakening the single check that makes a claimed `actorKind`
non-forgeable, to save a query the admin client makes anyway.

**Cost — corrected after implementation (`57b516b`); the original text of this paragraph was wrong.**

It claimed the submitting reviewer "survives in the job metadata, so 'who pressed it' is not lost, only
relocated". **There is no metadata column on `narration_batch_jobs`** — migrations 068 and 069 are its
entire schema and neither adds one. Re-stamping the payer therefore **does** lose the submitter from the
row; Unit 9d logs them with `console.info` instead, which is discoverable in Vercel logs and nowhere else.
Recording them properly needs an additive column, which is deferred rather than dropped (see
PROJECT_STATE). Do not repeat the original claim.

The RLS half of the original cost turned out to be **theoretical, not real**. `narration_batch_jobs` SELECT
RLS is indeed `auth.uid() = user_id`, so a re-stamped job does leave the submitting reviewer's visibility —
but nothing reads that table through the session client. Its only two readers, `narration-batch.ts` itself
and `beat-control.ts`'s timeline-rewrite cancellation, both use the admin client, and the narration
progress banner polls `beats.audio_status` through `loadStory` rather than the job row (the client never
even retains the `jobId`). Verified by grep across the repo, not assumed. So no reviewer watches a spinner
forever, and no queue change was needed to avoid it.

This decision governs narration only. **Images are not covered and their answer is not the same**: both
image submits gate and bill `user.id`, the caller, and hold one reservation for the whole job where
narration reserves per beat. Deferred, in the Phase 9 plan's §6.

---

## D14 — Reviewer writes go through a shared authorization helper, not widened RLS

**Decision.** `requireReviewer()` mirrors `verifyAdmin()`, and one shared helper —
`assertCanEditStory(storyId, userId)` in `lib/agentic/reviewers.ts` — returns the story when the caller is
either its owner or an active reviewer on a story with `agent_persona_id IS NOT NULL`. Every ownership
guard delegates to it, and reviewer writes run on the service-role client. No RLS policy is added.

**Evidence.** `PROJECT_STATE.md` framed this as "a reviewer RLS policy or an admin-client server-action
path", as though they were alternatives of equal standing. They are not: **RLS is not the binding
constraint**, and a migration that only widened it would fix nothing observable. Every write path carries
its own hardcoded ownership filter in application code — `loadOwnedStory`'s `user_id !== userId` throw in
both `narration-batch.ts:132` and `image-batch.ts:161`, `requireOwnedStory`'s `.eq('user_id', user.id)` in
`beat-control.ts:119-135`, `.eq('generated_by', user.id)` in `persistence.ts:744`, and the same filter on
both publish paths. The two batch guards do not even consult RLS: they already run on the service-role
client, so `loadOwnedStory` *is* the entire access-control boundary there.

A second fact makes the RLS route worse than it looks: `beats.UPDATE` is `generated_by = auth.uid()`, not
story ownership — a differently shaped predicate from `stories.UPDATE`, recorded in no doc. Widening only
`stories` would let a reviewer rename a story and then fail on every beat inside it.

**Precedent.** `requeueImageJob` (`app/actions/admin-media-pipeline.ts:198-214`) already writes to any
story's beats with `verifyAdmin()` as the only gate. A survey of seven admin-client write sites found it
is the only one without an ownership check in its call chain — so this is a real precedent, but a lone
one, which is why the capability lives in a named, tested helper rather than being open-coded per guard.

**Rejected.** (a) **Reviewer RLS policies on `stories` and `beats`** — invisible without also changing
every query filter, and it puts two policies referencing a new table on every story write by every user,
forever, to serve a handful of admin edits. (b) **Reusing `persistence.ts`'s `serverAuth` escape hatch** —
it has exactly one caller in the codebase, which always passes the story owner's own id; it has never been
an impersonation mechanism and widening it into one would give a media-state patch path general write
authority.

**Cost.** Reviewer writes bypass RLS, so `requireReviewer()` becomes load-bearing security rather than a
convenience. That is the same trust model `verifyAdmin()` already carries across roughly forty admin pages
and twenty-five files. The helper must fail closed when `agent_reviewers` is absent — production has none
of migrations 102-111 — denying everyone except `ADMIN_USER_ID` rather than throwing.

---

## D15 — A reviewer's publish is attributed to the system user, not to the reviewer

**Decision.** When a reviewer approves and publishes an agent draft (Unit 9e), the `storylines` row is
stamped with the **story's own owner** — the agentic system user — and authored under the persona's
display name. The approving reviewer is recorded in the review decision trail, never on the storyline.
The write runs on the service-role client, with `requireReviewer()` plus `canPublish()` as the whole
boundary (D14). The base to build on is `autoPublishStoryline`, not `publishStoryline`.

**Evidence.** Both existing publish paths stamp the caller. `publishStoryline`
(`app/actions/persistence.ts:2168`) writes `user_id: user.id` at `:2244` and
`author_name: profile?.display_name` at `:2266`; `autoPublishStoryline` (`:1217`) does the same at
`:1468` and `:1484`. A reviewer calling either would publish an agent story into the gallery under
their own name and into their own saved list. That is the same defect D13 was written to fix, one
layer up: the *caller* silently becoming the record of who did the work.

The choice of base is a second, separate fact. `publishStoryline` takes `beats`, `choices` and
`nodePath` as parameters and has exactly one caller in the codebase —
`components/story/PublishDialog.tsx:195` — which builds all three from the client-side Zustand
session. An admin review queue has no such session. `autoPublishStoryline` already derives them
server-side: it reads every beat for the story and walks `parent_node_id` to the root through
`walkPathToRoot` (`:1195`), taking only `(storyId, endingNodeId, storyTitle, coverImageUrl?)`. Phase
9's plan §4 named `publishStoryline`; that reference is wrong and is corrected here.

A third fact constrains the client: `autoPublishStoryline` runs on the session client
(`createClient()`), so RLS applies to its `storylines` insert. Stamping `user_id` with the system
user while authenticated as the reviewer would be refused by the owner predicate. The reviewer
publish must therefore run on the admin client — which is exactly what D14 already established for
every other reviewer write.

**Rejected.** (a) **Reviewer owns the storyline** — least code, and the option the plan implied. It
puts a staff account's name on autonomously generated fiction in the public gallery, and files it in
that person's saved list. It also makes "who published this" unanswerable later, because the reviewer
is the only party recorded. (b) **A dedicated publisher identity distinct from the system user** —
a third account to provision, seed and reason about, when `AGENTIC_SYSTEM_USER_ID` already exists and
already owns the draft. Ownership continuity from draft to storyline is worth more than the
separation. (c) **Extending `publishStoryline` with an optional `asUserId`** — the same escape-hatch
shape D14 rejected for `serverAuth`: it would give the one client-facing publish path general
impersonation authority to serve an admin surface that never calls it.

**Cost.** A second publish path exists, and the two must not drift on the fields that matter for
discovery (`age_group`, `genre`, `visibility`, `moderation_status`, `path_hash`). This is a real
maintenance cost and is accepted deliberately: the alternative was impersonation in the shared path.
Publishing also becomes a service-role write, so `canPublish()` is load-bearing security on the same
terms `requireReviewer()` already is.

---

## D16 — `all_ages` is never auto-routed; it goes to the unassigned pool

**Decision.** `all_ages` sits in the same enum as the five concrete age groups but is not a wildcard.
Reviewers declare coverage over the five concrete groups only; an `all_ages` task matches nobody and
lands in the **unassigned pool**, claimable by any reviewer whose language matches.

**Rejected.** Treating it as a wildcard (hands a kids-3-5 specialist adult-leaning work). Plain
set-membership with no special case — which routes it to nobody **silently**, and that silent
starvation is the precise defect this decision exists to prevent.

**Cost.** One branch in the matcher and one excluded checkbox in the grant UI
(`ROUTABLE_AGE_GROUPS`), plus a validator that rejects `all_ages` as coverage.

---

## D17 — role is the only stored capability

**Decision.** `agent_reviewers.role` (`reviewer` | `editor`) is the single source of truth for what a
reviewer may do. Migration 113 **dropped** `can_publish` and `can_trigger_media`; capability is derived
by pure functions in `reviewers.shared.ts`.

| role | review | publish | trigger media | assign work |
|---|---|---|---|---|
| `reviewer` | yes | no | yes | no |
| `editor` | yes | yes | yes | yes |

Named **editor**, not "supervisor": `lib/agentic/supervisor.ts` is the AI Editorial Supervisor and
`agent_tasks.origin = 'supervisor'` already means "the AI commissioned this".

**Rejected.** Role plus booleans as per-person overrides — two sources of truth for one fact, and
nothing would keep them in sync. Deferred rather than refused: add a `capability_overrides` jsonb if a
real exception appears.

**Cost.** Dropping the columns was only safe because `agent_reviewers` was empty and production has no
agentic schema at all. Note the consequence: `canTriggerMedia` moved from **opt-in** (`DEFAULT false`)
to automatic for every active reviewer, so granting standing now also grants the ability to spend money
on narration and images.

---

## D18 — assignment is task-level and advisory

**Decision.** Assignment attaches to `agent_tasks`, not `agent_runs` — a task can produce several runs
via retry and the assignment must survive one. It is **advisory**: it drives a default filter and the
workload view, and never gates a decision. Any active reviewer may still act on any draft.

**Rejected.** Enforced assignment. With auto-routing, a taxonomy typo would lock a draft with no error,
and this system already has one stage (`media_pending`) that nothing consumes.

**Cost.** A partial unique index (`task_id` WHERE `status='active'`) is load-bearing — it is what makes
auto-assignment idempotent and stops two concurrent assignments both landing.

---

## D19 — the reviewer finishes the story in `/story/[id]`, not in a second editor

**Decision.** A reviewer who approves a draft is handed off to the **existing authoring UI** with
reviewer permissions, rather than editing inside `/review`. The reviewer is the finisher: read beat by
beat, approve, edit, narrate every beat, generate images, publish — always under the agent persona's
name (D15), never their own.

**Why.** The authoring UI is already where beat editing, narration batches, image batches and the media
pipeline live, and Unit 9b already made all four reviewer-aware through `assertCanEditStory`. A second
editor would duplicate `StoryScreen` and then drift from it.

**Rejected.** A dedicated reviewer editor inside `/review` — cleaner boundary, far more code, two
authoring surfaces to keep in sync forever.

**Cost.** `StoryScreen` was written for an owner, so owner assumptions have to be found and handled.
Two are known: `saveStory` is not reviewer-aware (only `saveBeat` is), and `PublishDialog` calls the
owner-only `publishStoryline`, which would attribute the storyline to the reviewer and break D15.

---

## D20 — reviewer standing rides the pricing-runtime payload; it never gets its own request

**Decision.** The profile badge and the `/review` link need "is the current user a reviewer, and what
role". That answer is added to `getPricingRuntimeContext()`, already fetched once per session by an
app-wide cached provider. **Zero additional requests.**

**Rejected.** A dedicated `getMyReviewerStanding()` called from `UserMenu` — one extra round trip per
page for every signed-in user on the site, almost none of whom are reviewers. A Supabase JWT custom
claim — also zero-cost, but adds an auth hook and goes stale until token refresh, so a revoked reviewer
keeps their badge for up to an hour.

**Cost.** A pricing-shaped payload now carries an authorization fact. The constraint that keeps this
safe: it carries only `{ role } | null` for the **current user** — never another account's standing and
never `notes`. See `245588e` for the disclosure that shape prevents.

## D21 — the agent account pays, and every charge is recorded per persona

Narration and images triggered by a reviewer on an agent draft are charged to the **agentic
account**, never to the reviewer who pressed the button. The billing bypass means no balance
actually moves, so the bypass now **records** what it skipped — otherwise an agent would appear
to spend nothing forever. `/admin/agents/spend` reports it per persona.

**Why.** The owner needs to know which persona is costing what. A reviewer is doing the agent's
work on the agent's behalf and should not be out of pocket for it.

**How spend is attributed.** Through the story, not through the billing call: agent stories carry
the persona that wrote them, and every charge records the story it was for. That avoids threading
a persona id down through the billing layer, and it works because the two operations that reach
the bypass — narration and images — both run on a story that already exists. A charge with no
usable story is reported as an explicit unattributed total, never folded into a persona's row.

**Deliberately not done:** a wallet per persona. All personas share one account, so this gives
per-persona *spend*, not per-persona *balances*. Separate wallets are real work and are not needed
to answer the question that was asked.

*Considered and reversed:* charging the reviewer to keep things simple. Rejected once it was clear
the owner wants per-persona spend — charging the reviewer would have put agent costs on a human's
wallet and still needed the same reporting work.

## D22 — an agent draft's payer is resolved per path, and each path must be measured

D21 settled *who* pays. D22 is about how that answer actually reaches a billing call, because it has now
been got wrong three times in three different places, and each one was found by measuring rather than by
reading.

**The rule.** Every path that can spend money on an agent draft resolves the payer from the **story**, and
passes `actorKind` beside it. `resolveAgenticBillingIdentity` (pure) answers "given a story row and a
caller, who pays"; `resolveAgentDraftServerAuth` (server) fetches the row, gates on `assertCanEditStory`,
and returns the `serverAuth` shape the media paths already thread through. Naming a payer without
`actorKind` leaves the bypass structurally unreachable, so half the fix is no fix.

**The corollary that matters more.** A path is not covered because its neighbour is. `57b516b` fixed batch
narration; the interactive single-beat narration next to it stayed broken for two days. `a5e9bff` fixed both
image batch submits; the per-beat image regeneration beside them is still broken today. "Narration is fixed"
and "images are fixed" were both true and both misleading.

**Billing identity and write identity are the same decision.** On these paths the resolved payer also
decides which Supabase client runs the write and what the storage prefix is. That is why the interactive
narration defect did not merely bill the wrong person: it generated audio, charged for it, and then failed
to persist it, silently, because the beat write ran on the reviewer's own session against owner-only RLS.
Fixing the money without fixing the identity would have left a paid-for write still landing nowhere.

**Measure, do not reason.** Every one of these was invisible to types, lint, unit tests and the build, and
two of them reported success in the UI. The check that works is: press the button as the reviewer, then read
`beat_spend_reservations` and the row that should have been written. The plan predicted the wrong failure
mode for the first one; the code was right and the document was wrong, as usual.

**Deliberately still open:** the interactive image path. Its authorize/finalize/release are three separately
invocable server actions, each resolving the payer from the session, so paying from the agent account means
a client-supplied `storyId` deciding who pays on three endpoints. That wants designing. Recorded in
PROJECT_STATE and in phase9c-plan section 11.5.
