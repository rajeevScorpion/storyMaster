-- 120_text_model_thinking.sql
--
-- Per-task thinking level, per-model thinking levels, Gemini 3.8 Flash, and removal of every Gemini text model
-- older than 3.5 Flash. Gemini rows stop accepting a task temperature: the gateway always sends 1.0.
--
-- Trap: tasks and persona overrides on a removed key move to gemini-3.8-flash BEFORE the rows are deleted.
-- Deleting first leaves them on a key the registry no longer knows, which silently runs the task's code default.
-- model_config also holds image and TTS ids; the removed list must only ever name text models.
--
-- Verify: select task_key, model_id, reasoning_level from public.model_config order by task_key;

ALTER TABLE public.model_config ADD COLUMN IF NOT EXISTS reasoning_level TEXT NULL;

ALTER TABLE public.model_config DROP CONSTRAINT IF EXISTS model_config_reasoning_level_values;
ALTER TABLE public.model_config ADD CONSTRAINT model_config_reasoning_level_values
  CHECK (reasoning_level IS NULL OR reasoning_level IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'));

INSERT INTO public.text_model_registry (
  model_key, provider_key, provider_model_id, display_name, description, is_enabled,
  capabilities, default_params, timeout_ms,
  input_cost_per_mtok_usd, output_cost_per_mtok_usd, cached_input_cost_per_mtok_usd,
  required_env_vars, sort_order
) VALUES
  ('gemini-3.8-flash', 'gemini', 'gemini-3.8-flash', 'Gemini 3.8 Flash', 'Thinks at medium by default; lowest setting is low.', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":false,"reasoningLevels":["low","medium","high"]}', '{}', NULL,
   NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 5)
ON CONFLICT (model_key) DO NOTHING;

UPDATE public.text_model_registry
SET capabilities = capabilities || '{"temperature":false,"reasoningLevels":["minimal","low","medium","high"]}'::JSONB
WHERE model_key = 'gemini-3.5-flash';

UPDATE public.text_model_registry
SET capabilities = capabilities || '{"reasoningLevels":["none","low","medium","high","xhigh","max"]}'::JSONB
WHERE model_key IN ('openai:gpt-5.6-luna', 'openrouter:openai/gpt-5.6-luna');

UPDATE public.text_model_registry
SET capabilities = capabilities || '{"reasoningLevels":["none","low","medium","high"]}'::JSONB
WHERE model_key IN ('openrouter:qwen/qwen3.7-flash', 'openrouter:deepseek/deepseek-v4-flash-0731');

INSERT INTO public.model_config_history (task_key, old_model_id, old_temperature, new_model_id, new_temperature, change_reason)
SELECT task_key, model_id, temperature, 'gemini-3.8-flash', temperature, '120: Gemini text model removed'
FROM public.model_config
WHERE model_id IN ('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
                   'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite');

UPDATE public.model_config
SET model_id = 'gemini-3.8-flash',
    reasoning_level = CASE
      WHEN task_key IN ('graphic_style_extraction', 'voice_selection', 'agent_novelty_assessment') THEN 'low'
      ELSE NULL
    END,
    updated_at = NOW()
WHERE model_id IN ('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
                   'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite');

INSERT INTO public.model_config (task_key, model_id, temperature, reasoning_level)
VALUES
  ('graphic_style_extraction', 'gemini-3.8-flash', 0.4, 'low'),
  ('agent_novelty_assessment', 'gemini-3.8-flash', 0.2, 'low')
ON CONFLICT (task_key) DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.agent_personas') IS NOT NULL THEN
    UPDATE public.agent_personas AS persona
    SET model_overrides = (
      SELECT jsonb_object_agg(
        entry.key,
        CASE
          WHEN entry.value->>'modelId' IN ('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
                                           'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite')
          THEN jsonb_set(entry.value, '{modelId}', '"gemini-3.8-flash"')
          ELSE entry.value
        END
      )
      FROM jsonb_each(persona.model_overrides) AS entry
    )
    WHERE CASE
      WHEN jsonb_typeof(persona.model_overrides) = 'object' THEN EXISTS (
        SELECT 1 FROM jsonb_each(persona.model_overrides) AS entry
        WHERE entry.value->>'modelId' IN ('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
                                          'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite')
      )
      ELSE FALSE
    END;
  END IF;
END $$;

DELETE FROM public.text_model_registry
WHERE model_key IN ('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
                    'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite');

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (120, '120_text_model_thinking.sql')
ON CONFLICT (migration_number) DO NOTHING;
