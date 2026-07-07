-- 070_media_pipeline_flags_rollback.sql
-- Remove media pipeline rollout flags. Safe: consumers treat missing flags as
-- client_legacy defaults.

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'media_processing_mode',
  'media_canary_user_ids',
  'media_pipeline_settings'
);
