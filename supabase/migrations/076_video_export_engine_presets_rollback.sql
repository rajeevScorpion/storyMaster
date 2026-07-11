-- 076_video_export_engine_presets_rollback.sql
-- Removes the video export engine preset flag. The application falls back to
-- its built-in default presets when this flag is absent.

DELETE FROM public.feature_flags WHERE flag_key = 'video_export_presets_json';
