-- 121_text_task_content_block_fallback_rollback.sql
-- Per-task content-block fallbacks are lost; the gateway stops retrying and reports the block.

ALTER TABLE public.model_config DROP COLUMN IF EXISTS content_block_fallback_model_id;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 121;
