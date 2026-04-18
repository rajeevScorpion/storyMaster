# Script-Seeded Story Implementation Notes

## Discovery Findings
- Story creation currently materializes one beat at a time through `startStory()` and `continueStory()`.
- The existing `seed_continue` mode is only a legacy authored prelude, not a canonical seeded path.
- Story persistence uses both `stories.story_map` JSON and normalized `beats` rows linked by `parent_node_id` + `selected_option_id`.
- Publishing and storyline extraction recover linear paths by following normal story-tree option links.
- Image generation, narration, and publishing already trigger from normal beat visitation; there is no queue-backed prebuild pipeline.
- Prompt and model orchestration already live in centralized task registries and the admin playground.

## Decisions Made
- Replace the legacy `seed_continue` authoring mode with `seeded`.
- Keep prompt story creation intact.
- Store confirmed seeded source metadata and seed plans inside `story_config.authoring` instead of creating a new table in v1.
- Materialize only visited canonical beats so image generation and per-beat billing continue to behave exactly like the current runtime.
- Persist canonical/runtime metadata on beats so the original path is recoverable without changing publish extraction logic.
- Add a text-only preview step before story creation.
- Add a shared authoring word cap setting and a configurable preview price, both controlled from admin settings.
- Keep the canonical continuation as an explicit first option on seeded beats, marked in the active reader as the original path.
- Keep published storyline playback free of extra canonical chrome; the metadata stays persistent and recoverable in storage instead.

## Implementation Notes
- Added structured seed authoring types (`SeedPlan`, `SeedBeatOutline`, `SeedPlanOption`) and canonical beat metadata (`originKind`, `seedPlanBeatIndex`, `canonicalOptionId`).
- Added two new prompt/model tasks:
  - `seed_plan_generation` for the text-only preview
  - `seeded_beat_materialization` for turning one confirmed seed beat into a runtime `StoryBeat`
- Updated the Gemini proxy and prompt playground so both new tasks can be tested and published through the existing admin tooling.
- Updated story runtime so seeded preview generation uses the centralized prompt registry and seeded beat materialization preserves the authored beat text/options while filling runtime continuity/image/narration fields.
- Updated the Zustand story store so:
  - seeded stories start from beat 1 of the confirmed seed plan
  - selecting the canonical option materializes the next seed beat
  - selecting a non-canonical option still uses the normal generated branch flow
- Updated landing/create UX so users can switch between `Prompt Story` and `Seed From Story`, preview seed beats, lightly edit beat titles/text/summary, regenerate the preview, and then confirm story creation.
- Removed separate prelude rendering from the seeded published/player flow while preserving a safe legacy prelude fallback for old stories that do not have a seed plan.
- Added admin controls for:
  - shared authoring word cap via `feature_flags.story_authoring_word_cap`
  - preview pricing via `pricing_action_costs.preview_seed_plan`
- Added beat persistence fields to normalized beats rows and round-tripped them through save/load/explore fallbacks.

## Migration Notes
- `024_script_seeded_story_mode.sql`
  - adds `beats.origin_kind`
  - adds `beats.seed_plan_beat_index`
  - adds `beats.canonical_option_id`
  - seeds `feature_flags.story_authoring_word_cap` with default value `500`
  - seeds `pricing_action_costs.preview_seed_plan` with default beat cost `0`
- `024_script_seeded_story_mode_rollback.sql`
  - removes the new beat columns
  - removes the authoring word-cap flag
  - removes the seed-preview pricing row

## Prompt / Model Notes
- `seed_plan_generation`
  - Purpose: convert source text into an exact-beat-count canonical preview plan
  - Input: language, story config, working title, fidelity, guidance, source text, beat count
  - Output shape: `{ beatCount, beats[] }` with exactly three options per non-ending beat and one canonical option
  - Fallback behavior: runtime normalizes/validates the plan and rejects invalid beat counts
- `seeded_beat_materialization`
  - Purpose: turn one confirmed seed beat into a full runtime `StoryBeat`
  - Input: language, story config, story state, source text, guidance, seed beat outline
  - Output shape: normal `StoryBeat` JSON
  - Fallback behavior: runtime preserves the authored title/story/options after parsing and retries once on validation failure

## Open Questions / Risks
- Existing stories created with the old prelude mode need compatibility handling while the new seeded mode replaces it.
- Publishing compatibility depends on canonical beats continuing to use standard `selected_option_id` links.
- Preview editing is intentionally light in v1, so structural beat edits remain future scope.
- Preview pricing is free by default, but admin-configurable paid previews need to stay aligned with beat-based wallet enforcement.
- Full repo lint is still blocked by unrelated pre-existing purity/set-state lint errors outside this feature area.

## Changed Files
- `lib/types/story.ts`
- `lib/ai/story-config.ts`
- `lib/types/pricing.ts`
- `lib/ai/model-config.shared.ts`
- `lib/ai/generation-schemas.ts`
- `lib/ai/prompt-config.shared.ts`
- `lib/store/story-store.ts`
- `lib/types/database.ts`
- `app/actions/story-runtime.ts`
- `app/actions/gemini-proxy.ts`
- `app/actions/admin.ts`
- `app/actions/persistence.ts`
- `app/actions/exploration.ts`
- `app/actions/prompt-playground.ts`
- `app/actions/pricing-runtime.ts`
- `app/storyline/[id]/page.tsx`
- `components/story/LandingScreen.tsx`
- `components/story/AdvancedOptions.tsx`
- `components/story/StoryScreen.tsx`
- `components/story/StorylinePlayer.tsx`
- `components/admin/GlobalSettings.tsx`
- `components/admin/PlaygroundStudio.tsx`
- `components/pricing/PricingRuntimeProvider.tsx`
- `supabase/migrations/024_script_seeded_story_mode.sql`
- `supabase/migrations/024_script_seeded_story_mode_rollback.sql`

## Verification
- `npx tsc --noEmit` passes.
- Targeted ESLint on touched feature files passes.
- `npm run lint` still fails because of unrelated pre-existing issues in:
  - `app/signed-out/page.tsx`
  - `components/story/NarrationButton.tsx`
  - `components/story/PromptCarousel.tsx`
  - `lib/hooks/useAudioPlayer.ts`
