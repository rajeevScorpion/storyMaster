# Project Context

Product: Kissago / Kissago story video export.

Current known mechanism:

- Browser/client-side video export.
- Mediabunny is the video export/media writing library or part of the export mechanism.
- Likely uses WebCodecs or browser encoding under the hood.
- Export currently works quickly and even on mobile phones, but it demands available RAM for smoother operation.

Current visual system:

- Storyline player plays panel images and beat sequences.
- Existing creative effect settings are already available:
  - Pan and zoom over images.
  - Particle systems.
  - Dust.
  - Rain.
  - Snowfall.
  - Environmental / volumetric effects.
  - Panel-to-panel transitions.
  - Beat-to-beat transitions.
  - Text overlay synchronized to narration.
  - Word-by-word timestamp text playback.
- These existing effect settings should remain the source of truth.

Current problems:

1. Exported video is fast but visual motion looks glitchy/stuttery.
2. Pan/zoom and particle/environment effects are not smooth in exported video.
3. Sometimes the live storyline player also shows pan/zoom stutter, even though it used to work better earlier. This may indicate a regression.
4. Downloaded video does not play reliably in native media players or VLC.
5. Direct YouTube upload says file format is not supported.
6. Video plays after being uploaded/sent through WhatsApp, likely because WhatsApp transcodes or rewrites the media file.

Product direction:

- Do not add duplicate creative effect settings in admin.
- Admin settings should control only export engine settings: resolution, FPS, bitrate, codec/container safety, compatibility mode, preset availability, tier mapping, etc.
- Export dialog should show SD and HD options.
- SD/HD options should be tiered and configurable by admin.
- SD and HD should both be smooth. HD should mainly increase resolution/bitrate, not be the only smooth version.

Phase plan:

- Phase 1: Smooth export + compatibility.
- Phase 2: Admin settings + export dialog tiering.
