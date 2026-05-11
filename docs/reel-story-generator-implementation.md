# Reel Story Generator Implementation

## Codebase Findings

- User story creation starts in `components/story/LandingScreen.tsx`, hands off through `app/page.tsx`, and runs through `lib/store/story-store.ts`.
- Story generation, visual prompt composition, and storyboard planning are centralized in `app/actions/story-runtime.ts`; model and prompt task definitions live in `lib/ai/model-config.shared.ts` and `lib/ai/prompt-config.shared.ts`.
- Story sessions persist through `app/actions/persistence.ts`, with normalized beats in `beats` and JSON fallback in `stories.story_map`. Public playback loads through `app/actions/exploration.ts`, `components/story/StorylinePlayer.tsx`, and `app/storyline/[id]/page.tsx`.
- The existing 2x2 storyboard grid is shared by the player, thumbnails, prompts, schemas, and browser export code, so Reel v1 keeps four panels per beat.
- Vertical stories already use `isVerticalStory` and `aspectRatio: "9:16"`. Existing browser-side ffmpeg export in `lib/hooks/useVideoExport.ts` can export portrait storylines without adding a renderer.
- Admin settings use `feature_flags.enabled` and `feature_flags.value`; prompt playground persistence already uses prompt config, draft, history, and test-run tables.
- Pricing and credit enforcement are action-key based, so Reel starts and continues can use separate action keys while video export keeps existing export pricing.
- Cloud media is indexed by `media_assets`, with R2 helpers in `lib/media/r2-server.ts` and Supabase storage fallbacks available through the admin client.

## Implementation Summary

- Added `storyKind: "story" | "reel"` and `reel` config metadata to story types and normalization.
- Added Reel creation as a third landing mode beside Prompt Story and Seed Story.
- Reels force prompt authoring, generated images, 9:16 orientation, and a beat cap from length: Short 1, Medium 2, Long 3.
- Added reel-specific prompt/model tasks: `reel_story_generation`, `reel_visual_prompt`, and `reel_tts`.
- Added reel pricing action keys: `start_reel_initial_beat` and `continue_reel_new_beat`.
- Added per-panel caption metadata on beats and player overlays in `StoryScreen` and `StorylinePlayer`.
- Added `/admin/reel-playground` using the existing playground infrastructure.
- Added `/admin/settings/reels` for enablement, editable settings JSON, retention values, and manual cleanup.
- Merged latest `origin/main` landing navigation changes into the reel branch and preserved the Reel Story selector.

## Admin Configuration

- Reel enablement is stored in `feature_flags.flag_key = 'reel_story_enabled'`.
- Reel defaults and prompt definers are stored as JSON in `feature_flags.flag_key = 'reel_story_settings'`.
- The settings JSON includes default length, mood, visual style, narration style, fixed panel count, plan retention days, and editable mood/visual/narration definer arrays.
- Built-in default length is Medium. Panel count is normalized to 4 for v1.
- The settings overview links to the Reel Story settings page, and the admin sidebar exposes both Reel Playground and Reels settings.

## Data Model and Migrations

- Manual migration files:
  - `supabase/migrations/046_reel_story_generator.sql` for the base Reel Story schema/settings seed.
  - `supabase/migrations/047_reel_story_generator_post_apply_patch.sql` for environments where an earlier `046` was already applied before the default/backfill/policy corrections.
- The migration adds indexed `story_kind` fields on `stories` and `storylines`, reel retention/cleanup fields on `stories`, `beats.reel_captions`, and `reel_cleanup_runs`.
- It seeds the reel feature flags, model config rows, and pricing action cost rows. Reel action costs copy the current generated story start/continue costs when available, then admins can tune them later.
- It was not applied automatically. Apply manually through the project Supabase migration process, then refresh generated DB types if this repo later adopts generated Supabase types.
- Rollback files:
  - `supabase/migrations/046_reel_story_generator_rollback.sql` removes the base Reel Story schema/settings seed.
  - `supabase/migrations/047_reel_story_generator_post_apply_patch_rollback.sql` restores the earlier post-046 behavior without dropping the base schema.

## User Flow

- Users choose Reel Story on the landing screen when the feature flag is enabled.
- The reel UI exposes only prompt, length, mood, visual style, and narration style. Seeded authoring, prompt-only uploads, aspect-ratio toggles, and internal storyboard controls are hidden for reels.
- Reels build a config with prompt authoring, generated images, vertical 9:16 playback, and reel-specific metadata.
- Continue is blocked at the configured beat cap, and final beats are forced to ending beats.
- Published reel storylines continue through the existing public publish path and carry `story_kind = 'reel'` after migration.

## Storage Lifecycle

- Cleanup is admin-only and manual through `/admin/settings/reels`.
- Dry-run reports expired unpublished reel drafts and their private linked media.
- Execute deletes private linked media through `media_assets`, using R2 deletion for R2 rows and Supabase storage removal for Supabase rows, then deletes the draft story row.
- Stories with public storylines are excluded. Stories with public media asset metadata are skipped during execute.
- Cleanup writes an audit row to `reel_cleanup_runs` with counts, object keys, errors, actor, and mode. If the manual migration is missing, cleanup returns a friendly failure and does not delete anything.

## Export Support

- Reel export reuses the existing browser-side ffmpeg flow and existing video download pricing/watermark enforcement.
- Exported MP4s are not persisted in v1.
- Reel captions are player overlays only and are not burned into exported MP4s in v1.

## Testing Notes

- `npm run lint` passed.
- `npm run build` passed.
- The first build attempt was blocked by a locked `.next/trace` from existing project-local Next processes. Those project-local Node processes were stopped, then the build completed successfully.
- Manual browser QA is still needed for live generation because it depends on Supabase, Gemini, storage, and plan state in the target environment.

## Known Limitations and Next Steps

- V1 does not support seeded reels or uploaded prompt-only reel images.
- V1 keeps four storyboard panels per beat.
- Caption timing is approximate by active panel, not true word-level subtitle timing.
- Cleanup is manual only; no scheduler was added.
- Private published reels and persisted exported MP4s are intentionally out of scope for v1.
