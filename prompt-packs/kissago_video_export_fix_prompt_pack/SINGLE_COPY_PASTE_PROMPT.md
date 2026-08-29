# Single Copy-Paste Prompt for AI Coder

You are working on Kissago/Kissago video export. The app currently uses a browser-side export mechanism, likely Mediabunny/WebCodecs, to export story videos. Export is fast and works on mobile, but there are issues:

1. Pan/zoom, particle/environment effects, panel transitions, beat transitions, and word-by-word text overlay look glitchy/stuttery in exported video.
2. Sometimes pan/zoom also stutters in the live storyline player, though it used to be smoother earlier.
3. Downloaded MP4 files do not reliably play in native media players or VLC.
4. YouTube rejects direct upload as unsupported format.
5. The file may play after being sent through WhatsApp, likely because WhatsApp transcodes or repairs it.

Important context:

- Creative effects already have separate settings in the app: pan/zoom, particles, dust, rain, snowfall, environmental effects, transitions, text overlay, and narration sync.
- Do NOT duplicate creative effect controls in admin.
- Admin settings should only control export engine settings: resolution, FPS, bitrate, codec/container compatibility, fastStart, fragmented MP4, tier mapping, preset availability, etc.
- SD and HD should both be smooth. HD should improve resolution/bitrate, not be the only smooth option.
- Phase 1 is smooth export + compatibility with minimal export-time impact.
- Phase 2 is admin settings + tiered SD/HD export dialog.

Rules:

- Do not assume current implementation. Inspect code first.
- Preserve working storyline playback, effects, narration sync, text overlay, transitions, and export UX.
- Be practical. Implement minimal measurable Phase 1 improvements before major rewrites.
- Work in separate commits/phases.
- Ask clarifying questions only after inspection if blocked.

Phase 1A: Investigate and add diagnostics.

Find current Mediabunny/WebCodecs/canvas export code. Add a debug export report showing: preset, resolution, FPS, frame count, expected/exported duration, timestamp step, duplicate/non-monotonic timestamps, codec strings, bitrates, audio sample rate, MP4 fastStart, fragmented MP4 yes/no, file size, export time, browser/device. Generate a current sample and inspect with ffprobe/MediaInfo if possible.

Phase 1B: Smoothness fix.

First test current FPS, 24 fps, 30 fps, and 60 fps experimental using the same story. Default target should be SD 720x1280 30 fps and HD 1080x1920 30 fps. Keep 60 fps experimental/admin-only until tested. Export should generate deterministic constant-frame timestamps: frameIndex/fps converted to microseconds. Avoid relying on requestAnimationFrame timing during export. Avoid duplicate timestamps. Avoid buffering all frames. Close VideoFrame objects after encoding. Cache images. Do not flush encoder per frame. If live player stutter is found, check pan/zoom transforms, text overlay re-renders, particle main-thread load, and large image scaling.

Phase 1C: MP4 compatibility fix.

Final downloadable MP4 should target: MP4 container, H.264/AVC video, AAC-LC audio, 48 kHz audio, constant frame rate, progressive video, fastStart/moov atom at front, non-fragmented MP4 for final downloads unless proven compatible, clean monotonic timestamps, no edit lists if configurable. Use codec support detection and fallback profiles. Validate in native player, VLC, YouTube upload, Chrome desktop, Chrome Android, and mobile browser. Do not treat WhatsApp success as sufficient proof because it may transcode.

Phase 2: Admin settings.

Create Admin > Video Export Settings using the existing admin/config architecture. Admin can configure SD/HD presets: enabled, allowed tiers, width, height, FPS, video bitrate, audio bitrate, sample rate, codec preferences, hardware acceleration preference, latency mode, fastStart, fragmented MP4, compatibility mode, experimental/admin-only, sort order, label, description, upgrade prompt. Add safe defaults and validation. Do not duplicate creative effect controls.

Export dialog:

Show SD and HD options. Availability must come from admin tier settings. Locked options should show upgrade prompt if that matches current product UX. Validate selected preset against tier access. If exports consume coins/credits, show cost before export. If device/browser cannot support selected HD preset, fall back gracefully to SD or safer compatibility mode.

Acceptance:

- SD 720x1280 30 fps is smooth and mobile-friendly.
- HD 1080x1920 30 fps is smooth and sharper.
- Export time remains practical.
- MP4 opens in native player/VLC.
- YouTube accepts direct upload.
- Audio and word text remain synced.
- Admin can configure presets and tier access.
- Export dialog reflects admin settings.
- Existing story/effects controls are preserved.

Provide a final report with findings, files changed, test results, and remaining limitations.
