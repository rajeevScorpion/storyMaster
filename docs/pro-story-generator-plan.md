# Professional-Grade Story Generator v1

## Summary
- Keep the 2x2 image grid as a permanent output requirement and enforce it in the final image wrapper.
- Keep the `visual_prompt` stage, but redefine it as a structured visual composer instead of a prose-polishing hop.
- Use the visual composer for two jobs:
  - storyboard planning for every beat
  - portrait-prompt planning only when new characters must be visually defined
- Require portrait generation before storyboard generation on beat 1, then send those portraits as visual context into the storyboard image generation call.
- From beat 2 onward, send the last storyboard plus any newly generated portraits as visual context to maintain continuity.
- Keep the system fully backward compatible: no existing tables are dropped, no current flow is removed, and any DB changes remain additive only.

## Current Status
- Branch `feature/pro-story-generator-v1` now includes the locked live-flow wiring:
  - `story_generation` emits `newCharacterIds` and `changedCharacterIds`
  - `visual_prompt` runs as a structured storyboard composer in production
  - beat 1 generates portraits before storyboard rendering
  - beat 2+ storyboard rendering uses the previous storyboard image plus any newly generated portraits
- Admin prompt playground has been updated to test the structured composer JSON rather than the legacy plain-text composer flow.
- Persistence remains additive only. No migrations, table drops, or destructive schema changes were introduced in this implementation pass.
- The remaining work on this branch is now quality tuning, richer fixtures, and further prompt refinement rather than core plumbing.

## Target Runtime Architecture

### 1. Story writer
- `story_generation` remains responsible for narrative only.
- It generates:
  - beat story text
  - scene summary
  - options / branching
  - continuity notes
  - image intent
  - character records
  - explicit flags for new characters
- It must flag every newly introduced named character so downstream visual work does not rely on inference.
- Recommended additions to beat output:
  - `newCharacterIds: string[]`
  - optional `changedCharacterIds: string[]` for major visible transformations

### 2. Visual composer
- `visual_prompt` stays in the production runtime and becomes a true visual planner.
- It receives:
  - beat story text
  - scene summary / image intent
  - cast registry
  - used character names
  - continuity notes
  - visual settings
  - authored prelude context if present
  - current beat number
  - previous storyboard summary
  - previous storyboard image reference when available
  - portrait references when available
  - `newCharacterIds`
- It returns structured JSON, not plain text.
- Recommended output shape:
  - `sharedVisualInvariants`
  - `portraitTasks`
  - `topLeft`
  - `topRight`
  - `bottomLeft`
  - `bottomRight`
  - optional `negativeConstraints`
- Each frame block should include:
  - `description`
  - `prompt`
  - `cameraAngle`
  - `visualFocus`
  - `emotion`
  - `continuityAnchor`

### 3. Beat 1 visual flow
- Beat 1 order must be:
  - story generation
  - visual composer
  - portrait generation for all newly introduced named characters
  - storyboard image generation
- Portrait generation is mandatory before the storyboard is generated.
- The generated portraits must be passed as image references along with the storyboard prompt to Gemini for the beat 1 storyboard.
- This establishes character appearance before the first board is rendered.

### 4. Beat 2+ visual flow
- Beat 2 onward order must be:
  - story generation
  - visual composer
  - portrait generation only if `newCharacterIds` is non-empty, or if a character undergoes a major visible change
  - storyboard image generation
- Storyboard generation must receive:
  - the last storyboard image as visual continuity context
  - portrait references for continuing characters when useful
  - any newly generated character portraits for newly introduced characters
- Unnamed or background characters must not trigger portrait generation.

### 5. Image wrapper
- The final `image_generation` wrapper should assemble the final image brief from:
  - shared visual invariants
  - frame-level visual prompts
  - 2x2 hard constraints
  - continuity restrictions
- The wrapper stays responsible for:
  - 2x2 grid requirement
  - panel order
  - no text overlays
  - no watermark
  - no captions
  - continuity constraints
- The wrapper should not invent cinematic content; it should faithfully package the visual composer output for the image model.

## Prompt Strategy

### Production prompt design
- Use examples in prompts to clarify intent, not to provide output structure.
- Keep production examples compressed for token efficiency.
- Best use of examples:
  - `story_generation`: 1 short exemplar
  - `visual_prompt`: 2 exemplars
    - first beat with new character creation
    - later beat with no new character creation
  - `portrait_generation`: 1 short exemplar
- `image_generation` should use constraints rather than exemplars unless quality testing proves a small exemplar is needed.

### Example policy
- The visual composer examples should teach:
  - how a single beat becomes four sequential storyboard moments
  - how emotional energy escalates across the four frames
  - how character and environment continuity are preserved
  - how portrait tasks are emitted when new characters appear
- Richer human-readable examples should live in docs and playground fixtures.
- Shorter compressed versions should be used inside live production prompts.
- Internal prompt examples remain in English even when the output story language is Hindi.

## Data and Interface Changes

### Story config
- Keep the existing `StoryConfig` extension:
  - `visualSettings: { preset, theme, palette, detail }`
  - `authoring: { mode: 'prompt' | 'seed_continue', preludeText?: string }`
- Keep `visualStyle` as a derived compatibility field.

### Story beat output
- Extend the story writer output to include explicit visual workflow flags:
  - `newCharacterIds`
  - optional `changedCharacterIds`
- Existing fields remain for backward compatibility.

### Visual composer output
- Change the live composer output from plain text to structured JSON.
- Add portrait task objects for any new named character introduced in the beat.
- Portrait task objects should include enough detail for portrait generation to run without re-interpreting the narrative.

### Persistence
- Prefer existing JSON fields where feasible, especially `story_config`.
- Do not drop or repurpose existing tables.
- If new persistence is eventually required for structured storyboard metadata, add new tables only and include forward and rollback SQL.

## Implementation Phases

### Phase 1. Checkpoint and traceability
- Keep the current branch as the base checkpoint.
- Preserve the plan doc and implementation log.
- Commit the current branch state before the next round of implementation changes.

### Phase 2. Story writer alignment
- Update `story_generation` prompt and schema so the writer flags new characters explicitly.
- Preserve current continuity and validation improvements.
- Ensure authored preludes and visual settings remain part of the compact story bible.

### Phase 3. Visual composer redesign
- Reintroduce `visual_prompt` into the live runtime.
- Change it from plain text output to structured storyboard JSON.
- Add portrait task support for beat 1 and for later beats with new characters.
- Add compressed in-prompt exemplars for:
  - first beat
  - later beat

### Phase 4. Portrait-first beat 1 flow
- Run portrait generation first on beat 1 using composer-generated portrait tasks.
- Pass generated portraits as reference images into beat 1 storyboard generation.
- Ensure no portrait base64 leaks into prompt text.

### Phase 5. Continuity-driven beat 2+ flow
- Use the previous storyboard image as visual continuity context for subsequent beats.
- Use new portraits only when newly introduced named characters appear.
- Keep the cast registry and validation rules active.

### Phase 6. Playground and evaluation alignment
- Update the admin playground so production mirrors the new path:
  - story writer
  - visual composer
  - portrait generation
  - image wrapper
- Add fixtures for:
  - beat 1 with portraits
  - later beat with continuity
  - later beat with newly introduced character
  - authored-prelude continuation
- Keep resolved prompt preview and add composer JSON preview.

## Test Plan
- Beat 1 generates portrait tasks for all newly introduced named characters.
- Beat 1 portrait generation completes before storyboard generation begins.
- Beat 1 storyboard generation includes portrait image references in the Gemini image call.
- Beat 2+ storyboard generation includes the previous storyboard image as continuity context.
- Newly introduced named characters on later beats trigger portrait generation before storyboard rendering.
- Existing named characters do not get re-portraited unless marked as visually changed.
- Story writer output correctly flags `newCharacterIds`.
- Visual composer returns valid structured JSON with four frame blocks.
- Image wrapper produces a valid 2x2 board using the composer output.
- Existing saved stories still load, branch, narrate, and publish correctly.
- No tables are dropped and no destructive migration is introduced.

## Assumptions
- Branch remains `feature/pro-story-generator-v1`.
- Documentation remains in:
  - `docs/pro-story-generator-plan.md`
  - `docs/pro-story-generator-implementation-log.md`
- Current groundwork already completed in this branch remains useful:
  - compact story bible
  - continuity validation
  - style controls
  - authored-prelude support
  - prompt sanitization
- The next implementation pass will revise the currently simplified image pipeline so it matches this restored visual-composer architecture.
