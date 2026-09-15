# Handoff: image composer — English prompts, length budget, continuity model, log cleanup

Written 2026-09-15 at 94% session usage as a plan; execution started 2026-09-15 on `feature/image-composer-continuity`.

The spec is [visual-composer-continuity-framework.md](visual-composer-continuity-framework.md); sections 3–14, 17–20, 28–33 and 45–52 are what this plan implements. Follow `docs/agent-context/WORKING_AGREEMENTS.md`: Opus plans and reviews, Sonnet executes one commit per unit, `git commit --only`, migrations are SQL plus rollback applied by the owner, code fails closed.

## 0. Session state

**Merged into `dev` 2026-09-15, `--no-ff` each, pushed:** `feature/text-task-guidance` (`e1dd637`), `feature/content-block-fallback` (`8df40e2`), `feature/beat-length-allowance` (`a70c93f`). The merged tree is identical to the beat-length head, which passed tsc, lint, 1305 unit tests, build:verify and 30 e2e tests. All migrations are applied on dev (owner, 2026-09-15). `feature/image-composer-continuity` is cut from `a70c93f`.

**Production** is behind on several migrations. The owner will ask for the list when promoting; do not chase it before then.

### Progress
| Unit | Commit | Status |
|---|---|---|
| 1 log cleanup | `c5800a0` + restore fix | done; review restored the "Story beat generation failed" error log — the browser store calls beat generation directly, and the bundle only logs gateway errors |
| 2 Unicode-safe relevance and scene spec | `cf28089` | done; 1334 unit tests; no snapshot change. `findWholeName` uses a regex lookbehind in browser code — within Next 16's default browser floor |
| 3 English composer plan | | in progress |
| 4a compiler-v2 core (pure) | | pending — split from Unit 4: capability, migration 122, scene spec 1.1, sections, budget tiers, English gate |
| 4b compiler-v2 runtime wiring | | pending — split from Unit 4: reference lines inside the budget with English names, call sites, R9 gaps |
| 5 continuity model | | pending |
| 6 docs | | pending |

### Review corrections to this plan (2026-09-15)
- **Unit 2 tokenizer and name boundaries must keep `\p{M}`.** Devanagari vowel signs and the virama are combining marks; `[^\p{L}\p{N}\s]` shreds Hindi words, and a boundary without `\p{M}` matches `अन्व` inside `अन्वी`. Names in no-space scripts (Han, kana, Thai, Lao, Khmer, Myanmar) need substring matching.
- **Unit 3 schema:** reels share `storyboardPlanSchema` (`text-model-proxy.ts` `TEXT_SCHEMA_MAP`, `prompt-playground.ts`). The continuity fields go in a separate `storyboardContinuityPlanSchema` for `visual_prompt` only, required there (strict conversion widens optional fields to nullable, which a nullable enum does not allow).
- **Unit 3 audience contract is not a pure duplicate.** The post-parse append (`beat-orchestration.ts` ~`:759`) is the only path that carries audience visual direction into the image prompt; it is wasteful (header and meta lines become invariants), not redundant. Replace it with one invariant line, `Audience (<label>): <visualDirection>`, rather than deleting it.
- **Unit 3 English check tolerates canonical names:** `isEnglishText` ignores the story's own character names, so a Devanagari name inside an English description does not force the whole plan to fall back.
- **Unit 4 gap sites, checked:**
  - The prompt-only multi-beat path (`story-store.ts` ~`:3812`) is the **reel** flow; reels are out of scope, so it stays legacy and is recorded, not fixed.
  - The browser job path (`story-store.ts` ~`:4577`) already passes `worldAnchor` to the compiled scene; only its legacy build lacks it.
  - The agentic path (`lib/agentic/story-assembly.shared.ts` `composeAgentFinalImagePrompt`) does use the compiler, with no world anchor; the stateful batch worker (`image-batch.ts` ~`:1230`) sends `finalImagePromptText` with reference parts but no binding lines.
  - The admin comparison table (`components/admin/PromptCompilerSettingsPanel.tsx`) shows `compressionLevel`; Unit 4 must keep that number meaningful (e.g. 0 none, 1 lossless passes, 2 over target accepted, 3 lossy trim) alongside any new tier field.
- **Live composer smoke (2026-09-15, `scripts/composer-schema.smoke.ts`, `COMPOSER_SCHEMA_SMOKE=1`):** an invented Hindi beat twelve years after a childhood scene, real default template and guardrail, `storyboardContinuityPlanSchema`. Both `openai:gpt-5.6-luna` (24.2 s; dev's composer model) and `gemini-3.8-flash` (13.3 s, 2,941 in / 3,812 out tokens) accepted the schema, returned English with no language fallback, set `years_later` + `new_location`, and listed the yellow hair clips and village pond in `mustNotInherit`. R3 and R4 are cleared for these two models; Qwen untested.
  - Gemini writes camera fields in snake_case (`medium_long_shot`, `eye_level`); the scene builder humanizes underscores.
  - Gemini set `modes.age: LOCKED` for a character across a twelve-year jump. Unit 5 should read LOCKED age on a months/years jump as EVOLVE.
- **Unit 5 design correction:** the composer's `sharedVisualInvariants` describe the state *after* the transition (the smoke returned "adult Anvi … dark hair tied in an athletic ponytail"). Dropping hair/wardrobe invariants on a time jump, as section 4 Unit 5 proposes, would delete correct within-beat continuity. Inheritance comes from elsewhere: story-generation `continuityNotes` (prior-state notes; compiler pass 4 already drops them on jumps), `deriveOpenThreads`, the previous-storyboard reference image, and the old sameness wording. Unit 5 targets those, plus notes that match `mustNotInherit`.
- **R1 on dev:** `prompt_configs` has no rows for `visual_prompt`, `story_generation`, `image_generation`, `seeded_beat_materialization` or `seed_plan_generation`; dev runs the default templates. Production is unchecked.

## 1. Owner non-negotiables

1. **Every final image prompt is English only,** whatever the story language. Composer planning output should also be English.
2. **Length:** target ≤ 3,000 characters, hard maximum 5,000. Never exceed 5,000.
3. **Compression keeps what affects the image.** Identity, age and state changes, wardrobe logic, location and time transitions, action, key props, emotion and camera composition stay. Repetition, redundant adjectives, duplicated continuity text and filler go first.
4. **Prompts are human-readable.** Use sections separated by line breaks, not one block.
5. **Continuity is attribute-specific** (LOCKED / EVOLVE / FREE). Continuity is not sameness.
6. **Terminal noise:** keep errors, important warnings, model or API failures and concise status. Remove debug spam.

## 2. Verified current behaviour and root causes

Evidence: story `c5b8e8d2-cf57-4b6e-b9b1-aea97f51c558`, beat 4 (Hindi, Teens, ink-wash).
- Dev flag `image_prompt_compiler_mode = new`.
- Seven registry rows have the compiler enabled, all with `promptBudgetChars` 2800. The Gemini row uses `gemini-v1`; the Runware rows use `neutral-v1`.
- The beat record `image_generation_metadata.promptCompiler` shows `compressionLevel` 3, `compiledChars` 2547, `legacyChars` 12751.

### 2a. The duplicate filter destroys non-Latin text (the largest loss)
- **Tokenizer:** `lib/ai/prompt-compiler/relevance.shared.ts` `tokenize()` strips `[^a-z0-9\s]`, so every Devanagari, Arabic or CJK phrase gets the empty key.
  - `dedupPhrases` keeps one survivor and drops the rest as "duplicate".
  - Fully non-Latin names put `''` into `characterNameKeys`, so the surviving focus item is dropped as "redundant-character-name" (`:244`, `:279-283`).
- **Removed on this beat:** 4 of 5 world invariants, all 16 visual-focus items, and 7 composer negatives.
- **`\b` without the `u` flag** never matches Devanagari names:
  - `scene-spec.shared.ts:229` `deriveCharactersPresent`: a fallback plan ends with no one present.
  - `compile.shared.ts:173`: the absent-name filter.
- **Other matchers:**
  - `slugifyCharacterKey` maps non-Latin names to `''`, so keys become `character-N`. Harmless.
  - `resolvePanelCharacters` (`scene-spec:246-259`) needs an exact display-name match. It resolves to nothing if the composer transliterates a name, and has no fallback.
- **No fixture is non-English** (`lib/ai/prompt-compiler/__fixtures__/scenes.ts`).

### 2b. The budget forces level-3 compression
`compile.shared.ts` `compileImagePrompt` works in levels:
- **L1:** drops visual focus and per-panel continuity anchors.
- **L2:** drops emotion, continuity notes and world invariants.
- **L3:** drops the world anchor and cuts style to its first clause (`split(/[.,;]/)[0]`). This removes the atmosphere, colour and light, and scene-richness (foreground, midground, background) axes.

Other pressure on the budget:
- Panel actions (≤320 characters each) and shots are never compressed, so they crowd out everything else.
- `capability.shared.ts` clamps budgets to 1200–20000 (default 2800). Seeded by migration 081.
- **No provider enforces a prompt length.** `runware-provider.ts:48` passes the prompt straight through.
- **Reference binding lines are appended after the budget check,** in `app/actions/story-runtime.ts:527-528` and `lib/media/image-job-runner.ts:334-353`.

### 2c. The composer writes story language
- **No English rule in the composer.** The default `visual_prompt` template (`lib/ai/prompt-config.shared.ts` ~455–535) has none, and neither does `LOCKED_PROMPT_GUARDRAILS.visual_prompt` (`:763`). Story generation does require English `imagePrompt` and `continuityNotes` (`:125-127`).
- **Character appearance is story language.** `appearanceSummary` is also user-editable in `components/story/CharacterMasterDialog.tsx`, so it cannot be forced to English.
- **Truncation cuts mid-word** (`scene-spec.shared.ts` `sanitizeText` uses `slice`):
  - cameraAngle at 80 characters (hard-coded, `:370`)
  - negativeConstraint at 60
  - action at 320
- **The fallback plan injects story-language narration.** `buildFallbackStoryboardPlan` (`beat-orchestration.ts:580-673`) writes it into frame descriptions: "…aligned to narration part N: <≤180 chars>". Its character JSON is cut to 700 characters, which can land mid-JSON. The fallback is used on any composer throw.

### 2d. Composer input is bloated (25.6 s on Luna)
- **Repeated sections.** `composeStoryboardPlan` (`beat-orchestration.ts:675-781`) resolves variables at `:709-727`, and template rules inline whole values:
  - rule 1: the story bible
  - rules 2 and 22: `{{characters}}`
  - rule 14: `{{visualStyle}}`
  - rule 15: `{{previousStoryboardContext}}`

  Each of these also appears as its own section, so the input carries the bible twice, characters three times, and style and previous storyboard twice each.
- **The audience visual contract is added twice:** appended to the prompt (`:733`) and to `sharedVisualInvariants` after parsing (`:759-762`).
- **Unvalidated output.** The plan is `JSON.parse(text) as StoryboardPlan` (`:755`) with no validation.
- **Unused field.** `frame.prompt` is required by `storyboardPlanSchema` (`lib/ai/generation-schemas.ts:219-287`) but used only by legacy `renderStoryboardPlan` (`:783-808`). The compiled path never reads it, yet it costs composer output tokens.

### 2e. Continuity forces sameness; there is no time or location model
- **No model of time.** Story time, elapsed time, life stage and location appear nowhere. `setting.timeOfDay/mood` is always `'unknown'` (`story-store.ts:2556`, `2903`, `3764`).
- **Wording that forces sameness** (replace or scope each):
  - `compile.shared.ts:200` "preserve character identity, clothing and colours throughout"
  - `compile.shared.ts:144` "lock … face, hair, build and colours"
  - `scene-spec.shared.ts:127-133` and `:313-315` hard-code `clothing:'strict'`
  - `relevance.shared.ts:120` negative 'character redesign'
  - `prompt-config.shared.ts`:
    - story generation `:84`, `:88-89`, `:106`, `:155` ("Reuse the same visual descriptors"), `:157`
    - `:201` changedCharacterIds guidance, which omits ageing and time jumps
    - seed `:282`, `:348`
    - series bible `:398`
    - composer `:468`, `:469`, `:473`, `:501`, `:534` (example: "same yellow raincoat")
    - image_generation `:669`
    - portrait `:729`, `:736`
    - `:423-438` `VISUAL_PROMPT_DEFAULT` is unused
  - `beat-orchestration.ts:78`, `:88`; fallback `:619`, `:669`
  - `lib/ai/reference-binding.ts:25` (locks hair)
  - `lib/ai/image-regeneration.shared.ts:84` (costumes)
- **Previous storyboard image is always a reference from beat 2 on.** Sources:
  - `story-store.ts` `buildStoryboardReferenceImages` `:583-599`, used at `:4551` and `:6292`
  - `beat-bundle.ts:309-320`
  - refine `:6302-6310`

  Scene references get no binding text (`reference-binding.ts:7-8`, `18`), so nothing limits what the model copies. Provider-stateful mode also carries earlier images (`story-store.ts:4498`).
- **All characters' references are attached,** not only those in `charactersPresent` (`story-store.ts:554`).
- **`deriveOpenThreads`** (`story-store.ts:405-413`) re-injects every beat's `continuityNotes` as open threads, so notes like "yellow hair clips" persist indefinitely.
- **Character merges** keep the newest text and the first non-empty portrait (`story-store.ts:374-379`, `532-545`; `persistence.ts:82-97`). A new portrait is generated from text only.

### 2f. Existing gaps found along the way
- The server bundle passes no world anchor or world reference (`beat-bundle.ts:323-349`).
- The browser job path's legacy build omits `worldAnchor` (`story-store.ts:4578-4589`).
- The prompt-only multi-beat path bypasses the compiler (`story-store.ts:3812`).
- Agentic images use `finalImagePromptText` with no binding lines (`app/actions/image-batch.ts:168`, `1227-1243`).
- Reels are always legacy (out of scope).

### 2g. Terminal noise
1. **`└─ ƒ callTextModelOutcome({...full prompt...})`** is Next 16.3.3 dev Server Function logging, on by default. It prints string arguments in full. Fix: `next.config.ts` → `logging: { serverFunctions: false }`.
2. **`app/actions/narration.ts:709` `[narration.tts_prompt_debug]`** prints the full TTS prompt. It is marked TEMP DEBUG; remove it.
3. **Five copy-pasted timing helpers** (~25 call sites), none gated:

   | Helper | Location |
   |---|---|
   | `logTiming` | `lib/ai/text-gateway/router.ts:380-388` |
   | `timeRuntimeStep` | `lib/ai/beat-orchestration.ts:340-363` (11 sites) |
   | `timeNarrationStep` | `narration.ts:177-200` |
   | `timeEnforcementStep` | `lib/pricing/enforcement.ts:144-167` |
   | `timeGeminiStep` | `app/actions/gemini-proxy.ts:20-43` |

   The only precedent for gating is `lib/persistence/logging.ts:1-4` (NODE_ENV).
4. **Smaller items:**
   - `validation_retry` logs the full issues array (`beat-orchestration.ts:543`).
   - The seed-plan length warning fires once per plan beat in a loop (`seed-authoring.ts:184`).
   - Worker tick `console.log` in `app/api/{media/jobs,reference/jobs,agentic}/run/route.ts`.
   - `[stateful:diag]` at `image-batch.ts:1128`.
   - `[narration.voice_resolver]` at `narration.ts:2131`.
5. **Duplicate error logs:** `beat-orchestration.ts:575` repeats what `beat-bundle.ts:193` already logs.

   **Keep:**
   - content-block and text-model fallback warnings
   - the gemini schema warnings at `router.ts:87` and `:93`
   - `[refs] dropped reference`
   - the storyboard fallback error at `:766`
   - cost recorder errors
   - job failures

## 3. Proposed architecture

Principle (framework §56): improve the visual state reasoning before compilation rather than lengthening the prose. The composer, the existing LLM call, becomes the single reasoning point and returns structured English continuity state. The deterministic compiler validates, resolves contradictions and renders. No new model call.

### Layer responsibilities
| Layer | File(s) | Owns |
|---|---|---|
| Composer prompt and schema | `prompt-config.shared.ts` visual_prompt template and locked guardrail; `generation-schemas.ts` `storyboardPlanSchema`; `beat-orchestration.ts` `composeStoryboardPlan` | English planning output, transition classification, LOCKED/EVOLVE/FREE per character, per-panel story function and camera intent, must-not-inherit |
| Plan validation (new) | `lib/ai/storyboard-plan.shared.ts` | Parse and normalize the plan, English check with fallback, contradiction resolution, presence/absence, shot-diversity warning |
| Scene spec | `lib/ai/prompt-compiler/scene-spec.shared.ts` | Map the new fields into `CanonicalImageScene` (schema 1.1), Unicode-safe matching, word-boundary caps |
| Relevance | `relevance.shared.ts` | Unicode tokenizer; an empty key is never a duplicate or a name |
| Compiler | `compile.shared.ts`, `capability.shared.ts` | Structured sectioned output, 3,000/5,000 policy, lossless-first compression, final English assertion, binding lines inside the budget |
| Model adapter | `renderNegatives` adapters (gemini-v1, neutral-v1) | Provider phrasing only |
| References | `story-store.ts`, `beat-bundle.ts`, `reference-binding.ts` | Identity-only binding text, previous-storyboard reference gated by transition, attach present characters only |

### Plan schema additions
All are optional in the TypeScript types for old stored beats. For provider strictness see risk R3.

```ts
StoryboardPlan += {
  transition: {                       // previous beat -> this beat
    timeRelation: 'continuous'|'same_session'|'hours_later'|'next_day'|'days_weeks_later'|'months_later'|'years_later'|'flashback'|'memory'|'dream'|'unknown';
    locationRelation: 'same_exact'|'same_building_different_area'|'same_category_different_location'|'new_location'|'unknown';
    evidence: string;                  // English, short
  };
  setting: { location: string; timeOfDay: string; era: string };   // English
  characterVisuals: Array<{
    name: string;                      // canonical name exactly as in Characters
    englishName: string;               // romanized, used in the image prompt
    identityAnchors: string;           // LOCKED: face, skin tone, build, distinctive marks (never clothing)
    currentAppearance: string;         // age/life stage, hair, wardrobe, accessories, physical state
    modes: { age: Mode; hair: Mode; wardrobe: Mode; accessories: Mode };  // Mode = 'LOCKED'|'EVOLVE'|'FREE'
  }>;
  mustNotInherit: string[];            // e.g. "previous wardrobe", "previous pool architecture"
}
StoryboardFramePlan += {
  storyFunction: 'ESTABLISH'|'REVEAL'|'ESCALATE'|'HESITATE'|'REACT'|'CHOOSE'|'ACT'|'TRANSFORM'|'CONNECT'|'ISOLATE'|'RESOLVE'|'FORESHADOW'|'CONTRAST';
  timeRelationToPreviousPanel: same enum as timeRelation;   // jumps can happen INSIDE a beat (the Hindi beat 3 went child -> adult between panels 2 and 3)
  appearanceChanges: string[];          // English, per panel, when a character's look differs from characterVisuals
  shotScale: string; cameraHeight: string;   // plus existing cameraAngle
  visualEcho: boolean;                  // deliberate repeated framing
}
```

## 4. Implementation sequence

Each unit is one Sonnet commit. The gates are tsc, lint, `npm test`, build:verify and test:e2e.

### Unit 1: log cleanup (independent, smallest)
- `next.config.ts`: `logging: { serverFunctions: false }`. Keep request lines.
- New `lib/logging/timing.shared.ts`:
  - `logTiming(scope, meta)`, enabled when `process.env.NEXT_PUBLIC_LOG_TIMING === '1'`, which is inlined for the browser too.
  - A failure (`success:false`) always logs at `warn`.
  - Replace the bodies of the five timing helpers with calls to it.
  - Document the flag in `.env.example`.
- **Removals:**
  - Delete `narration.ts:709` TEMP DEBUG.
  - Drop the duplicate `console.error` at `beat-orchestration.ts:575` (keep the rethrow).
  - `validation_retry` logs the issue count plus the first 200 characters.
  - The seed-plan length warnings collapse into one summary line.
  - Worker ticks, `[stateful:diag]` and voice_resolver (success cases) go behind the flag.
- **Test:** the timing helper is silent without the flag and warns on failure.

### Unit 2: Unicode-safe relevance and scene spec (a prerequisite, and useful on its own)
- **`relevance.shared.ts`:**
  - Tokenize with `/[^\p{L}\p{N}\s]+/gu` after `toLowerCase()`.
  - `phraseKey('')` is never treated as a duplicate or a name; exclude `''` from `characterNameKeys`.
  - Extend `STOPWORDS`/`SYNONYM_TOKENS` untouched.
- **Boundaries:** in `scene-spec.shared.ts:229` and `compile.shared.ts:173`, use `(?<![\p{L}\p{N}])NAME(?![\p{L}\p{N}])` with the `u` flag.
- **`sanitizeText`:**
  - Cut at the last word boundary within the cap, using `Intl.Segmenter` with a whitespace fallback.
  - Add `SCENE_LIMITS.shot = 160` and raise `negativeConstraint` to 120.
- **Tests:** Hindi, Arabic and Japanese fixtures (anonymized from this beat). Distinct non-Latin phrases survive dedup, and names are detected.

### Unit 3: English composer plan, leaner composer input, English fallback plan
- **Template:** `prompt-config.shared.ts` visual_prompt:
  - Rules 1, 2, 14, 15 and 22 refer to sections by name ("the Characters section"), and each `{{var}}` appears once.
  - Add the hard rule: every string value is English, translated from the story language; `charactersPresent` and `characterVisuals.name` use canonical names exactly; the image-facing name is `englishName`.
  - Replace the sameness rules (`:468`, `:469`, `:473`, `:501`, `:534` example) with framework §45/§46 wording.
- **Locked guardrail:** `LOCKED_PROMPT_GUARDRAILS.visual_prompt` repeats the English rule, so admin overrides still get it.
- **Duplicate contract:** remove the second audience-contract append (`beat-orchestration.ts:759-762`).
- **Schema:** add the fields from section 3 to `storyboardPlanSchema`. Keep `frame.prompt` but instruct one short English sentence (open question Q2).
- **New `lib/ai/storyboard-plan.shared.ts`:**
  - `normalizeStoryboardPlan(raw, ctx)`, called at `beat-orchestration.ts:755`.
  - Coerce enums (unknown values become `'unknown'`).
  - Run `isEnglishText()`: Latin letters ≥ 90% of `\p{L}`, in a new `lib/ai/prompt-compiler/language.shared.ts`.
  - Drop non-English list items. If a panel description or cameraAngle is non-English, switch the whole plan to the English fallback and record `plan.languageFallback = true`.
- **English fallback plan:** rewrite `buildFallbackStoryboardPlan` to use only English sources:
  - `beat.imagePrompt`, which story generation keeps English
  - `continuityNotes` (English)
  - generic English per-panel framing by panel role
  - No narration text, and no character JSON sliced mid-string.
- **Tests:**
  - The resolved default composer prompt contains each section once.
  - The guardrail contains the English rule.
  - normalize handles non-English fields.
  - The fallback plan is English-only for a Hindi beat.

### Unit 4: compiler — English assertion, 3,000/5,000 policy, structured output (compiler-v2)
- **`capability.shared.ts`:** `DEFAULT_PROMPT_BUDGET_CHARS = 3000`, new `PROMPT_HARD_MAX_CHARS = 5000`, clamp max 5000. The stored `promptBudgetChars` is the target.
- **Migration `122_image_prompt_budget_target.sql`:** set `capabilities.promptCompiler.promptBudgetChars` to 3000 where it is 2800, with a ledger insert. `_rollback.sql` restores 2800. The code works with either value.
- **Scene spec v1.1:** carry `transition`, `setting`, `characterVisuals`, `mustNotInherit`, and per-panel `storyFunction`, `timeRelationToPreviousPanel`, `appearanceChanges`, `shotScale`, `cameraHeight` and `visualEcho`. Characters use `englishName` and `identityAnchors` + `currentAppearance`; if missing, use `appearanceSummary` only when `isEnglishText`, otherwise the name alone. Bump `SCENE_BUILDER_VERSION`.
- **Output sections,** separated by blank lines with short headings (framework §27, adapted):

  ```
  FORMAT            2x2 layout + reading order (existing renderComposition)
  STYLE             all four axes, one sentence each (never first-clause cut)
  SETTING AND TIME  setting + transition ("12 years after the previous scene; new location")
  CHARACTERS        name — identity anchors (LOCKED) / current appearance
  PANELS            per panel: "Top-left — ESTABLISH. Camera: <shot, height, angle>. <action>. Emotion: <…>. Focus: <…>. <X> absent. <appearance change>"
  CONTINUITY        framework §45 rule scoped by transition + must-not-inherit list
  AVOID             adapter negatives
  ```

- **Budget algorithm** (replaces levels 0–3):
  1. Render in full. If ≤ target, done.
  2. Lossless passes in order until ≤ target:
     - drop focus items already named in the action
     - drop per-panel anchors that repeat invariants
     - shorten the style scope-boundary sentence
     - cap continuity notes to transition-relevant ones
     - shorten negatives to adapter canonical buckets
  3. If still > target but ≤ 5000: accept and record the warning `over_target`.
  4. If > 5000: lossy passes until ≤ 5000:
     - trim world anchor, then invariants, then emotion, then focus
     - trim panel actions proportionally at word boundaries
     - never touch format, identity, present/absent, camera, transition or must-not-inherit
  5. Hard guarantee: never over 5000.
  6. Binding lines are measured first and subtracted from the budget. Budget and reference text must stay consistent across `story-runtime.ts:527`, `image-job-runner.ts:334` and `image-batch.ts:1227`.
- **Final gate:** if `isEnglishText(fullPrompt)` fails, record the warning `non_english_prompt`. Unknown non-Latin names are already replaced by `englishName` or "Character N".
- Bump `COMPILER_VERSION = 'compiler-v2'`. Update snapshots, `compare.shared.test.ts` and the admin comparison view (`components/admin/PromptCompilerSettingsPanel.tsx`) only if the columns change.
- **Tests:**
  - budget tiers (≤3000 untouched; 3000–5000 accepted with warning; >5000 trimmed to ≤5000, never mid-word)
  - binding lines counted
  - style keeps all four axes
  - section headings present
  - English assertion
  - determinism kept

### Unit 5: continuity model
Framework Phase 1: LOCKED/EVOLVE/FREE, transitions, must-not-inherit, presence.
- **`storyboard-plan.shared.ts` `resolveContinuityContradictions(plan)`:**
  - `timeRelation` ∈ {months_later, years_later, flashback, memory, dream}, or any panel time jump: drop invariants and anchors that pin wardrobe, hair or accessories unless the mode is LOCKED. Add "previous wardrobe/hairstyle" to `mustNotInherit`.
  - `locationRelation` ∈ {new_location, same_category_different_location}: drop invariants that pin the previous location.
  - Presence: `charactersAbsent` = named characters not in `charactersPresent`, rendered for every panel where they are absent (not only recurring ones).
  - Shot diversity: if 3 or more panels share shotScale + cameraHeight and none is `visualEcho`, add the warning `camera_repetition` to metadata (no extra call).
- **Replace sameness wording** at every site in section 2e with scoped rules: framework §28 for the continuity sentence, §45 composer, §47 temporal, §48 references.
  - `reference-binding.ts:25` becomes identity only: face, build, skin tone, distinguishing marks. Hair, wardrobe, age, pose, environment and camera come from the prompt.
  - Add binding text for scene references: "previous storyboard: world and identity continuity only; do not copy its composition, camera, poses, wardrobe or location unless the prompt says the moment continues".
  - `scene-spec` `CONTINUITY.clothing` becomes derived, not `'strict'`.
- **References:**
  - Skip the previous-storyboard scene reference when the plan transition is years/months/flashback/dream or new_location (`story-store.ts:4551`, `6292`; `beat-bundle.ts:309-320`). The composer runs before the image, so the plan is available.
  - Attach character references only for `charactersPresent` in any panel (`story-store.ts:554`).
- **Story generation** (`prompt-config.shared.ts:201`, `:155`): add ageing, life-stage change and wardrobe or location change to the `changedCharacterIds` guidance. `appearanceSummary` should be updated when the look changes rather than reused.
- **Tests:** framework §52 regression fixtures as deterministic plan → compile tests, plus the Hindi beat.
  - continuous scene keeps wardrobe
  - years later drops wardrobe locks and keeps identity
  - new location drops location invariants
  - an absent character is rendered absent
  - a prop continues
  - a deliberate echo passes the diversity check
  - the camera repetition warning fires

### Unit 6: docs and handoff
- `docs/image-prompt-compiler.md`: v2 policy, English rule, budget policy.
- `GOTCHAS.md`:
  - non-Latin text in the compiler
  - binding lines inside the budget
  - continuity ≠ sameness (framework §55 note)
- `PROJECT_STATE.md`: migration 122 row and the deferred items in section 7.

## 5. Risks

- **R1 Admin prompt overrides** (`visual_prompt`, `story_generation`, `image_generation`) bypass default template edits. Mitigated by the locked guardrail and by compiler-side enforcement. The owner must check production overrides.
- **R2 Legacy and shadow modes** send the legacy prompt, which uses `frame.prompt`. The English composer fixes that path too; verify it with the flag set to `legacy` on dev.
- **R3 Schema strictness.**
  - Non-Gemini providers throw on schema mismatch (`text-gateway/router.ts:107-119`), and OpenAI-compatible strict schemas may require every property.
  - Check `text-gateway/json-schema.shared.ts` conversion and test the new schema on Luna and Qwen before rollout.
  - Keep the TypeScript fields optional for old beats.
- **R4 Output tokens and latency** on Luna could grow with the new fields. This is offset by the leaner composer input and the one-sentence `frame.prompt`. Measure latency via `ai_cost_events` before and after.
- **R5 Snapshot and version churn:** compiler-v2 changes stored diagnostics comparisons. Old rows remain readable.
- **R6 Seeded strictly_follow** must still visualize literally. The English translation must not reinterpret events; keep rule 23.
- **R7 The agentic pipeline** (`lib/agentic/story-assembly.ts:1101-1144`, `image-batch.ts:168`) uses `finalImagePromptText` with no binding lines. Include it in the English and budget tests.
- **R8 Removing previous-storyboard references on time jumps** may weaken identity for characters without portraits. Keep it when no character reference exists (decide in Q4).
- **R9 Existing gaps:** the server bundle has no world anchor or reference (`beat-bundle.ts:323-349`); the browser job path's legacy build omits worldAnchor (`story-store.ts:4578-4589`); the prompt-only multi-beat path bypasses the compiler (`story-store.ts:3812`). Fix them in Unit 4, or record them if out of scope.
- **R10 Provider-stateful mode** carries earlier images implicitly (`story-store.ts:4498`). The continuity rules cannot fully suppress inheritance there; document it.

## 6. Owner decisions (2026-09-15)

The owner said to implement; the recommended option stands for each.

1. **Q1 Names in English prompts:** the composer's romanized `englishName` (e.g. "Anvi").
2. **Q2 `frame.prompt`:** kept as one short English sentence until legacy mode is retired.
3. **Q3 Continuity notes as open threads:** `deriveOpenThreads` stops re-injecting `continuityNotes` (`story-store.ts:405-413`) and uses `nextBeatGoal` only. Lands in Unit 5.
4. **Q4 Previous-storyboard reference on time jumps or new locations:** skipped, except when no present character has a reference image.
5. **Q5 Budget update:** migration 122 (2800 → 3000).
6. **Q6 Production state:** deferred by the owner until promotion.

## 7. Deferred (record in PROJECT_STATE)

Framework Phases 3–4:
- prop lifecycle
- physical-state tracking
- environment-state tracking
- relationship geometry
- vision-based post-generation evaluation with targeted regeneration
- reels and portraits on the compiler
- per-provider adapter tuning beyond negatives

## 8. Verification (per unit and at the end)

- **Unit tests** as listed in each unit. Snapshots are updated deliberately and each diff is reviewed.
- **`npm run compare:image-prompts`:** compiled output is English, ≤ 3000 for the fixtures, and never over 5000.
- **Dev manual check** (owner): regenerate beat 4 of story `c5b8e8d2…` and a new Hindi Teens story with a time jump. Then check `beats.image_generation_metadata.promptCompiler`:
  - `compressionLevel` or the new tier fields
  - `compiledChars` ≤ 5000
  - no `non_english_prompt` warning
  - camera and story function in every panel
  - all four style axes present
  - wardrobe not pinned after the jump

  Also confirm the terminal no longer prints `└─ ƒ` arguments or `[timing:…]` lines without `NEXT_PUBLIC_LOG_TIMING=1`.
- **Luna latency and cost** for `visual_prompt` from `ai_cost_events`, before and after Unit 3.
- **Full gate:** tsc, lint, `npm test`, build:verify, test:e2e.
