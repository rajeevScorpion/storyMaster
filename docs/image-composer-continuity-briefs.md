# Image composer continuity — execution briefs

The exact briefs given to (or prepared for) the Sonnet executor for each remaining unit. The handoff ([image-composer-continuity-handoff.md](image-composer-continuity-handoff.md)) is the source of truth for state and decisions; these are the per-unit instructions. Paste one unit's brief as the agent prompt.

---

## Unit 4a — compiler-v2 core (dispatched 2026-09-15)

Added after dispatch: in the scene builder, replace underscores with spaces in `shotScale`, `cameraHeight` and `cameraAngle` (Gemini returns snake_case), with a one-line test.

You are implementing **Unit 4a (compiler-v2 core — pure code, migration 122)** of a planned change in the Kissago Next.js 16 repo at `D:\DEV\storyMaster`. Stay on branch `feature/image-composer-continuity`; do not switch branches, do not push.

## Read first
1. `CLAUDE.md` (conventions: `*.shared.ts` pure/isomorphic).
2. `docs/image-composer-continuity-handoff.md` — sections **1**, **2b**, **3**, **4 "Unit 4"**, and the **"Review corrections"** list under section 0. Unit 4 is split: you do **4a** (pure compiler + migration); **4b** (runtime call sites, reference binding lines) comes after. This brief wins where it differs from the handoff.
3. `docs/visual-composer-continuity-framework.md` §27, §28, §45, §47, §48.
4. Already landed: Unit 2 (`findWholeName`, word-boundary `sanitizeText` in `lib/ai/prompt-compiler/scene-spec.shared.ts`) and Unit 3 (plan types in `lib/types/story.ts`, `isEnglishText` in `lib/ai/prompt-compiler/language.shared.ts`, normalized English composer plans). Read those before you start.

## Owner non-negotiables this unit enforces
English-only final prompt; target ≤ 3,000 characters, **never over 5,000**; compression keeps what affects the image (identity, appearance changes, location/time transitions, action, key props, emotion, camera) and drops repetition and filler first; human-readable sections separated by blank lines.

## Facts already checked
- Dev `image_model_registry` has 7 rows with `capabilities.promptCompiler` (1 gemini `gemini-v1`, 6 runware `neutral-v1`; 3 of those are `reel_image_generation`), every one `promptBudgetChars: 2800`. Columns include `id, task_key, provider_key, model_key, capabilities, updated_at`.
- The visual style string (`lib/ai/story-config.ts` ~`:506`) is five newline-separated lines: `Rendering: …`, `Emotional atmosphere: …`, `Color and light: …`, `Scene richness: …`, `Scope boundary: …`. Today `sanitizeText` flattens it to one line and compression level 3 keeps only its first clause.
- The admin comparison table (`components/admin/PromptCompilerSettingsPanel.tsx`) shows `legacyChars`, `compiledChars`, reduction and `compressionLevel`.

## What to do

### 1. Capability — `lib/ai/prompt-compiler/capability.shared.ts`
`DEFAULT_PROMPT_BUDGET_CHARS = 3000`; export `PROMPT_HARD_MAX_CHARS = 5000`; `MAX_PROMPT_BUDGET_CHARS = PROMPT_HARD_MAX_CHARS`; min stays 1200. The stored `promptBudgetChars` is the **target**. Update capability tests. If `components/admin/ImageModelRegistryStudio.tsx` sets an explicit `max` on the budget input, change it to 5000.

### 2. Migration — create exactly these two files
`supabase/migrations/122_image_prompt_budget_target.sql`:
```sql
-- 122_image_prompt_budget_target.sql
--
-- Raises the image prompt compiler's target from 2,800 to 3,000 characters on every model still at the 081 default.
--
-- Trap: promptBudgetChars is now the target, not a ceiling. The compiler may go over it up to a hard 5,000 and
-- already subtracts reference-image lines itself; do not lower it to make room for them.
-- Rows an admin set to any other value are left alone.
--
-- Verify: select model_key, task_key, capabilities->'promptCompiler'->'promptBudgetChars' from public.image_model_registry where capabilities ? 'promptCompiler';

UPDATE public.image_model_registry
SET capabilities = jsonb_set(capabilities, '{promptCompiler,promptBudgetChars}', '3000'::jsonb)
WHERE capabilities ? 'promptCompiler'
  AND capabilities->'promptCompiler'->'promptBudgetChars' = '2800'::jsonb;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (122, '122_image_prompt_budget_target.sql')
ON CONFLICT (migration_number) DO NOTHING;
```
`supabase/migrations/122_image_prompt_budget_target_rollback.sql`:
```sql
-- 122_image_prompt_budget_target_rollback.sql
-- Restores 2,800 on rows at 3,000. Trap: a row an admin deliberately set to 3,000 after 122 also reverts.

UPDATE public.image_model_registry
SET capabilities = jsonb_set(capabilities, '{promptCompiler,promptBudgetChars}', '2800'::jsonb)
WHERE capabilities ? 'promptCompiler'
  AND capabilities->'promptCompiler'->'promptBudgetChars' = '3000'::jsonb;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 122;
```
Never run the Supabase CLI or apply SQL. The owner applies it.

### 3. Scene spec 1.1 — `lib/ai/prompt-compiler/scene-spec.shared.ts`
`SCENE_SCHEMA_VERSION = '1.1'`, `SCENE_BUILDER_VERSION = 'scene-builder-v2'`; `validateCanonicalImageScene` accepts `'1.1'`. Scenes are rebuilt on demand, never stored, so no compatibility shim is needed.
- **Style:** `style: { visualStyle: string; axes: string[] }`. `axes` = the input split on newlines *before* flattening, each line sanitized, empties dropped; total within `SCENE_LIMITS.style`. Keep `visualStyle` (flattened) for compatibility.
- **Characters:** `SceneCharacter` += `imageName`, `identityAnchors`, `currentAppearance`, `modes?`. Match a character to `plan.characterVisuals[]` by canonical name (NFC, case-insensitive). `imageName` = that entry's `englishName` when non-empty and English; else `displayName` when `isEnglishText(displayName)`; else `Character N` (1-based order). `identityAnchors`/`currentAppearance` from the entry when English. `visualIdentity` (existing) = `appearanceSummary` only when it is English, else `''`.
- **Scene:** += `transition?`, `setting?`, `mustNotInherit: string[]` (≤ 8 items × 80 chars).
- **Panels:** += `storyFunction?`, `timeRelationToPreviousPanel?`, `appearanceChanges: string[]` (≤ 3 × 120), `shotScale` (≤ 40), `cameraHeight` (≤ 40), `visualEcho: boolean`.
- **Presence fallback:** text derivation matches either `displayName` or `imageName` (composer descriptions now use the English name).
- **Old stored plans can be non-English** (e.g. a Hindi beat regenerated). Apply `isEnglishText(text, { ignore: <all display names> })` at build time: drop non-English items from invariants, visual focus, negatives, continuity notes, `mustNotInherit`, `appearanceChanges`; blank non-English emotion, continuity anchor, camera fields, setting fields, transition evidence. **Keep a non-English panel action** (so the image still depicts the event); the compiler's final gate warns.

### 4. Compiler v2 — `lib/ai/prompt-compiler/compile.shared.ts`
`COMPILER_VERSION = 'compiler-v2'`. Output is headed sections (`HEADING\nbody`) joined by a blank line, in this order, skipping empty sections:
1. `FORMAT` — existing `renderComposition` text.
2. `STYLE` — each style axis on its own line, full text. Never the first-clause cut.
3. `SETTING AND TIME` — `Location: … Time of day: … Era: …` (skip empty/`unknown`); a transition sentence mapping the enums to plain English (e.g. `years_later` + `new_location` → "Years after the previous scene, in a new location."; skip `unknown`); world invariants as sentences; `World reference (story style wins): <anchor>`.
4. `CHARACTERS` — `- <imageName> — Identity: <identityAnchors>. Current appearance: <currentAppearance>.`; fall back to `visualIdentity`, then the name alone. When any character has a reference: "Reference images define identity only — face, skin tone, build and distinguishing features. Hair, clothing, age, pose, setting and camera come from this prompt. Render in the story's style. Show each named character at most once per panel." (This replaces "lock … face, hair, build and colours".)
5. `PANELS` — one line per panel: `<Top-left> — <STORY FUNCTION>. Camera: <shotScale>, <cameraHeight>, <cameraAngle>. <action> Emotion: <emotion>. Focus: <a, b>. <X is absent.> <appearance changes>. <Time: N after the previous panel.>` — skip empty parts; no duplicate camera words when `cameraAngle` already contains the shot scale. Keep today's recurring-characters-only absent rule (Unit 5 changes it).
6. `CONTINUITY` — replaces "preserve character identity, clothing and colours throughout" with a sentence scoped by `transition.timeRelation`:
   - `continuous`, `same_session`, or absent/`unknown` with no panel time jump: keep one story world and four sequential moments; within this continuous scene keep identity, clothing, active props and physical state consistent.
   - `hours_later`, `next_day`: identities stay recognizable; clothing, lighting and staging may change for the new time.
   - `days_weeks_later`, `months_later`, `years_later`, `flashback`, `memory`, `dream`: identities stay recognizable; reassess age, hair, clothing and setting for this point in the story instead of copying the previous scene.
   - if any panel has a time jump: "Appearance may change between panels where noted."
   Then continuity notes as sentences, then `Do not carry over: a; b.` from `mustNotInherit`.
7. `USER DIRECTIVES` — existing text.
8. `AVOID` — adapter body: `neutral-v1` one `- item` per line; `gemini-v1` one `a; b.` sentence.
- In every rendered string, replace a non-English `displayName` occurrence (via `findWholeName`) with that character's `imageName`.

### 5. Budget — replace compression levels 0–3
Signature: `compileImagePrompt(scene, capability, options?: { reservedChars?: number })`.
- `reserved = max(0, floor(reservedChars ?? 0))`; `sep = reserved > 0 ? 2 : 0`; `target = max(800, capability.promptBudgetChars - reserved - sep)`; `hard = max(1000, PROMPT_HARD_MAX_CHARS - reserved - sep)`. Measure after redaction, as today.
- Tier 0: full render ≤ target.
- Lossless passes, in order, re-measuring after each, stop once ≤ target (tier 1):
  1. drop focus items already contained in the panel's action (case-insensitive);
  2. drop per-panel continuity anchors equal to (same `phraseKey`) or contained in an invariant;
  3. replace the `Scope boundary:` style line with `Scope boundary: style applies only to story-grounded content; add nothing just to express it.`;
  4. continuity notes: keep at most one; keep none when `timeRelation` is months/years/flashback/memory/dream or `locationRelation` is `new_location`/`same_category_different_location`;
  5. negatives: canonical bucket labels plus at most 4 other items (deterministic order).
- Tier 2: still > target but ≤ hard → accept, warning `over_target`.
- Tier 3: > hard → lossy passes until ≤ hard, recording each in `compressionActions`: remove world anchor → remove invariants from the end → remove emotion → remove focus → trim panel actions proportionally with `sanitizeText` (never below 120 characters each) → trim appearance changes → remove continuity notes. Warning `lossy_trim`. Never removed: FORMAT, character identity lines, absent lines, camera, transition sentence, `Do not carry over`, AVOID bucket labels.
- **Guarantee:** if still > hard, cut at the last line or word boundary ≤ hard, warning `hard_cut`. The output must never exceed `hard`.
- `compressionLevel` = the tier (0–3) so the admin column keeps meaning; `CompiledImagePrompt` += `budget: { targetChars, hardMaxChars, reservedChars, tier }`. Update the `sections` shape only as needed and fix every consumer.
- The legacy-text path keeps its current shape but also obeys `hard` with a word-boundary cut.

### 6. English gate
After assembly, `isEnglishText(fullPrompt)` false → warning `non_english_prompt`.

### 7. `lib/ai/prompt-compiler/assemble.shared.ts`
`AssembleInput` += `reservedChars?: number`, passed to `compileImagePrompt`. `PromptCompilerBeatMetadata` += `budgetTier?`, `targetChars?`, `reservedChars?`, filled in `metaFromCompiled`. Callers are not changed in this unit (4b does that); the default of 0 keeps them working.

### 8. Tests
- Tiers: a fixture ≤ 3000 is tier 0 and byte-identical across runs; lossless passes reach target (tier 1); an input between target and 5000 is tier 2 with `over_target`; a pathological input (very long actions, invariants, notes, many negatives) ends ≤ 5000, tier 3, never mid-word; `reservedChars` lowers both limits; nothing ever exceeds `hard`.
- STYLE keeps all four axis lines at tiers 0–2; the scope line is shortened only by lossless pass 3.
- Section headings present, in order.
- CONTINUITY: continuous scene mentions keeping clothing; `years_later` does not, and renders `Do not carry over`.
- CHARACTERS/PANELS: a Hindi display name never appears when `englishName` exists; falls back to `Character N` without one.
- An old Hindi stored plan: secondary strings dropped, action kept, `non_english_prompt` warning.
- Update `compile.snapshot.test.ts` snapshots **after reading the diff**; update `compare.shared.test.ts` and other tests that hard-code 2800 (fixtures ≤ 3000 target, never > 5000). `npm run compare:image-prompts` must pass.

## Out of scope (4b and Unit 5)
Runtime call sites (`story-store.ts`, `beat-bundle.ts`, `story-runtime.ts`, `image-job-runner.ts`, agentic), reference binding lines, continuity contradiction resolution, attaching references by presence, absent lines for every character, story-generation wording.

## Gates — all must pass before you commit
```
npx tsc --noEmit
npm run lint
npm test
npm run build:verify
npm run test:e2e
```
Never run `npm run build`; never use port 3000 or `.next`. Stop the agent dev server `test:e2e` starts (`node scripts/agent-dev.mjs stop`). Don't edit, stage or revert files outside your scope; if a gate fails because of a file you did not touch, stop and report.

## Commit
One commit: `git add` new files, then `git commit --only <paths> -F <message-file>` with the message file outside the repo (`-F -` heredoc does not work in this shell). Subject e.g. `feat(prompt-compiler): compiler-v2 — sectioned English prompts, 3,000 target and 5,000 hard cap; migration 122`, short body, ending with:
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
Commit before reporting; if short on room, commit what passes and report what is left.

## Report back (short)
commit hash; gates with counts; compiled length of each fixture before → after; snapshot diff summary; any deviation and why; anything unverified.

---

## Unit 4b — compiler-v2 runtime wiring (not yet dispatched)

You are implementing **Unit 4b (compiler-v2 runtime wiring)** of a planned change in the Kissago Next.js 16 repo at `D:\DEV\storyMaster`. Stay on branch `feature/image-composer-continuity`; do not switch branches, do not push.

## Read first
1. `CLAUDE.md`.
2. `docs/image-composer-continuity-handoff.md` — sections **2b**, **2f**, **4 "Unit 4"** (binding lines, R9), risks **R7** and **R9**, and the **"Review corrections"** list under section 0 (Unit 4 gap sites, checked).
3. What Unit 4a landed: `lib/ai/prompt-compiler/compile.shared.ts` (`compileImagePrompt(scene, capability, { reservedChars })`, `PROMPT_HARD_MAX_CHARS`), `scene-spec.shared.ts` (`imageName` on scene characters), `assemble.shared.ts` (`reservedChars` on `AssembleInput`). Read the commit (`git log -3`, `git show <4a hash>`) before starting.

## The problem
1. **Reference lines are added after the budget check.** `app/actions/story-runtime.ts` (~`:527`) and `lib/media/image-job-runner.ts` (~`:339`) append `buildReferenceBindingLines(...)` to the compiled prompt, so the sent prompt can exceed 5,000.
2. **Reference lines carry canonical names**, which may be Devanagari etc. — breaking the English-only rule. `ReferenceImage.name` exists only for these lines (see the comment near `story-runtime.ts:343`).

## What to do

### 1. One image-facing name function
Export from `lib/ai/prompt-compiler/scene-spec.shared.ts` a function returning each character's image-facing name, e.g. `resolveImageFacingNames(characters: Character[], plan?: StoryboardPlan | null): Map<string /* canonical name, NFC lowercase */, string>`, built from the **same** logic 4a uses for `SceneCharacter.imageName` (refactor so both share one implementation — the compiled CHARACTERS section and the reference lines must never disagree).

### 2. English names on character references
At every site that builds **character** reference images for a storyboard image *after the storyboard plan exists*, set `name` to the image-facing name. Find them all — start with `collectPortraitReferences` / `collectBeatPortraitReferences` / `buildStoryboardReferenceImages` in `lib/store/story-store.ts`, `collectCharacterPortraitReferences` and `portraitResult.references` in `app/actions/beat-bundle.ts`, and any payload the image job runner receives. Prefer applying the mapping once, right before the reference list is handed to the prompt assembly / image call, over changing every collector.

### 3. Reserve the reference lines inside the budget
- In `lib/ai/reference-binding.ts` export `estimateReferenceBindingChars(refs)` = `buildReferenceBindingLines(refs, { compact: true }).length`. Survivors are always a subset of the planned list and the compiled engine uses the compact form, so the estimate is an upper bound. Unit-test that for every subset of a sample list.
- Pass `reservedChars` into prompt assembly wherever a compiled prompt may be produced:
  - `lib/store/story-store.ts` `assembleStoryboardFinalPrompt` (~`:1168`) — add a `referenceImages` (or `reservedChars`) param and pass it at **all nine** call sites (~`:3159`, `:3402`, `:3421`, `:4577`, `:4809`, `:4835`, `:6331`, `:6493`, `:6504`). Use the reference list that is actually sent for that image; where it is computed after the call today, move the computation earlier rather than guessing.
  - `app/actions/beat-bundle.ts` — `references` is already built (~`:309`) before `assembleFinalImagePrompt` (~`:353`).
  - `lib/agentic/story-assembly.shared.ts` `composeAgentFinalImagePrompt` — confirm whether the agentic image path attaches references with binding lines (`app/actions/image-batch.ts` `beatPrompt` ~`:166` sends `finalImagePromptText`; the stateful worker ~`:1230` sends reference parts with no binding lines). Reserve only what is actually appended; say what you found.
- Order matters: if Unit 5-style filtering of references is ever applied later, the estimate must come from the final list — structure the code so the estimate is computed from the same variable that is sent.

### 4. Guard at the append sites
In `story-runtime.ts` and `image-job-runner.ts`, when the engine is `compiled` and the bound prompt exceeds `PROMPT_HARD_MAX_CHARS`, log one `console.warn('[image_prompt.over_hard_max]', { chars, referenceCount })`. Do not trim there — it should be unreachable.

### 5. R9 gaps
- **Server bundle world anchor:** the store resolves a world anchor and world reference (`resolveBeatWorldRouting`, `story-store.ts` ~`:568`, via `selectRelevantWorld` / `selectDirectWorldReference`); the bundle passes none (`beat-bundle.ts` ~`:342`). If those selectors are pure/server-safe, pass `worldAnchor` into the bundle's `buildCanonicalImageScene` and add the world reference to `references` the way the store does (and include it in the reserve). If they are client-only, do not port them — report it.
- **Store job path legacy build** (~`:4578`) omits `worldAnchor`: fix only if `buildFinalStoryboardImagePrompt` already accepts a world anchor option elsewhere; otherwise leave it.
- **Reel prompt-only path** (~`:3812`): out of scope (reels stay legacy). Do not change it.

### 6. Tests
- `estimateReferenceBindingChars` ≥ actual for every survivor subset.
- `resolveImageFacingNames`: Hindi canonical names map to the plan's `englishName`; `Character N` without one; matches 4a's `imageName` for the same inputs.
- A compiled prompt plus the binding lines for its references never exceeds 5,000 (compose the pure pieces in a test with a pathological scene and 4 references).
- Existing suites keep passing; update mocks where signatures changed.

## Out of scope
Continuity contradiction resolution, attaching references only for present characters, skipping the previous-storyboard reference on time jumps, absent lines for every character, story-generation wording, open threads (Unit 5). Compiler internals (4a).

## Gates — all must pass before you commit
```
npx tsc --noEmit
npm run lint
npm test
npm run build:verify
npm run test:e2e
```
Never run `npm run build`; never use port 3000 or `.next`. Stop the agent dev server `test:e2e` starts (`node scripts/agent-dev.mjs stop`). Don't edit, stage or revert files outside your scope; if a gate fails because of a file you did not touch, stop and report.

## Commit
One commit: `git add` new files, then `git commit --only <paths> -F <message-file>` with the message file outside the repo (`-F -` heredoc does not work in this shell). Subject e.g. `fix(image-prompt): reference lines use English names and count toward the 5,000 cap`, short body, ending with:
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
Commit before reporting; if short on room, commit what passes and report what is left.

## Report back (short)
commit hash; gates with counts; every call site changed (file + function); what the agentic path does with references; what you did about the bundle world anchor and why; any deviation; anything unverified.

---

## Unit 5 — continuity model (draft; re-anchor store and bundle reference sites after 4b)

DRAFT — finalize after 4b lands (re-anchor store/bundle reference sites by function name).

You are implementing **Unit 5 (continuity model: inheritance sources, presence, references, wording)** of a planned change in the Kissago Next.js 16 repo at `D:\DEV\storyMaster`. Stay on branch `feature/image-composer-continuity`; do not switch branches, do not push.

## Read first
1. `CLAUDE.md`.
2. `docs/image-composer-continuity-handoff.md` — sections **2e**, **4 "Unit 5"**, **5** (R8, R10), **6** (Q3, Q4), and the **"Review corrections"** list under section 0 — especially **"Unit 5 design correction"** and the live smoke notes. This brief supersedes section 4 Unit 5 where they differ.
3. `docs/visual-composer-continuity-framework.md` §3, §6, §12, §14, §20, §21, §28–§32, §45, §47, §48, §51, §52.
4. What already landed: Units 2, 3, 4a, 4b (`git log --oneline`). Read `lib/ai/storyboard-plan.shared.ts`, `lib/ai/prompt-compiler/scene-spec.shared.ts`, `compile.shared.ts`, `lib/ai/reference-binding.ts`.

## Key design point (do not re-derive)
The composer's `sharedVisualInvariants` describe the state **after** the transition (a live run returned "adult Anvi … dark hair tied in an athletic ponytail" for a twelve-years-later beat). **Never drop composer invariants because of a time jump.** Surface sameness comes from: story-generation `continuityNotes` (prior-state notes), `deriveOpenThreads` re-injecting them, the previous-storyboard reference image, character references for absent characters, and sameness wording in prompts. Target those.

## Owner decisions
- Q3: `deriveOpenThreads` stops re-injecting `continuityNotes`; it uses `nextBeatGoal` only.
- Q4: skip the previous-storyboard reference on a big time jump or location change, **except** when no character present in the beat has a character reference.

## What to do

### 1. Pure continuity resolution — `lib/ai/storyboard-plan.shared.ts`
Export `resolveContinuityContradictions(plan, ctx: { continuityNotes?: string[] })` → `{ plan, continuityNotes, warnings }`. Pure, deterministic.
- `BIG_TIME_JUMPS` = `months_later`, `years_later`, `flashback`, `memory`, `dream`; `LOCATION_CHANGES` = `new_location`, `same_category_different_location`. A jump counts if the beat `transition.timeRelation` or any panel `timeRelationToPreviousPanel` is in the set.
- **Age:** on `months_later`/`years_later`, a character's `modes.age === 'LOCKED'` becomes `'EVOLVE'`.
- **mustNotInherit:** on a big jump add `previous wardrobe` and `previous hairstyle`; on a location change add `previous location architecture` — only when no existing item already covers it (phrase-key containment).
- **Prior-state notes:** on a big jump or location change, drop `continuityNotes` entries that share a meaningful token with any `mustNotInherit` item or mention clothing/hair/accessory/location words (small English list). Keep the rest.
- **Invariants:** unchanged.
- **Shot diversity:** if three or more panels share the same normalized `shotScale` + `cameraHeight` (both non-empty) and none of those has `visualEcho`, add warning `camera_repetition`.
Call it inside `buildCanonicalImageScene` so every path (store, bundle, agentic) gets it; carry `warnings` on the scene (e.g. `planWarnings`) and have the compiler append them to its warnings.

### 2. Presence in the compiled prompt — `compile.shared.ts`
- When at least one panel has characters present: the CHARACTERS section lists only characters present in at least one panel, and every panel renders `X is absent.` for each of those characters not in that panel (replacing the recurring-in-two-or-more rule).
- When no panel has presence information: list all characters and render no absent lines (today's fail-open behaviour).

### 3. Continuity sentence
4a already scopes CONTINUITY by transition. Verify its wording against framework §28/§45 and adjust only if it still implies sameness across a jump. `CanonicalImageScene.continuity.clothing` must no longer be the constant `'strict'`: derive `'scene'` for continuous/same_session/unknown and `'evolve'` otherwise (update the type).

### 4. References
Add pure helpers in `lib/ai/storyboard-plan.shared.ts` (or a sibling `.shared.ts`) and apply them at every storyboard reference-construction site (store `buildStoryboardReferenceImages` callers and the refine path; `app/actions/beat-bundle.ts` references; any agentic equivalent). Compute the 4b reserve from the **final** list.
- `presentCharacterNames(plan, characters)`: the union of each frame's composer `charactersPresent`, resolved to canonical names. Return `null` (meaning "don't restrict") for a fallback plan (`fallbackReason` or `languageFallback` set), when any frame lacks a `charactersPresent` array, or when the union is empty.
- **Character references:** attach only for present characters when the helper returns a set; otherwise attach all, as today.
- `shouldAttachPreviousStoryboardReference(plan, { presentCharacterHasReference })`: false on a big time jump or location change, unless `presentCharacterHasReference` is false (R8 / Q4); true otherwise and for plans without a transition.
- **Binding text** (`lib/ai/reference-binding.ts`): the full character form becomes identity-only — face, skin tone, build and distinguishing features; hair, clothing, age and pose come from the prompt; style from the story. Add a line for a `scene` reference (compact and full): `Attached reference image N is the previous storyboard: use it only for world and identity continuity; do not copy its composition, camera, poses, clothing or location.` Update `reference-binding.test.ts`.
- R10: provider-stateful mode carries earlier images implicitly; do not attempt to change it — record it in GOTCHAS in Unit 6.

### 5. Open threads — `lib/store/story-store.ts` `deriveOpenThreads`
Use `nextBeatGoal` only. Check consumers of `openThreads` and their tests.

### 6. Sameness wording (`lib/ai/prompt-config.shared.ts` unless noted)
- story_generation rule 25 ("…species, face, body proportions, colors, clothing logic…"): identity = species, face, skin tone, build, distinguishing features; hair, clothing and accessories may change with time, place, activity or life stage.
- story_generation rules 10–11 ("preserves visual continuity", "same characters consistently"): describe characters by stable identity with their current appearance for this moment.
- Continuity rules "Reuse the same visual descriptors for characters unless a deliberate transformation happens.": keep identity descriptors stable; update `appearanceSummary` when time, age, life stage, wardrobe or location changes the look.
- Character flagging `changedCharacterIds`: add ageing or a time jump that changes age or life stage, a new hairstyle, and a wardrobe change for a new day, place or role.
- Series bible `characterRules` "stable appearance anchors": identity anchors (face, build, distinguishing features).
- `image_generation` template "Preserve character identity exactly across all four panels: same face, clothing, body proportions, colors…": identity across panels; clothing and appearance as this beat describes.
- Unused `VISUAL_PROMPT_DEFAULT` rule 2 ("same proportions, colors, clothing"): same identity-only wording, for consistency.
- `lib/ai/image-regeneration.shared.ts` "Preserve named character identities, appearance references, and costumes unless…": preserve identities and the appearance, costumes and setting this beat describes unless the user asks for a change.
- Leave alone: seed rules about one-to-one identity, `portrait_generation` single-sheet outfit consistency, layout requirements in `beat-orchestration.ts`.

### 7. Tests (framework §51/§52 as deterministic plan → scene → compile fixtures)
- Continuous scene: CONTINUITY keeps clothing; continuity notes kept; previous-storyboard reference attached.
- Years later: identity lines present; `Do not carry over` includes previous wardrobe; a "yellow hair clips" note dropped; LOCKED age becomes EVOLVE; composer invariants untouched; previous-storyboard reference skipped when a present character has a reference, kept when none does.
- New location: location notes dropped; reference skipped.
- Absent character (present in one panel only) is rendered absent in the other three; a character present in no panel is not listed.
- Prop continues across panels in a continuous scene (invariant kept).
- Deliberate visual echo suppresses `camera_repetition`; three identical shots without echo fire it.
- Fallback plan: no reference restriction.
- The Hindi fixture regression still passes.
- `deriveOpenThreads` returns goals only.

## Gates, commit, report
Same as previous units: tsc, lint, `npm test`, `build:verify`, `test:e2e` (stop the agent dev server); one commit with `git commit --only` and a message file outside the repo; end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Report: hash, gates with counts, every site changed, deviations, anything unverified.

---

## Unit 6 — docs (not yet dispatched)

Small enough for the reviewing session to write directly. Handoff section 4 "Unit 6" lists the files; add these findings from execution:

- `docs/image-prompt-compiler.md`: compiler-v2 headed sections; English-only rule; 3,000 target and 5,000 hard cap; tiers (`compressionLevel` 0–3) and warnings `over_target`, `lossy_trim`, `hard_cut`, `non_english_prompt`, `camera_repetition`; `reservedChars` for reference lines.
- `docs/agent-context/GOTCHAS.md`:
  - Non-Latin text in the compiler: tokens and name boundaries must include `\p{M}` (Devanagari vowel signs and virama are marks); names in no-space scripts (Han, kana, Thai, Lao, Khmer, Myanmar) need substring matching. `findWholeName` uses regex lookbehind in browser code — fine at Next 16's default floor (Safari 16.4), not below it.
  - Reference-image lines are inside the budget and use English image-facing names; one function decides that name for both the compiler and the reference lines.
  - Continuity ≠ sameness (framework §55 note). The composer's `sharedVisualInvariants` describe the state after a transition — never drop them because of a time jump.
  - `isEnglishText` is a Latin-script ratio: a Latin-script non-English language (Spanish, French) passes it. The composer rule still asks for English.
  - Reels share `storyboardPlanSchema`; the continuity schema is `visual_prompt` only.
  - R10: provider-stateful image mode carries earlier images implicitly; continuity rules cannot fully suppress that.
- `docs/agent-context/PROJECT_STATE.md`: migration 122 row (unapplied on dev and production until the owner runs it); section 7 deferred items; composer schema live-tested on Luna and Gemini 3.8 Flash only (Qwen untested); portrait prompts still carry canonical (possibly non-Latin) names until portraits move onto the compiler; regenerating an old beat whose stored plan is non-English keeps its non-English panel actions and records `non_english_prompt`.
