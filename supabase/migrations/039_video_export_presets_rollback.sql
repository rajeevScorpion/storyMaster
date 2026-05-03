-- 039_video_export_presets_rollback.sql

UPDATE public.pricing_plans
SET feature_flags_json = COALESCE(feature_flags_json, '{}'::jsonb) - 'videoExportPreset'
WHERE COALESCE(feature_flags_json, '{}'::jsonb) ? 'videoExportPreset';
