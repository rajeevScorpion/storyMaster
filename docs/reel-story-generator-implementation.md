# Reel Story Generator Implementation

## Codebase Findings

- Kissago already models creation as a `StoryConfig` plus a beat graph. The main entry points are `components/story/LandingScreen.tsx`, `lib/store/story-store.ts`, `app/actions/story-runtime.ts`, and `app/actions/persistence.ts`.
- Storyboard generation is currently fixed to a 2x2, four-panel grid. The panel count is assumed by `lib/storyboard/layout.ts`, `StoryScreen`, `StorylinePlayer`, thumbnails, prompts, schemas, and browser video export.
- Existing vertical stories already use `isVerticalStory` and `aspectRatio: "9:16"`, and `useVideoExport` can export portrait storyboard panels.
- Prompt and model administration is task-key based. Existing prompt playground data is stored in `prompt_configs`, `prompt_drafts`, `prompt_history`, and `prompt_test_runs`.
- Admin global settings already use `feature_flags.enabled` and `feature_flags.value`, so Reel settings can reuse that pattern without creating a separate style-definer table.
- Pricing is action-key based. Adding reel-specific generation actions is the cleanest way to meter Reel starts and continues while reusing existing export pricing.
- R2/Supabase media metadata is indexed through `media_assets`, which is enough for a scoped draft cleanup flow. Public storyline assets must remain out of cleanup v1.
- Public publishing is currently the default for storylines. Reel v1 will not add private published reels.

## Decisions

- Reel Story is a short-form story kind layered on the current engine.
- Reel length maps to beat caps: Short = 1, Medium = 2, Long = 3.
- Reel v1 is prompt-only authoring, generated images only, always 9:16.
- Reel v1 keeps the four-panel 2x2 storyboard grid.
- Captions are player overlays only. They are not burned into exported MP4s.
- Cleanup v1 is admin-triggered, active deletion, and limited to expired unpublished reel drafts.

## Implementation Notes

- `storyKind` is persisted inside `story_config` and, after manual migration, indexed in `stories.story_kind` and `storylines.story_kind`.
- The code must tolerate the manual migration not being applied yet where possible. New DB columns are treated as additive.
- Reel prompt playground should reuse existing prompt config/draft/history/test-run behavior.
- Reel style definers and defaults are stored as JSON in the `reel_story_settings` feature flag value.
- Export remains the existing browser-side ffmpeg flow.

## QA Log

- Pending implementation.

