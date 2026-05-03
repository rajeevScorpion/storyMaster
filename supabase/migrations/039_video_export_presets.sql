-- 039_video_export_presets.sql
-- Backfill per-plan video export branding defaults without adding schema.

UPDATE public.pricing_plans
SET feature_flags_json = jsonb_set(
  COALESCE(feature_flags_json, '{}'::jsonb),
  '{videoExportPreset}',
  '{"verticalResolution":"720x1280","watermarkMode":"auto","watermarkPosition":"top-left","watermarkSize":"medium"}'::jsonb
    || COALESCE(feature_flags_json->'videoExportPreset', '{}'::jsonb),
  true
)
WHERE feature_flags_json IS NULL
   OR feature_flags_json->'videoExportPreset' IS NULL
   OR jsonb_typeof(feature_flags_json->'videoExportPreset') <> 'object';
