# Phase 1A — Investigate and Diagnose Before Changing

Start by locating the current video export pipeline.

Search for:

- Mediabunny imports/usages.
- WebCodecs usages: `VideoEncoder`, `AudioEncoder`, `VideoFrame`, `EncodedVideoChunk`.
- Canvas capture/export logic.
- Export modal/dialog code.
- Timeline/storyline player code.
- Effects renderer code.
- Text overlay/narration timestamp code.
- Particle rendering code.
- Transitions code.
- Any hard-coded export settings.

Do not rewrite first. Add diagnostics first.

## Required export diagnostics

Create a development-only export report that logs and/or displays:

```txt
Export preset name
Requested width/height
Actual canvas width/height
Device pixel ratio handling
Requested FPS
Actual frame count
Expected duration
Exported duration
Frame timestamp step
First frame timestamp
Last frame timestamp
Duplicate timestamp count
Non-monotonic timestamp count
Dropped/skipped frame suspicion
Video codec string
Audio codec string
Video bitrate
Audio bitrate
Audio sample rate
Keyframe interval / GOP if configured
Container format
MP4 fastStart setting
Fragmented MP4 yes/no if detectable/configurable
Output file size
Export start/end time
Total export duration
Browser name/version
Device/platform
Approx memory warning if available
```

## Specific things to inspect

### FPS and timestamps

Check whether export is currently:

- 12 fps / 15 fps / 24 fps / 30 fps / unknown.
- Using constant frame timing.
- Using timestamps in seconds, milliseconds, or microseconds.
- Generating duplicate timestamps.
- Snapping frame timestamps incorrectly.
- Depending on `requestAnimationFrame` timing for export.
- Capturing live preview frames instead of rendering exact frame times.

### Export loop

Inspect whether export does this:

```txt
for frameIndex in totalFrames:
  t = frameIndex / fps
  render visual state at t
  encode frame with timestamp t
```

Or whether it relies on live playback timing. If it relies on live playback timing, document that clearly before changing.

### Live player stutter

Because the storyline player also stutters sometimes, inspect:

- Recent changes in pan/zoom animation code.
- Whether pan/zoom uses CSS transform or layout-affecting properties.
- Whether text overlay updates cause excessive React re-renders.
- Whether particles run on the main thread with too much work.
- Whether large source images are being resized every frame.
- Whether transitions force layout/repaint.
- Whether CSS `filter`, blur, shadows, or blend modes are causing heavy frame cost.

### Compatibility

Generate one current sample and inspect it with one or more:

```bash
ffprobe -hide_banner -show_format -show_streams sample.mp4
ffmpeg -v error -i sample.mp4 -f null -
mediainfo sample.mp4
```

Look for:

- Invalid MP4 container metadata.
- Missing or late `moov` atom.
- Fragmented MP4 when final downloadable MP4 should be regular MP4.
- Unsupported codec/profile.
- Audio track problems.
- Timestamp problems.
- Variable frame rate or duplicate frame timestamp problems.
- Non-monotonic DTS/PTS warnings.

## Output after this step

Before coding the fix, write a short diagnostic note:

```txt
Found current export settings:
- FPS:
- Resolution:
- Codec/container:
- Timestamp mechanism:
- FastStart/fragmented MP4:
- Suspected cause of smoothness problem:
- Suspected cause of compatibility problem:
- Minimal safe fix plan:
```
