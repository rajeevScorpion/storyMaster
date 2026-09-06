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

**Commit:** _(filled in at commit time)_

---

## Phase 3 — PARTIAL, not complete

**Date:** 2026-09-06

`supabase/migrations/105_agent_story_memory.sql` and its rollback are written and reviewed — the rollback
even reasons explicitly about drop order, applying the lesson from 103. **The entire TypeScript half is
missing**: two successive background agents died mid-task (one to an API error, one without reporting). See
the working-memory doc's "Next step" for the exact list of what remains.

Do not treat Phase 3 as done. Migration 105 may be applied safely regardless — the tables simply sit unused
until the code lands.

---

_(Phase 4 onward appended here.)_
