-- 118_rename_agentic_pipeline_image_flag.sql
--
-- agentic_image_generation_enabled gates only the autonomous agent PIPELINE
-- generating images -- never a reviewer's interactive "Regenerate image...",
-- which has repeatedly been mistaken as a guard it isn't. Renaming the row so
-- its name says what it actually gates.
--
-- Migration order is not enforced here: this UPDATEs the row if 102 already
-- ran, or INSERTs it fresh (defaulting off) if 118 lands first.

UPDATE public.feature_flags
SET flag_key = 'agentic_pipeline_image_generation_enabled'
WHERE flag_key = 'agentic_image_generation_enabled';

INSERT INTO public.feature_flags (flag_key, enabled)
VALUES ('agentic_pipeline_image_generation_enabled', false)
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (118, '118_rename_agentic_pipeline_image_flag.sql')
ON CONFLICT (migration_number) DO NOTHING;
