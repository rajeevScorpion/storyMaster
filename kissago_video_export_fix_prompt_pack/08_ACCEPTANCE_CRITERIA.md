# Acceptance Criteria

## Phase 1 acceptance

### Smoothness

- SD export at 720x1280, 30 fps shows smooth pan/zoom.
- HD export at 1080x1920, 30 fps shows smooth pan/zoom.
- Particle/environment effects do not flicker or jump.
- Panel transitions and beat transitions feel smooth.
- Word-by-word text overlay remains synchronized with narration.
- Export time remains close enough to current baseline to be acceptable.
- Mobile SD export remains usable.

### Compatibility

- Downloaded MP4 opens directly in native media player.
- Downloaded MP4 opens directly in VLC.
- YouTube accepts the direct upload and starts processing.
- Instagram/mobile upload path works if testable.
- ffmpeg decode test shows no major timestamp/container errors.
- Audio plays correctly.
- File has correct `.mp4` extension and MIME type.

### Diagnostics

- Export report shows FPS, frames, duration, codec, bitrate, fastStart/fragmented status, and export time.
- Timestamp generator has tests or logged validation for monotonic timestamps.

## Phase 2 acceptance

### Admin settings

- Admin can configure SD and HD export presets.
- Admin can enable/disable presets.
- Admin can map presets to tiers.
- Admin can configure FPS/resolution/bitrate/audio/compatibility settings within safe limits.
- Defaults exist if admin settings fail.
- Existing creative effect controls are not duplicated.

### Export dialog

- Export dialog shows SD and HD options.
- Locked options reflect tier rules.
- Selected preset is used in actual export.
- User sees clear description and, if applicable, coin/credit cost.
- Admin changes reflect in the export dialog without code changes.

## Non-regression criteria

- Existing storyline player still works.
- Existing effects settings still work.
- Narration sync is not broken.
- Text overlay is not broken.
- Existing saved stories do not break.
- Existing export path does not disappear without fallback.
- No app-wide performance regression.
