# Video Export Fix — Implementation Report

Implements `kissago_video_export_fix_prompt_pack/` (Phase 1: smoothness + MP4
compatibility, Phase 2: admin presets + tiered SD/HD dialog).
Branch: `feature/video-export-fix` (2026-07-11).

## Summary

- **Implemented Phase:** 1 and 2.
- **Main issue found (smoothness):** exports did not stutter because of low
  FPS — they stuttered because the frame samplers only emitted frames at
  *event boundaries*. `buildStoryExportFrameSamples` and
  `buildReelFrameSamples` sampled densely (at fps) only inside transition
  windows; ordinary scene playback got sample points only at scene edges and
  word timings. Continuous pan/zoom, particles, and atmosphere were encoded
  as long-held frames (hundreds of ms each), i.e. genuinely undersampled.
- **Main issue found (compatibility):**
  `output.addVideoTrack(source, { frameRate })` makes Mediabunny use
  **fps ticks/second as the MP4 track timescale**
  (`node_modules/mediabunny/.../isobmff-muxer.js`, timescale =
  denominator of 1/frameRate). Every sample timestamp is
  `Math.round(seconds × fps)`. The old irregular event timestamps (word edges
  at arbitrary milliseconds) collapsed into **duplicate / zero-duration
  ticks** — invalid track timing that native players/VLC choke on and YouTube
  rejects. WhatsApp "fixed" the file because its upload pipeline transcodes.
- **Main fix:** deterministic constant-frame-rate sampling at 30 fps whose
  timestamps land exactly on the declared timescale grid, plus explicit
  `fastStart: 'in-memory'` (moov at front) and `-movflags +faststart` on the
  ffmpeg fallbacks.

## Investigation findings

- **FPS before fix:** 24 declared (`STORY_EXPORT_FPS` / `REEL_FPS`), but only
  applied inside transition windows; effective scene sampling was often
  < 5 fps.
- **Timestamp mechanism before fix:** deduplicated sorted event points
  (scene edges + word timings + transition sub-sampling), variable frame
  durations, seconds passed to `CanvasSource.add()`.
- **Codec/container before fix:** H.264 (`'avc'`) + AAC 48 kHz stereo in MP4
  via Mediabunny `BufferTarget`; `Mp4OutputFormat()` constructed with no
  options; `QUALITY_HIGH` bitrate; `keyFrameInterval: 2`;
  `latencyMode: 'quality'`; no `hardwareAcceleration` override.
- **MP4 issue found:** VFR event timestamps quantized into an fps-ticks
  timescale → duplicate/zero-duration samples (see above). Fast-start was
  incidentally already active (Mediabunny defaults to `'in-memory'` for
  `BufferTarget`), now explicit. The ffmpeg fallbacks wrote moov at the end;
  they now pass `-movflags +faststart`.
- **Live player stutter causes found:**
  1. The narration clock (`useAudioPlayer`) commits React state in ≥50 ms
     steps, and the pan/zoom transform only updates on re-render → visible
     stair-stepping (worse because the transform was a 2-D `translate()` with
     no interpolation).
  2. `StoryEffectsLayer` called `canvas.getBoundingClientRect()` inside every
     `requestAnimationFrame` (forced layout per frame).
  3. The fullscreen `blur-2xl` backdrop animates `scale` perpetually (20 s
     loop), repainting an expensive blurred layer.

## Changes made

- **Smoothness (export):**
  - `lib/video-export/frame-sampling.ts` — new `buildConstantRateFrameSamples`
    (frame k at exactly `k/fps`, last duration clamped).
  - `lib/storyboard/export-timeline.ts` / `lib/reel/timeline.ts` — fast-path
    samplers now delegate to the constant grid; the event-based reel sampler
    survives as `buildReelCompatibilityFrameSamples` for the ffmpeg fallback
    (bounds wasm memory: one JPEG per sample).
  - FPS raised 24 → 30 on both fast paths (preset-driven since Phase 2).
  - Render-key guard in both hooks (`getStoryFrameRenderKey`,
    `getReelFrameRenderKey`) skips canvas redraws for provably static frames
    (same scene, no effects/motion, no transition, same highlighted word) so
    the CFR grid doesn't balloon export time; the encoder still receives a
    frame per grid slot.
- **Compatibility:** explicit `fastStart: 'in-memory'` on all three
  Mediabunny outputs; `-movflags +faststart` on the story compat concat mux
  and the reel ffmpeg fallback; CFR timestamps now match the declared track
  frame rate. `hardwareAcceleration` left at library default per Mediabunny's
  own guidance ("best left on `no-preference`").
- **Diagnostics:** `lib/video-export/diagnostics.ts` — per-export report
  (frame count vs expected, first/last timestamp, min/max frame duration,
  duplicate + non-monotonic counts, codec/bitrate/container/fastStart, output
  size, per-stage wall times, UA), logged via `console.info`
  (`[video-export:story|reel] export report`) outside production and exposed
  as `diagnostics` on both hooks.
- **Live player:** `translate3d` + `will-change` + 120 ms linear transform
  transition on the Ken Burns image (panel-keyed so the transition never
  animates across a cut); `ResizeObserver`-cached canvas bounds in
  `StoryEffectsLayer`; `will-change: transform` on the scaling blurred
  backdrop.
- **Admin settings (Phase 2):** `lib/video-export/presets.ts` — preset
  definitions with validation clamps (fps ∈ {24, 30, 60}, even H.264
  dimensions, bitrate bounds), stored as JSON in the
  `video_export_presets_json` feature-flag value; server actions in
  `app/actions/video-export.ts` (admin get/save/reset + public
  `getAvailableVideoExportPresets` that resolves the caller's plan
  server-side); editor card `components/admin/VideoExportPresetStudio.tsx`
  in Admin → Global Settings → Video Export; seed migration
  `supabase/migrations/076_video_export_engine_presets.sql` (+ rollback).
  Defaults: SD 720×1280@30/4 Mbps (all tiers), HD 1080×1920@30/10 Mbps
  (Plus + Studio), Ultra Smooth 60 fps (disabled, admin-only). Code-level
  defaults apply when the flag is missing/invalid. No creative-effect
  controls were added to admin.
- **Export dialog + tiering:** `components/story/VideoExportDialog.tsx`
  used by both the storyline player and the reel builder. Locked presets show
  a lock + upgrade prompt and never start an export; the server is the tier
  authority. Selected preset resolution/fps/bitrates thread through
  `exportEnginePreset` in `VideoExportOptions`; landscape storyline exports
  swap the portrait preset axes. Existing billing authorize/finalize flow and
  watermark rules unchanged.

## Test results

- `npm run test`: 37 files / 188 tests pass (18 new: constant-rate grid
  monotonicity/step/coverage, reel compatibility sampler, diagnostics
  summarizer, preset normalization + tier resolution).
- `npm run lint`: clean (one pre-existing warning in
  `AdvancedOptions.tsx`, untouched).
- `npx tsc --noEmit`: clean.
- SD/HD export, VLC/native/YouTube playback, and mobile runs require manual
  QA (browser exports cannot run headlessly here) — see below.

## Remaining concerns

- Browser AVC encoder support still gates the fast path; unsupported devices
  fall back to ffmpeg (story: simple transitions only, as before).
- 60 fps preset is intentionally disabled/admin-only until verified on
  mid-range mobile hardware.
- Export time will rise versus the (undersampled) baseline since far more
  real frames are encoded; the static-frame draw-skip keeps the canvas cost
  down, but encode cost is inherent to actually smooth output. Compare via
  the diagnostics report (`exportWallTimeMs`).
- The reel ffmpeg fallback still uses sparse event sampling (memory
  guardrail), so fallback output remains less smooth than the fast path.

## How to test manually

1. Run the dev server, open a story with pan/zoom + particles + narration
   word overlay.
2. Export via the new dialog: pick **Standard**; watch the dev console for
   `[video-export:story] export report` — expect `frameCountMatchesFps: true`,
   `duplicateTimestampCount: 0`, `nonMonotonicTimestampCount: 0`,
   `fastStart: 'in-memory'`.
3. Play the file in VLC and the OS native player; check smooth pan/zoom and
   stable particles.
4. Validate the container:
   ```bash
   ffprobe -hide_banner -show_format -show_streams kissago_sd.mp4
   ffmpeg -v error -i kissago_sd.mp4 -f null -
   ```
   Expect `h264` + `aac`, `r_frame_rate 30/1`, `yuv420p`, no decode or
   timestamp errors.
5. Upload to YouTube (unlisted) — it should accept and process.
6. On a Plus/Studio (or admin-bypass) account, repeat with **HD**.
7. In Admin → Global Settings → Video Export, disable HD or change its
   tiers/fps; reopen the export dialog and confirm the change is reflected
   and locked options only open the wallet page.
8. On a free-plan account confirm HD shows locked and cannot start an export.
9. Apply migration `076_video_export_engine_presets.sql` in the Supabase
   dashboard (optional — code defaults cover its absence).
