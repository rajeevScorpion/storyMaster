# Story and Reel Runtime Boundaries

## Purpose

Stories and reels share persisted beats, media storage, narration transport, and account controls. They do not share visual timing rules or playback/export orchestration.

The separation rule is:

- Standard stories use equal-quarter storyboard timing when narration exists and manual timing is disabled.
- Reels use reel caption, word, panel, and provider timing from the reel timeline.
- Changes to either timing engine must not alter the other engine.

## Current Boundaries

### Story-owned

- `components/story/StoryStoryboardPlayer.tsx`: standard-story storyboard rendering and panel selection.
- `lib/storyboard/timing.ts`: equal-quarter panel calculations and WAV duration parsing.
- `lib/storyboard/audio-duration.ts`: legacy story audio duration probing.
- `components/story/StorylinePlayer.tsx`: published standard-story playback.
- The storyline branch of `lib/hooks/useVideoExport.ts`: standard-story export timing.

### Reel-owned

- `components/story/ReelCanvasPreview.tsx`: reel canvas preview.
- `lib/reel/timeline.ts`: reel panel, caption, word, and transition timeline.
- `lib/reel/renderer.ts`: reel frame rendering.
- `lib/reel/captions.ts`: reel panel text distribution and preservation of user-edited panel boundaries.
- `lib/hooks/useReelVideoExport.ts`: reel export orchestration.
- Reel narration actions and metadata under `app/actions/narration.ts`, `app/actions/reel-narration.ts`, and `lib/reel/narration.ts`.

Reel text edits invalidate narration for that beat. Saving edited panel text must preserve the four submitted panel boundaries, clear the beat's active narration metadata, and delete saved voice previews tied to that beat before new narration can be applied or exported.

### Shared infrastructure

- `lib/hooks/useAudioPlayer.ts`: audio playback clock only; it must not choose panels.
- `lib/media/client.ts` and R2 APIs: media URL resolution and byte transport.
- `components/story/ReelCaptionOverlay.tsx`: presentational caption drawing only; its reel-specific name should be neutralized during screen extraction.
- Story/beat persistence and common media fields.
- Authentication, pricing, publishing, and storage configuration.

Shared infrastructure may expose neutral data and clocks. It must not contain story or reel timing policy.

## Migration Plan

1. Completed: consolidate standard-story storyboard timing in `StoryStoryboardPlayer` and keep reel timeline behavior unchanged.
2. Extract the non-reel editor body from `StoryScreen.tsx` into `StandardStoryScreen.tsx`, including story navigation, narration controls, story text, and standard-story media actions.
3. Extract the reel editor body into `ReelScreen.tsx`, including reel previews, voice presets, apply/generate/export readiness, overlay controls, and reel timeline playback.
4. Reduce `StoryScreen.tsx` to session loading plus an explicit mode dispatch between `StandardStoryScreen` and `ReelScreen`.
5. Split `useVideoExport.ts` into a standard-story exporter and neutral FFmpeg utilities. Reels continue through `useReelVideoExport.ts`.
6. Add boundary tests that verify story files do not import reel timeline/render/export modules and reel files do not import the standard-story storyboard player.

## Required Regression Checks

- Legacy and new standard stories switch panels at 25%, 50%, and 75% of narration duration in editor, published player, and export.
- Standard-story pause/resume follows the real audio clock without timer drift.
- Manual storyboard timing affects standard stories only.
- Reel preview and export continue using caption/panel/word timeline metadata.
- Provider-aware reel highlighting and narration metadata remain unchanged.
