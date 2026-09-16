# Image Prompt Compiler (JSON Image Prompt Optimization)

Replaces the repetitive, multi-layer image-prompt assembly for **storyboard beats**
with a versioned canonical scene JSON → deterministic relevance filter + semantic
dedup → provider-neutral compiler → capability-aware final prompt. Shipped behind a
4-mode flag with shadow comparison, admin controls and rollback.

Scope of this rollout: **storyboard `image_generation` only**. Reels
(`reel_image_generation`) and portraits stay on the legacy path in every mode.

## Why

The legacy path injects each character's identity 3–4× per generation (composer
`{{characters}}`, final wrapper `{{characters}}`, per-reference binding lines, and
the composer copies identity into each of the 4 frame `prompt` fields) and repeats
the negative/no-text constraints across ~5 layers. It also leaked internal data:
`buildPromptCharacterAnchors` serialized character UUIDs, personality summaries and
`hasReferencePortrait` into the prompt. There was no prompt budget, dedup or
versioning. On the fixtures the compiler cuts prompt size ~48–67% while removing the
leaked ids and keeping every critical requirement — run `npm run compare:image-prompts`.

## Architecture

Pipeline (all pure/isomorphic — `lib/ai/prompt-compiler/*.shared.ts`):

1. **Canonical scene** — `scene-spec.shared.ts` `buildCanonicalImageScene(...)` maps
   the existing `StoryboardPlan` structured fields (`description`, `cameraAngle`,
   `visualFocus`, `emotion`, `continuityAnchor`, and composer-supplied
   `charactersPresent`) — never the redundant per-frame `prompt` — into an id-free,
   versioned `CanonicalImageScene`. Character keys are name slugs; UUIDs/personality
   are excluded. Regeneration deltas become scoped `userDirectives`. Beats without a
   plan take a `legacy_text` passthrough. `validateCanonicalImageScene` guards it.
2. **Relevance filter + dedup** — `relevance.shared.ts` `filterAndDedupScene(...)`
   canonicalizes negative-constraint families, dedups invariants/visual-focus by a
   synonym-folded key, hoists a focus shared by ≥3 panels to global, demotes a global
   that names one panel, drops focus items that restate a present character, and warns
   (never merges) on conflicting color/temperature/time/shot/emotion.
3. **Compiler (v2)** — `compile.shared.ts` `compileImagePrompt(scene, capability,
   {reservedChars})` renders eight headed sections, separated by blank lines, in a fixed
   order: `FORMAT`, `STYLE`, `SETTING AND TIME`, `CHARACTERS`, `PANELS`, `CONTINUITY`,
   `USER DIRECTIVES` (only with regeneration deltas) and `AVOID`. Every string is English:
   a character appears under its image-facing name (the composer's romanized `englishName`,
   else the display name when it already reads as English, else `Character N`), and the
   prompt is checked at the end — a failure records the warning `non_english_prompt` rather
   than shipping mixed-script text silently. The redaction pass scrubs
   uuids/`r2://`/urls/storage keys and control characters **except newlines**, which carry
   the section breaks; stripping them is what used to collapse the whole prompt into one
   block. Adapters: `neutral-v1` (bulleted negatives) and `gemini-v1` (one "Avoid: …"
   sentence). Deterministic: the same scene, capability and `reservedChars` always produce
   byte-identical output.
4. **Assembler** — `assemble.shared.ts` `assembleFinalImagePrompt({runtime, scene,
   legacyBuild, reservedChars})` decides per mode and returns the final prompt +
   diagnostics (including `budgetTier`, `targetChars` and `reservedChars`).

### Budget policy

`promptBudgetChars` is a **target**, not a ceiling; `PROMPT_HARD_MAX_CHARS` (5,000) is the
ceiling and is never exceeded. Reference-image binding lines are measured first
(`estimateReferenceBindingChars`) and subtracted from both limits, so the prompt plus its
binding lines still fits. `compressionLevel` records which tier was reached:

| Tier | Meaning |
|---|---|
| 0 | The full render fit the target. |
| 1 | Lossless passes reached it: focus items already named in the action, anchors that repeat an invariant, the long style scope line, surplus continuity notes, non-canonical negatives. |
| 2 | Over target but within the hard cap — accepted, warning `over_target`. |
| 3 | Over the hard cap — lossy trimming (world anchor, invariants, emotion, focus, proportionally shortened actions), warning `lossy_trim`, and a final word-boundary cut (`hard_cut`) if anything remains. |

Never removed at any tier: the format block, character identity, who is present or absent,
camera, the transition sentence, "do not carry over" and the canonical negative buckets.

Capability (`capability.shared.ts`) is read from `image_model_registry.capabilities.
promptCompiler` and normalized fail-closed. Mode (`mode.ts`, server-only) is read from
the `image_prompt_compiler_mode` feature flag.

## Modes

| Mode | Sent prompt | Notes |
|---|---|---|
| `legacy` | legacy | No compilation. Rollback target. |
| `shadow` (default) | **legacy** | Compiles + records a legacy-vs-compiled comparison in `image_generation_metadata.promptCompiler`. Zero user-visible change; no extra provider call. |
| `new` | compiled | Compile failure fails the image (reservation released via existing paths). |
| `new_with_legacy_fallback` | compiled | Falls back to legacy on compile failure, recording `fallbackReason`. |

The compiler runs only when the mode is non-legacy **and** the model's
`capabilities.promptCompiler.enabled` is true. Client paths read the mode+capability
through a 60s-cached server action (`resolveImagePromptCompilerRuntimeAction`),
mirroring `media_processing_mode`; the server bundle path resolves it directly.

## Configuration

- **Flag** `image_prompt_compiler_mode` (value: `legacy|shadow|new|new_with_legacy_fallback`) — admin at `Admin → Global Settings → Image prompt compiler`, or the DB `feature_flags` row.
- **Per-model capability** `capabilities.promptCompiler` (`enabled`, `promptBudgetChars`, `supportsNegativePrompt`, `adapterVersion`) — admin at `Admin → Image Models` (per-row "Prompt compiler" editor). `promptBudgetChars` is the **target** (clamped 1,200–5,000); the 5,000 hard cap is fixed in code, not per model. Do not lower the target to make room for reference-image lines — the compiler already reserves those.
- **Diagnostics** land in `beats.image_generation_metadata.promptCompiler` on both the inline and server-pipeline paths; the admin comparison view reads them. `compressionLevel` is the budget tier (see above).

## Migration

Apply **manually in the Supabase dashboard** (never the CLI):
`supabase/migrations/081_image_prompt_compiler.sql` seeds the flag at `shadow` and
enables the Gemini `image_generation` capability (2800-char budget, `gemini-v1`).
`081_image_prompt_compiler_rollback.sql` reverts it.
`supabase/migrations/122_image_prompt_budget_target.sql` raises every row still at the 081
default to a 3,000-char target (applied on dev 2026-09-16; **not** on production).

## Rollout runbook

1. Apply migration 081 (flag = `shadow`). Nothing user-visible changes.
2. Generate a few beats; open `Admin → Image prompt compiler` and confirm comparison
   rows appear with a meaningful reduction and no warnings.
3. Flip a strong model to `new_with_legacy_fallback` (start with one). Verify image
   quality and that the compiled prompt is what shipped (gallery `promptSnapshot`).
4. Widen gradually; consider `new` only after `new_with_legacy_fallback` is clean.

## Rollback

Set the mode to `legacy` in the admin panel (no redeploy). To fully revert config, run
the rollback SQL. Stored compiled prompts/diagnostics are historical and harmless.
Coin/job integrity is unaffected: compilation is local text work, so shadow never
double-calls the image API, and a strict `new`-mode failure releases the reservation
through the existing failure paths.

## Verification

- `npm test` — full suite (compiler unit/snapshot/determinism/redaction/assemble/compare).
- `npm run compare:image-prompts` — prints legacy vs compiled char counts for the fixtures.
- `npx tsc --noEmit` — type check.
- **Live, paid, opt-in:** `COMPOSER_SCHEMA_SMOKE=1 npx vitest run --config vitest.smoke.config.ts scripts/composer-schema.smoke.ts`
  sends the real composer template to GPT-5.6 Luna and Gemini 3.8 Flash for an invented Hindi
  beat set twelve years after a childhood scene, then runs the returned plan through the scene
  builder and compiler and asserts the finished prompt is English, sectioned, free of the
  story's own script, and inside the hard cap. Skipped unless the env var is set.
  First run (2026-09-16): both providers accepted the schema and detected the time jump and
  location change; the compiled prompts were 4,683 chars (Luna) and 3,719 (Gemini) — both
  **tier 2**, i.e. over the 3,000 target and carrying `over_target`. Expect real beats to land
  there until the composer's brevity limits or the target are tuned.
- Manual QA after applying migration 081 to dev (ask before launching the dev server):
  shadow → generate → comparison rows; `new_with_legacy_fallback` → verify compiled
  output; back to `shadow`/`legacy`.

## Adding a provider adapter

Add a branch in `compile.shared.ts` (`renderNegatives` and any section overrides keyed
on `capability.adapterVersion`), extend `PromptCompilerAdapterVersion` in
`capability.shared.ts`, and expose it in the Image Models "Prompt compiler" editor.
Document why the adapter differs.

## Deferred (out of scope)

Strategy B/C storyboard composition (per-panel generation + compositing, layout-control
references), post-generation layout validation/OCR, an offline LLM prompt optimizer,
automated visual-quality scoring campaigns, reel + portrait coverage, openai/xai adapter
tuning (those models are disabled), and cohort/percentage rollout automation.
