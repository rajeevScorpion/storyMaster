-- 076_video_export_engine_presets.sql
-- Video export engine presets (Phase 2 of the video export fix).
--
-- Seeds the `video_export_presets_json` feature flag whose value holds the
-- admin-configurable export preset list (resolution / fps / bitrate / tier
-- mapping) consumed by the SD/HD export dialog. The application falls back to
-- the same defaults in code when this flag is absent or invalid, so this seed
-- is a convenience for the admin editor, not a hard requirement.
--
-- Creative effect settings (pan/zoom, particles, transitions) are NOT part of
-- these presets; they stay in the story effects system.

INSERT INTO public.feature_flags (flag_key, enabled, value) VALUES
  (
    'video_export_presets_json',
    true,
    '[{"id":"sd","label":"Standard","description":"Fast, mobile-friendly export","width":720,"height":1280,"fps":30,"videoBitrate":4000000,"audioBitrate":128000,"audioSampleRate":48000,"enabled":true,"allowedTiers":["free","plus","studio"],"adminOnly":false,"isExperimental":false,"sortOrder":10,"upgradePromptText":""},{"id":"hd","label":"HD","description":"Sharper export for sharing and publishing","width":1080,"height":1920,"fps":30,"videoBitrate":10000000,"audioBitrate":192000,"audioSampleRate":48000,"enabled":true,"allowedTiers":["plus","studio"],"adminOnly":false,"isExperimental":false,"sortOrder":20,"upgradePromptText":"HD export is available on Plus and above"},{"id":"ultra-smooth","label":"Ultra Smooth","description":"Experimental 60 fps export for capable devices","width":1080,"height":1920,"fps":60,"videoBitrate":14000000,"audioBitrate":192000,"audioSampleRate":48000,"enabled":false,"allowedTiers":["studio"],"adminOnly":true,"isExperimental":true,"sortOrder":30,"upgradePromptText":""}]'
  )
ON CONFLICT (flag_key) DO NOTHING;
