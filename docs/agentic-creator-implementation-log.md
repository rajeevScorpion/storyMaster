# Agentic Creator — Implementation Log

One entry per completed phase: what was built, which files changed, migration and config impact, what
was tested, and the commit. Append only; do not rewrite history here.

Plan of record: `C:\Users\User\.claude\plans\kisago-agentic-creator-prompt-pack-imple-refactored-dragon.md`
Source pack: `prompt-packs/Kisago_Agentic_Creator_Prompt_Pack/`

---

## Phase 0 — Baseline and branch

**Date:** 2026-09-06
**Branch:** `feat/agentic-creator`, cut from `dev` at `1d93dea`

**Work.** No feature code. Read the 17-file prompt pack in full, audited the repository across admin /
auth / flags, the story-creation pipeline, and jobs / models / memory / tests, then recorded the
grounded architecture and the operator's decisions.

**Findings that changed the plan.**

1. `app/actions/story-runtime.ts` is `'use client'`, so `generateSeedPlanPreview` and
   `materializeSeededBeat` cannot be called from server code where they sit — and the multi-beat loop
   exists only inside the browser-only Zustand store. A headless path has to be created, not merely
   wired up. (D2)
2. There is no role system at all — `verifyAdmin()` is one env-var comparison. The reviewer role is
   genuinely new work. (D6)
3. There is no pgvector and no generic job queue, but there *are* strong reusable patterns:
   `pg_trgm` similarity, `lib/ai/character-novelty.shared.ts`, and the claim / reclaim / re-kick shape
   in `lib/media/image-job-runner.ts`. (D3)
4. `imageGenerationMode: 'prompt_only'` already exists and is exactly the "images off" gate the pack
   asks for, so no new gate was invented. (D5)
5. Vercel Hobby permits one daily cron, which caps autonomous cadence. (D7)

**Files added.**

| Path | Purpose |
|---|---|
| `docs/agentic-creator-working-memory.md` | Current phase, next step, flags, migration status |
| `docs/agentic-creator-decisions.md` | D1–D8 with codebase evidence and costs |
| `docs/agentic-creator-architecture.md` | Module map and safety properties, kept truthful per phase |
| `docs/agentic-creator-implementation-log.md` | This file |
| `docs/agentic-creator-test-status.md` | Pre-implementation baseline |

**Migrations.** None.
**Config / env.** None yet. `AGENTIC_SYSTEM_USER_ID` arrives in Phase 6.
**Tests.** Baseline only — see `agentic-creator-test-status.md`. No behaviour changed, so no new tests.

**Commit:** `d0cb822`

---

## Phase 1 — Feature isolation and admin shell

**Date:** 2026-09-06

**Work.** The kill switch and the admin surface that hosts it. No generation, no jobs, no personas.

**Files added.**

| Path | Purpose |
|---|---|
| `supabase/migrations/102_agentic_creator_flags.sql` (+ rollback) | Six flags, all `false`, self-recording into the ledger |
| `lib/agentic/flags.ts` | `server-only`. `AGENTIC_FLAG_KEYS`, `AgenticFlags`, `getAgenticFlags()` — the sole read path, always `fallback = false` |
| `app/actions/agentic-admin.ts` | `'use server'`. Six `verifyAdmin()` → `setFeatureFlag()` setters plus `getAgenticFlagsAction()` |
| `app/admin/agents/layout.tsx` | Thin server shell, re-verifies admin with the parent's try/redirect shape |
| `app/admin/agents/page.tsx` | Server component; fetches flags, passes them down (the `admin/policies` pattern) |
| `components/admin/agentic/AgenticOverview.tsx` | Client. Off-state card, master switch, five subordinate toggles, honest "not yet implemented" list |

**Files modified.**

- `lib/admin/nav.ts` — new `AGENTS_CHILD_GROUPS` (one Overview child) and a top-level `agentic` group after `content`.
- `lib/admin/nav.test.ts` — added `/admin/agents` to the hub-self-link exclusion in the duplicate-href test. **Reviewed and confirmed legitimate:** `/admin/settings` and `/admin/pricing` are already excluded for the identical reason — a hub item deliberately shares its href with its overview child. The test's intent is intact.

**Migrations.** 102 written; **not applied to dev or prod.** Owner applies by hand.

**Config / env.** None.

**Design notes.**

- The subordinate toggles are *disabled* while the master switch is off, rather than hidden. Hiding them would make the page look complete when it is inert; disabling them says why.
- The off-state card does **not** redirect or hide the switch — an admin has to be able to reach the toggle from the page that explains it.
- `lib/agentic/flags.ts` carries a header comment forbidding flag reads elsewhere. That single choke point is what makes "un-migrated database behaves as feature-off" true rather than aspirational.

**Tests.** No new unit tests — this phase adds no pure logic worth pinning; `nav.test.ts` already covers the nav tree it touches. Full gate re-run after a copy correction: tsc clean, lint clean, 594/594 unit, `build:verify` passing, 14/14 Playwright.

**Commit:** `5329123`

---

## Phase 2a — Persona library: schema, logic and catalogue UI

**Date:** 2026-09-06

**Work.** The persona table, the pure logic that turns a persona into a `StoryConfig`, admin CRUD, and
the filterable catalogue. **Deliberately excludes the 15 seed personas** — those are Phase 2b, gated on
an operator sight-check of the taxonomy mapping. An empty persona table is the correct end state here.

**Files added.**

| Path | Purpose |
|---|---|
| `supabase/migrations/103_agent_personas.sql` (+ rollback) | `agent_personas`, `agent_persona_memory` + AFTER INSERT trigger, `stories.agent_persona_id`, RLS on both |
| `lib/agentic/personas.shared.ts` | Pure. `resolvePersonaStoryConfig`, `applyPersonaOverrides`, `clampBeatCount`, `buildClonedPersonaInput`, `isMissingPersonaSchemaError` |
| `lib/agentic/personas.shared.test.ts` | 20 tests |
| `app/actions/agentic-personas.ts` | `'use server'` CRUD + `getPersonaCatalogueStatus()` |
| `app/admin/agents/personas/page.tsx` | Server component |
| `components/admin/agentic/PersonaCatalogue.tsx` | Filterable table — `FilterDropdown` throughout, `RowActionsMenu` per row |
| `components/admin/agentic/PersonaEditorDrawer.tsx` | Create/edit slide-over |

**Files modified.** `lib/admin/nav.ts` — `personas` child added to `AGENTS_CHILD_GROUPS`.

**Migrations.** 103 written; **not applied to dev or prod.**

**Two defects caught in review, both fixed:**

1. **`103_agent_personas_rollback.sql` would have failed on its first `DROP TABLE`.** It dropped
   `agent_personas` while `stories.agent_persona_id` still held a `REFERENCES` constraint to it, which
   Postgres refuses ("cannot drop table … because other objects depend on it"). The column drop now
   comes first. A rollback only ever runs when something has already gone wrong — the worst possible
   time to discover it does not execute.
2. **`isMissingPersonaSchemaError` matched on the message text `/agent_persona/i`.** A duplicate-slug
   insert (23505) carries the message `duplicate key value violates unique constraint
   "agent_personas_slug_key"`, so a routine, fixable admin mistake would have been reported as
   "migration 103 has not been applied." Now codes-only, matching `lib/legal/consent.shared.ts`. The
   existing test missed this because its 23505 fixture used a message that omitted the table name;
   the fixture is now realistic, plus a check-constraint case.

**Design notes.**

- The image gate is enforced as the **last, unconditional step** of `resolvePersonaStoryConfig`, so no
  path through the function can return `'generate'` for an image-off persona. Tested from both sides.
- `language` and `ageGroup` are top-level columns and always win over `defaultStoryConfig`/overrides —
  they are identity, not tunable knobs.
- Two distinct empty states in the UI: "migration 103 not applied" vs "applied, no personas yet".
  Conflating them would send an admin hunting for the wrong problem.
- Genre and `dynamicSettingKeys` selection use chip toggles, not `FilterDropdown` — they are
  multi-select, and the shared-dropdown rule governs single-value dropdowns.

**Tests.** 87 files / 614 tests, all passing (baseline 86 / 594; this phase adds 1 file / 20 tests).
Gate: tsc clean, lint clean, `build:verify` passing with `/admin/agents/personas` in the manifest.
e2e not re-run — this phase adds no signed-out surface.

**Commit:** `9c0f620`

---

## Phase 2b — The 15 seed personas

**Date:** 2026-09-06

**Work.** `supabase/migrations/104_seed_agent_personas.sql` + rollback. SQL only; no TypeScript.

**Band mapping** (operator-approved before writing): `all_ages` is deliberately left unseeded, and the five
buckets carrying a real audience get three personas each — `kids_3_5`, `kids_5_8`, `kids_8_12`, `teens`,
`adults`. Three personas per language across english / hindi / bangla / gujarati / marathi. Urdu is supported
for story text but has **no narration voice mapping**, so no seed persona uses it.

**Language approach.** Prompts are written in English but instruct native-language output, carrying craft
direction specific to each language — idiom, naming, cultural texture, register, ending style. Chosen over
writing in Devanagari/Bengali/Gujarati script because every other template in `lib/ai/prompt-config.shared.ts`
is English and a mixed-script system prompt invites mid-beat language drift. The pack's real requirement —
that these must not be one English prompt with the names swapped — is met by the prompts differing in
narrative philosophy, structure and pacing. Any two read side by side should not be interchangeable.

**Permissions on all 15:** `allow_image_generation = false`, `allow_narration = false`, `status = 'draft'`,
`schedule_eligible = false`, and `default_story_config.imageGenerationMode = 'prompt_only'` — the last being
the technical gate the pipeline actually reads. Nothing runs until an admin activates it.

**Validation run before commit** (scripted against the SQL text, since migrations are not exercised by the
test suite):

- 15 INSERT rows, 15 unique slugs, 15 valid JSONB blobs, 0 parse failures
- 3 personas per age group and 3 per language, exactly
- every `age_group`, `language`, `genre`, style preset, theme, palette, detail level and TTS voice checked
  against `lib/types/story.ts`, `lib/story/genres.ts` and `lib/ai/narration-voices.ts` — **no fabricated
  identifiers**
- all 15 rows `imageGenerationMode: 'prompt_only'`; all 15 permission tails `false, false, 'draft', false, true`
- a quote/paren tokenizer confirmed no unterminated string literal and balanced parens in both files
- rollback slug list matches the insert slug list exactly

**Rollback design.** Deletes by explicit slug list rather than `WHERE is_seed = true`, so it can never take a
persona an admin created or cloned. `agent_persona_memory` rows cascade; `stories.agent_persona_id` is
`ON DELETE SET NULL`, so any story a seed persona produced survives and merely loses attribution — a rollback
of seed data must not destroy generated content.

**Also corrected in this commit:** `docs/agent-context/PROJECT_STATE.md`, verified against both live databases
via the read-only MCP connections. Migration 101 was recorded as "not yet applied anywhere" while the
paragraph below it said the opposite; the ledger shows it applied on both. The Runware row claimed 095 was
unapplied on production; in fact prod holds all 9 rows, disabled on both environments. Migrations 102–105 are
now listed as written-but-unapplied.

**Migrations.** 104 written; **not applied.** Requires 103.

**Tests.** None — SQL only, and the suite does not exercise migrations. `npx tsc --noEmit` unaffected.
**Standing gap:** migration files are validated only by reading them and by ad-hoc scripts like the one above.
Two real defects have now been caught that way (103's rollback ordering, and this file's identifier checks).

**Commit:** `ca9dd63`

---

## Phase 3 — Global story memory, persona memory and novelty checks

**Date:** 2026-09-06 (migration) / 2026-09-07 (TypeScript)

The migration landed first; the TypeScript half followed a day later after three background agents died
mid-task (two to API errors, one to a Sonnet session rate limit). It was ultimately written directly.

**Files added.**

| Path | Purpose |
|---|---|
| `supabase/migrations/105_agent_story_memory.sql` (+ rollback) | `agent_story_memory`, `agent_novelty_checks`, `pg_trgm` GIN indexes |
| `lib/agentic/memory.shared.ts` | Pure. Thresholds, `trigramSimilarity`, `scoreNovelty`, `needsModelAdjudication`, `buildNoveltyAdjudicationPrompt`, `isMissingMemorySchemaError` |
| `lib/agentic/memory.shared.test.ts` | 27 tests |
| `lib/agentic/memory.ts` | `server-only`. `findSimilarStories`, `recordStoryMemory`, `updatePersonaMemory`, `runNoveltyCheck`, the backfill |
| `app/actions/agentic-memory.ts` | `'use server'` admin entry points |

**Files modified.**

- `lib/ai/model-config.shared.ts` — new `TaskKey` `agent_novelty_assessment` (`gemini-2.5-flash`, temp 0.2),
  added to the union, `TASK_DEFINITIONS` and `DEFAULT_MODELS`. Registering it there gives the admin model
  editor the task with no new UI.
- `lib/ai/prompt-config.shared.ts` — `agent_novelty_assessment` added to the `PromptTaskKey` **exclusion**
  list, beside `reference_character_analysis`. Its prompt is built in code by `buildNoveltyAdjudicationPrompt`,
  not from an admin template, so it has no business in the prompt playground.
- `app/actions/gemini-proxy.ts` — new `callGeminiNoveltyAssessment`, following the existing
  `callGeminiReferenceAnalysis` precedent for a task outside the prompt registry: JSON mime type, no schema
  or guardrail lookup, same timeout and cost telemetry.

**Reuse.** Cast matching is `normalizeCharacterName` + `findSimilarRecentName` from
`lib/ai/character-novelty.shared.ts`; premise and setting overlap use its `appearanceSimilarity`; the persona
character cap reuses its `CHARACTER_NAME_HISTORY_LIMIT`. New code was written only where those genuinely did
not fit — titles are 2–5 words and fall under `appearanceSimilarity`'s 5-token floor, always scoring 0.

**Verified against the live database, not asserted:** `trigramSimilarity` reimplements Postgres
`pg_trgm.similarity()` (word padding, 3-grams, Jaccard). Five string pairs were scored on staging via SQL and
compared to the TypeScript output — **exact match to six decimal places on all five.** Those Postgres-derived
values are now pinned as a test. This matters because `findSimilarStories` selects candidate priors with SQL
`similarity()` over the GIN indexes and then scores them in-process: if the two notions of "similar" drift,
the index silently stops surfacing rows the scorer would have flagged, with no error to notice.

**Series continuity is not duplication** — the distinction the module exists to get right. Sibling episodes
of the candidate's own series are excluded from cast reuse, setting repetition and theme saturation, because
recurring characters and places are the entire point of a series. Title and premise similarity still apply to
siblings, so episode 4 cannot retell episode 2. Six tests cover it from both directions, including the
inverse case: the same cast reuse across *unrelated* stories must still be flagged.

**Fail-closed behaviour.** A dedicated codes-only `isMissingMemorySchemaError` latch for migration 105,
separate from the personas latch. When memory is unavailable, `runNoveltyCheck` returns `clear` with an
explanatory reason and never throws — a missing novelty check is a lost safeguard, not a broken pipeline, and
the human review gate still stands behind it.

**Tests.** 88 files / 641 tests, all passing (was 87 / 614; this adds 1 file, 27 tests). Gate: tsc clean,
lint clean, `build:verify` passing. e2e not re-run — no signed-out surface changed.

**Not covered:** `lib/agentic/memory.ts` itself has no unit tests — it is `server-only` and every function
takes a live Supabase client, which the suite has no harness for (consistent with the rest of the repo, where
tests target the `.shared.ts` halves). Its SQL column names were verified by querying
`information_schema.columns` on staging rather than by test. `runNoveltyCheck` has never executed end to end.

**Commit:** `dcdcadd`

---

## Phase 4 — Editorial Supervisor and task pool (2026-09-07)

Delivered in two scoped delegations rather than one, so a failed agent could never take more than half the
phase down with it: 4a (migration, logic, actions) landed before 4b (admin surface) began.

**Migration 106** — `agent_tasks` plus `stories.agent_task_id`. RLS enabled, revoked from `anon` and
`authenticated`, self-recording into the ledger. The rollback drops `stories.agent_task_id` **before**
`agent_tasks`, because the column carries a `REFERENCES` constraint into the table and Postgres would
otherwise refuse the `DROP TABLE`. This is the identical mistake found in 103's rollback during Phase 2a
review; the header reasons it out explicitly so the next person does not have to rediscover it.
**Applied nowhere yet — dev and prod both still need it.**

**Three live-data findings corrected the plan before any code was written.** Each would have produced code
that ran without error and returned silently wrong results:

- `storylines` has `age_group` and `genre` but **no `language` column**. The plan's
  `(language, age_group, genre)` grouping requires joining `stories.story_config->>'language'`.
- Every published row carries `moderation_status = 'none'`, not `'approved'`. Filtering on `'approved'`
  alone — the obvious reading — returns **zero rows** and would have reported a catalogue with no coverage
  anywhere. The correct filter is `is_public = true AND moderation_status IN ('none','approved')`, matching
  `app/actions/gallery.ts`.
- Real `genre` values include `'reel'`, which is not in `STORY_GENRES`. Coverage must tolerate values
  outside the taxonomy while proposals must never emit one.

**Deterministic where it can be, model-driven only where it must be.** Coverage and gap ranking are pure
computation — `rankCoverageGaps` is stably ordered and tested for it, because a supervisor that proposes a
different thing each time it is asked the same question is not auditable. The model's only job is turning a
ranked gap into a creative brief. `validateCommissionProposals` then treats that output as hostile: it
rejects unknown or inactive persona slugs, off-taxonomy genres, age groups and languages, and any proposal
whose language and age group disagree with its own persona.

**The current real state is the primary test case.** All 15 seed personas are `status = 'draft'`, so zero
are commissionable, and migration 106 is unapplied. `proposeCommissions` therefore returns empty with an
explanatory reason **above** the `getModelConfig` call — paying for a model call that can only return
nothing is a bug, not a no-op. The admin page distinguishes all three empty states (migration missing / no
active personas / genuinely covered) rather than rendering one bare table for all of them.

**Files.** `lib/agentic/supervisor.shared.ts` (pure, 33 tests) and `supervisor.ts` (server-only, one
codes-only latch for migration 106); `app/actions/agentic-supervisor.ts`; `app/admin/agents/tasks/page.tsx`
and `components/admin/agentic/TaskPool.tsx`; a `tasks` child in `lib/admin/nav.ts`. New TaskKey
`agent_supervisor_planning`, added to the `PromptTaskKey` exclusion list so it stays out of the prompt
playground. `callGeminiNoveltyAssessment` was **widened** into `callGeminiAgenticJson` across both agentic
tasks rather than copy-pasted a third time.

**Tests.** 89 files / 675 tests, all passing (was 88 / 641; +1 file, +34 tests). Gate: tsc clean, lint
clean, `build:verify` passing with `/admin/agents/tasks` in the route manifest. Both delegations' gate
numbers were re-run independently rather than taken on report.

**Known limit, recorded now rather than discovered later:** `listAgentTasks` issues `select('*')` with **no
limit**. The admin page's language and age-group filters are therefore client-side, which is correct only
while the pool is small enough to return whole. Pagination or server-side filters are needed before the pool
grows — `AgentTaskListFilters` supports `status`, `personaId`, `origin` and `isTest` only.

**Not covered:** no browser verification — the page has never been rendered with an admin session, and with
migration 106 unapplied every task query returns empty regardless. `proposeCommissions` has never made a
model call. `commissionTasks` has never written a row.

**Commits:** `c62b0b2` (4a), `b5e8dbf` (4b)

---

_(Phase 5 onward appended here.)_
