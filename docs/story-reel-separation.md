# Story and Reel Runtime Boundaries

## Purpose

Stories and reels share persisted beats, media storage, narration transport, and account controls. They do not share visual timing rules or playback/export orchestration.

The separation rule is:

- Standard stories use valid per-beat narration timing when present, otherwise equal-quarter timing when narration duration exists.
- Reels use reel caption, word, panel, and provider timing from the reel timeline.
- Changes to either timing engine must not alter the other engine.

## Current Boundaries

### Story-owned

- `components/story/StoryStoryboardPlayer.tsx`: standard-story storyboard rendering and panel selection.
- `lib/storyboard/timing.ts`: legacy equal-quarter calculations and WAV duration parsing.
- `lib/storyboard/narration-timing.ts`: custom narration timing validation, boundaries, and timestamp parsing.
- `components/story/StoryNarrationTimingDialog.tsx`: creator editing and preview of per-beat story narration timing.
- `lib/storyboard/export-timeline.ts`: story-only export scenes and sparse frame samples.
- `lib/storyboard/export-renderer.ts`: story-only frame rendering.
- `lib/hooks/useStoryVideoExport.ts`: MediaBunny-first story export orchestration.
- `lib/storyboard/audio-duration.ts`: legacy story audio duration probing.
- `components/story/StorylinePlayer.tsx`: published standard-story playback.
- `lib/hooks/useVideoExport.ts`: FFmpeg compatibility fallback for standard-story export.

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
- `lib/video-export/mediabunny.ts`: neutral codec probing, AAC registration, MP4 preflight/cancellation, font readiness, and download helpers.
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
5. Completed: storylines use `useStoryVideoExport`; `useVideoExport` remains the isolated FFmpeg compatibility engine.
6. Completed: ESLint import restrictions prevent story and reel export timing/rendering modules from importing one another.

## Required Regression Checks

- Standard stories use saved per-beat boundaries in editor, published playback, and export; stories without saved timing switch at 25%, 50%, and 75% of narration duration.
- Standard-story pause/resume follows the real audio clock without timer drift.
- Global manual cycling affects only no-audio or duration-unavailable standard storyboards.
- Reel preview and export continue using caption/panel/word timeline metadata.
- Provider-aware reel highlighting and narration metadata remain unchanged.
