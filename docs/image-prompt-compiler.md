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
3. **Compiler** — `compile.shared.ts` `compileImagePrompt(scene, capability)` renders
   sections in the fixed priority (layout → identity+references → panel action →
   continuity → world/scene → style → negatives), states each fact once, adds explicit
   absence only for strongly-recurring characters the action doesn't already name, and
   applies a model-aware budget with priority-aware compression levels 0–3 (never
   dropping identity, present characters, actions, layout, user deltas or critical
   negatives; warns instead of blind-truncating at level 3). A final redaction pass
   scrubs uuids/`r2://`/urls/storage keys/control chars. Adapters: `neutral-v1`
   (bulleted negatives) and `gemini-v1` (one "Avoid: …" sentence). Deterministic.
4. **Assembler** — `assemble.shared.ts` `assembleFinalImagePrompt({runtime, scene,
   legacyBuild})` decides per mode and returns the final prompt + diagnostics.

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
- **Per-model capability** `capabilities.promptCompiler` (`enabled`, `promptBudgetChars`, `supportsNegativePrompt`, `adapterVersion`) — admin at `Admin → Image Models` (per-row "Prompt compiler" editor).
- **Diagnostics** land in `beats.image_generation_metadata.promptCompiler` on both the inline and server-pipeline paths; the admin comparison view reads them.

## Migration

Apply **manually in the Supabase dashboard** (never the CLI):
`supabase/migrations/081_image_prompt_compiler.sql` seeds the flag at `shadow` and
enables the Gemini `image_generation` capability (2800-char budget, `gemini-v1`).
`081_image_prompt_compiler_rollback.sql` reverts it.

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
