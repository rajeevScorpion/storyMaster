# Master Prompt for AI Coder

You are working on Kissago/Kissago video export. The current browser-based export uses Mediabunny/WebCodecs or a related browser encoding pipeline. The export is fast and works on mobile, but the downloaded video has two major problems:

1. Motion effects look glitchy/stuttery in exported video. This affects pan, zoom, particle/environment effects, and transitions.
2. Downloaded MP4 files do not reliably play in native media players/VLC and are rejected by YouTube as unsupported format. The same file may play after being sent via WhatsApp, likely because WhatsApp transcodes/repairs it.

Important existing product context:

- Creative effect controls already exist in the story/effects system.
- Do NOT duplicate pan intensity, zoom intensity, particle type, dust, rain, snowfall, or visual effect settings in admin.
- Runtime storyline player already renders effects, text overlay, narration sync, word-by-word timestamp text, panel transitions, and beat transitions.
- The current problem is mostly smoothness/encoding/export compatibility, not missing creative controls.
- Some stutter also appears occasionally in the live storyline player, so investigate both player timing/rendering and export timing/rendering.
- User wants Phase 1 focused on smooth output and media compatibility with minimal export-time impact.
- User wants Phase 2 focused on admin settings and tiered SD/HD options in the export dialog.

Your working rules:

1. Do not assume. First inspect the current implementation.
2. Do not break existing storyline playback, effects, narration sync, text overlay, transitions, or export flow.
3. Be practical. Prefer minimal, measurable Phase 1 improvements before proposing major rewrites.
4. Work in meaningful phases and commits.
5. Ask clarifying questions only after code inspection when there is a real ambiguity that blocks progress.
6. Add diagnostics so we can see actual current FPS, timestamps, codec/container settings, export duration, and compatibility details.
7. Keep export time reasonable. Smoothness must improve without making normal exports feel impractically slow.
8. Make SD and HD both smooth. HD should improve resolution/bitrate; SD should not be stuttery.
9. Final output should be a clean MP4 compatible with native players, VLC, YouTube, Instagram, and mobile browsers as far as browser encoding allows.

Deliverables:

- Phase 1 implementation: diagnostics, smoothness fix, MP4 compatibility fix, validation.
- Phase 2 implementation: admin-configurable export engine settings, tier-based SD/HD export dialog options.
- Short implementation report listing what was found, what changed, and how to test.
