-- 121_text_task_content_block_fallback.sql
--
-- Per-task model the text gateway retries on, once, when a provider refuses a call on content-safety grounds.
--
-- Trap: the app reads this column in its own query with its own missing-column latch. Adding it to the existing
-- model_config select that carries reasoning_level (120) would make a database without 121 look like one without
-- 120, and every task thinking level would silently stop applying.
-- Holds a text_model_registry.model_key as plain text, like model_id: a removed model leaves a dead fallback the
-- gateway skips with a warning.
--
-- Verify: select task_key, model_id, content_block_fallback_model_id from public.model_config order by task_key;

ALTER TABLE public.model_config ADD COLUMN IF NOT EXISTS content_block_fallback_model_id TEXT NULL;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (121, '121_text_task_content_block_fallback.sql')
ON CONFLICT (migration_number) DO NOTHING;
