-- 118_rename_agentic_pipeline_image_flag_rollback.sql
--
-- Restores the old flag_key name.

UPDATE public.feature_flags
SET flag_key = 'agentic_image_generation_enabled'
WHERE flag_key = 'agentic_pipeline_image_generation_enabled';

INSERT INTO public.feature_flags (flag_key, enabled)
VALUES ('agentic_image_generation_enabled', false)
ON CONFLICT (flag_key) DO NOTHING;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 118;
