# Professional-Grade Story Generator v1 Implementation Log

## Phase 1. Setup and baseline

### Goals
- Create the working branch.
- Save the approved implementation plan in the repository.
- Start a durable change log before code changes begin.

### Files and systems touched
- Git branch: `feature/pro-story-generator-v1`
- Documentation:
  - `docs/pro-story-generator-plan.md`
  - `docs/pro-story-generator-implementation-log.md`

### Decisions made
- Implementation starts from `main` on `feature/pro-story-generator-v1`.
- The repo will maintain two documents throughout the rollout:
  - a frozen implementation plan
  - a phase-by-phase change log
- Existing tables and existing feature flows will be preserved. Any schema evolution will be additive only.

### What is working
- Branch created successfully.
- Plan document added.
- Implementation log added.

### What is partially working
- The technical rollout has not started yet.

### Open issues and deferred items
- Runtime refactor for compact story context is pending.
- `visual_prompt` removal from the live path is pending.
- Style controls and authored-prelude UI are pending.
- Playground alignment and realistic fixtures are pending.

### Test evidence
- Verified repository was clean before branch creation.
- Verified branch creation succeeded and docs were created on the new branch.

## Phase 2. Story config, story bible, and continuity rules

### Goals
- Extend `StoryConfig` without breaking existing saved stories.
- Replace the old broad prompt state dump with a compact story bible.
- Improve continuity by carrying the full cast registry across the active branch path.
- Add runtime validation for story beat quality and character-name stability.

### Files and systems touched
- Types:
  - `lib/types/story.ts`
- Shared helpers:
  - `lib/ai/story-config.ts`
  - `lib/ai/story-bible.ts`
- Runtime and store:
  - `app/actions/story-runtime.ts`
  - `lib/store/story-store.ts`

### Decisions made
- New visual settings and authored-prelude data live inside `story_config`; no new database table or migration was required for v1.
- The prompt placeholder key remains `storyState` for compatibility, but the payload is now a compact story bible.
- The story store now derives session characters from the full active path instead of only the current node.
- Story beat validation checks duplicate names, renamed existing characters, missing fields, invalid option counts, and beat-number drift.
- The runtime performs one corrective retry when validation fails.

### What is working
- `StoryConfig` now supports:
  - `visualSettings`
  - `authoring.mode`
  - `authoring.preludeText`
- Existing stories remain compatible because config loading now normalizes missing nested fields to defaults.
- The runtime now builds and sends a compact story bible instead of a heavy raw state snapshot.
- Session continuity now keeps a path-wide cast registry, which improves character reference reuse across branches.

### What is partially working
- Continuity validation is rule-based rather than model-graded; it catches concrete structural/name issues but does not yet score narrative subtlety.

### Open issues and deferred items
- No persisted analytics or telemetry were added for validator retry frequency yet.
- The old legacy `app/actions/story.ts` file remains untouched and unused.

### Test evidence
- `npx tsc --noEmit`
- `npx eslint app/actions/story-runtime.ts app/actions/persistence.ts app/actions/exploration.ts app/actions/prompt-playground.ts app/actions/admin.ts components/story/AdvancedOptions.tsx components/story/LandingScreen.tsx components/admin/PlaygroundStudio.tsx lib/ai/story-config.ts lib/ai/story-bible.ts lib/ai/prompt-config.shared.ts lib/ai/model-config.shared.ts lib/store/story-store.ts`

## Phase 3. Image pipeline simplification and prompt sanitization

### Goals
- Remove the live `visual_prompt` composer hop from the production runtime.
- Keep the image wrapper as the single enforcement layer for the 2x2 storyboard requirement.
- Eliminate portrait duplication by preventing media blobs from entering text prompts.

### Files and systems touched
- Runtime:
  - `app/actions/story-runtime.ts`
- Prompt defaults and metadata:
  - `lib/ai/prompt-config.shared.ts`
  - `lib/ai/model-config.shared.ts`
  - `app/actions/admin.ts`

### Decisions made
- `visual_prompt` stays in the admin/playground ecosystem as a legacy prompt task, but it is no longer used in the live generation runtime.
- Image generation now wraps the story model’s `imagePrompt` directly, with character anchors and style direction injected into the final image wrapper.
- Portraits remain as inline reference images only; prompt text now uses sanitized character anchors instead of raw character objects with media payloads.

### What is working
- The live runtime no longer makes a second Gemini text call to compose image prompts.
- The final image wrapper now explicitly carries:
  - scene brief
  - character continuity anchors
  - derived visual style
  - beat number
  - hard 2x2 storyboard constraints
- The base64 duplication root cause is fixed in the prompt path because `portraitBase64` is stripped from text serialization.
- Admin model override loading no longer fetches the `visual_prompt` production prompt for runtime use.

### What is partially working
- Legacy `visual_prompt` task data remains editable in the playground by design, even though it is no longer part of live generation.

### Open issues and deferred items
- Reference-image reuse after a story is reloaded from storage is still limited by the existing asset flow; this implementation fixes prompt duplication but does not introduce a new signed-image-to-inline conversion path.

### Test evidence
- `npx tsc --noEmit`
- Targeted eslint run listed in Phase 2

## Phase 4. User style controls and authored-prelude flow

### Goals
- Replace the hardcoded visual style with lightweight user controls.
- Support visible user-authored preludes that the story continues from.
- Keep the old prompt-only path working unchanged for users who do not opt in.

### Files and systems touched
- UI:
  - `components/story/AdvancedOptions.tsx`
  - `components/story/LandingScreen.tsx`
  - `components/story/StoryScreen.tsx`
  - `components/story/StorylinePlayer.tsx`
  - `app/storyline/[id]/page.tsx`
- Load/save compatibility:
  - `app/actions/persistence.ts`
  - `app/actions/exploration.ts`

### Decisions made
- The landing flow exposes exactly four user-facing creative controls:
  - style preset
  - theme
  - palette
  - detail
- Authored text is treated as a visible prelude, not a hidden instruction.
- Prelude rendering is shown before beat 1 in both the active story reader and the published storyline player.
- No new schema was needed because `story_config` already exists as JSON.

### What is working
- Users can now pick a mixed-media visual preset and three lightweight style refinements from Advanced Options.
- Users can toggle `Start from my own writing` and provide a prelude text block.
- The landing page restores the richer config after auth redirects.
- Saved and explored stories now normalize the richer config structure on load.
- Published storyline playback can fetch and render the prelude text from the source story’s `story_config`.

### What is partially working
- The prelude is rendered as an intro section above beat 1 rather than as a completely separate standalone node/card in the story graph.

### Open issues and deferred items
- There is still only one primary top-level prompt box; this release keeps the secondary authored-prelude textarea under Advanced Options rather than creating a separate full authoring screen.

### Test evidence
- `npx tsc --noEmit`
- Manual code-path verification across landing, active story, saved story load, exploration load, and published storyline load

## Phase 5. Admin playground alignment

### Goals
- Make the playground reflect the new production runtime path.
- Add more realistic prompt fixtures.
- Expose the resolved prompt so prompt cost and prompt bloat are easier to inspect.

### Files and systems touched
- `components/admin/PlaygroundStudio.tsx`
- `app/actions/prompt-playground.ts`

### Decisions made
- `visual_prompt` remains visible with a legacy badge instead of being deleted or hidden.
- The playground now treats the story bible and the image wrapper as the primary tuning surfaces for production.
- Resolved prompt previews are computed client-side in the admin UI for fast inspection.

### What is working
- Story generation defaults now use a realistic story bible fixture instead of `{}`.
- Image wrapper defaults now include character anchors, style direction, and beat number inputs.
- Legacy `visual_prompt` is clearly marked as non-production in the UI.
- Admins can inspect the final resolved prompt text directly in the playground before running a test.

### What is partially working
- The playground keeps legacy composer testing available for comparison rather than fully disabling it.

### Open issues and deferred items
- There is not yet a one-click library of multiple fixture presets; the richer defaults are in place, but switching scenarios is still manual.

### Test evidence
- `npx eslint app/actions/prompt-playground.ts components/admin/PlaygroundStudio.tsx lib/ai/prompt-config.shared.ts lib/ai/model-config.shared.ts`

## Phase 6. Verification and repo health check

### Goals
- Verify type safety.
- Verify the changed files for lint cleanliness.
- Record remaining blockers outside the feature scope.

### Files and systems touched
- Verification only; no product logic added in this phase.

### Decisions made
- `tsconfig.tsbuildinfo` was restored after verification so the branch only carries intentional product changes.

### What is working
- TypeScript compile check passes.
- Targeted eslint passes for the newly introduced helpers and the main modified runtime/admin files.

### What is partially working
- Full repo lint is still red because of pre-existing React purity issues in files outside or adjacent to this feature work.

### Open issues and deferred items
- Full `npm run lint` currently fails on existing repo issues in:
  - `app/signed-out/page.tsx`
  - `components/story/NarrationButton.tsx`
  - `components/story/PromptCarousel.tsx`
  - `components/story/StoryScreen.tsx`
  - `components/story/StorylinePlayer.tsx`
  - `lib/hooks/useAudioPlayer.ts`
- These were not fully refactored here because they represent broader React effect/purity cleanup beyond this feature’s scope.

### Test evidence
- `npm run lint` (fails on existing repo-wide purity issues listed above)
- `npx tsc --noEmit` (passes)

## Phase 7. Architecture realignment after storyboard flow review

### Goals
- Reconcile the branch implementation with the intended platform flow shared in the storyboard diagram.
- Lock the next implementation direction before additional code changes are made.
- Record the required portrait-first beat 1 behavior and continuity behavior for later beats.

### Files and systems touched
- Documentation only:
  - `docs/pro-story-generator-plan.md`
  - `docs/pro-story-generator-implementation-log.md`

### Decisions made
- `visual_prompt` is reinstated as a live production stage.
- The composer is no longer treated as optional prompt polish; it becomes a structured visual planner.
- The composer has two responsibilities:
  - storyboard decomposition into 4 explicit sequential frames
  - portrait-task planning for newly introduced named characters
- Beat 1 must generate portraits before storyboard generation.
- Beat 1 storyboard generation must receive portrait references as visual context.
- Beat 2+ storyboard generation must receive the last storyboard image as continuity context.
- Beat 2+ portrait generation only runs when new named characters are introduced or major visible transformations occur.
- Prompt examples are now considered part of the intended production strategy, especially for the visual composer.

### What is working
- The branch already contains reusable groundwork that still aligns with the revised architecture:
  - compact story bible
  - continuity validator
  - style controls
  - authored-prelude support
  - prompt sanitization helpers

### What is partially working
- The current branch runtime still bypasses the composer in live generation.
- The current image wrapper improvements remain useful, but they need to be repositioned behind the restored composer stage.

### Open issues and deferred items
- The next implementation pass must:
  - reintroduce `visual_prompt` into the live runtime
  - change its output to structured JSON
  - restore portrait-first beat 1 sequencing
  - add previous-storyboard continuity context for later beats

### Test evidence
- Architecture review completed against the shared storyboard flow and clarified product requirements.

## Phase 8. Structured composer runtime implementation

### Goals
- Implement the locked production flow:
  - `story_generation`
  - `visual_prompt` structured composer
  - portrait-first beat 1 rendering
  - previous-storyboard continuity for beat 2+
- Preserve backward compatibility for saved stories and prompt history while replacing the legacy live composer assumptions.
- Realign the admin playground and production runtime so they test the same composer contract.

### Files and systems touched
- Runtime and store:
  - `app/actions/story-runtime.ts`
  - `lib/store/story-store.ts`
  - `lib/ai/story-bible.ts`
  - `lib/ai/generation-schemas.ts`
  - `lib/types/story.ts`
- Prompt/admin/playground:
  - `lib/ai/prompt-config.shared.ts`
  - `lib/ai/model-config.shared.ts`
  - `app/actions/admin.ts`
  - `app/actions/prompt-playground.ts`
  - `components/admin/PlaygroundStudio.tsx`
- Persistence compatibility:
  - `app/actions/persistence.ts`
  - `app/actions/exploration.ts`
- Docs:
  - `docs/pro-story-generator-plan.md`
  - `docs/pro-story-generator-implementation-log.md`

### Decisions made
- `visual_prompt` is live again in runtime, but now returns structured JSON rather than plain text.
- The composer prompt is example-led for intent, but the response is schema-driven JSON.
- Beat 1 now composes the storyboard plan first, generates required portraits, and only then renders the storyboard image.
- Beat 2+ uses the previous storyboard image as the primary visual continuity reference, with new portraits attached only when new or visibly changed characters require them.
- Runtime prompt loading now validates editable prompt templates and falls back to code defaults when stored prompt bodies are missing newly required placeholders.
- Structured storyboard metadata (`storyboardPlan`, `newCharacterIds`, `changedCharacterIds`) stays in `story_map` JSONB for compatibility; normalized beat rows remain unchanged.

### What is working
- Story generation now requests and validates `newCharacterIds` and `changedCharacterIds`.
- The live runtime now calls `composeStoryboardPlan()` and renders the returned `StoryboardPlan` through the image wrapper.
- Beat 1 portrait generation completes before storyboard image generation and those portraits are passed as image references into Gemini.
- Beat 2+ storyboard image generation now uses the last storyboard image as scene continuity context and passes newly generated portraits only when needed.
- Regenerate-image flow now reuses stored storyboard plans when available and can recompose them if missing.
- Prompt playground now tests `visual_prompt` with the live JSON schema and updated placeholder set.
- Admin production override loading once again fetches the `visual_prompt` prompt/model configuration for live runtime use.
- Saved and explored stories can still reconstruct storyboard metadata from `story_map` even though the normalized `beats` table schema was not changed.

### What is partially working
- `lib/ai/prompt-config.shared.ts` still contains the older exported `VISUAL_PROMPT_DEFAULT` constant for historical reference, while the runtime now uses `VISUAL_STORYBOARD_COMPOSER_PROMPT_DEFAULT`.
- Composer quality is now structurally correct, but prompt tuning and richer fixtures are still needed to optimize adherence, cost, and cinematic quality.

### Open issues and deferred items
- The next tuning round should add stronger visual-composer fixtures for:
  - first beat with two new named characters
  - later beat with no new characters
  - later beat with one visibly transformed returning character
- If prompt history in Supabase contains older visual-composer drafts, admins may need to republish updated versions after comparing them in the playground.
- Full repo lint remains subject to the pre-existing React purity issues logged in Phase 6; this phase stayed scoped to the story-generator architecture.

### Test evidence
- `npx tsc --noEmit`
- `npx eslint app/actions/story-runtime.ts app/actions/prompt-playground.ts app/actions/admin.ts components/admin/PlaygroundStudio.tsx lib/store/story-store.ts lib/ai/story-bible.ts lib/ai/prompt-config.shared.ts lib/ai/model-config.shared.ts app/actions/persistence.ts app/actions/exploration.ts`

## Phase 9. First-beat cloud save regression fix

### Goals
- Fix the stuck first-beat save spinner.
- Ensure storyboard images, portrait refs, and narration uploads can actually start after first-beat generation.
- Prevent base64 portrait data from being sent inside oversized story save payloads.

### Files and systems touched
- `lib/store/story-store.ts`
- `app/actions/persistence.ts`

### Decisions made
- The cloud-save request now sends a persistable session snapshot instead of the full in-memory session object.
- Unused `beats` payload data is dropped entirely from the client-to-server save request.
- Top-level `session.characters` are sanitized before save so portrait base64 stays local and never gets posted into the story row payload.
- Server-side persistence now also sanitizes `stories.characters` defensively before DB write.

### What is working
- First-beat save requests are now much smaller and no longer include portrait base64 in the top-level session payload.
- Asset upload can proceed to the `story-assets` bucket after the initial story row save completes.
- The persisted `stories.characters` JSON will keep portrait URLs when available but will no longer accidentally retain portrait base64 blobs.

### What is partially working
- A save request that was already stuck in-flight before this patch will not magically repair itself; the fix applies to the next save attempt.

### Open issues and deferred items
- If the currently open browser tab is still showing the old stuck save request, the user may need to trigger one fresh save attempt after the patched code reloads.

### Test evidence
- `npx tsc --noEmit`
- `npx eslint lib/store/story-store.ts app/actions/persistence.ts`
