-- 120_text_model_thinking_rollback.sql
--
-- Tasks and persona overrides on gemini-3.8-flash go back before its row is deleted: the three economy tasks to
-- their 119-era models, everything else to gemini-3.5-flash. Per-task thinking settings are lost.

INSERT INTO public.text_model_registry (
  model_key, provider_key, provider_model_id, display_name, description, is_enabled,
  capabilities, default_params, timeout_ms,
  input_cost_per_mtok_usd, output_cost_per_mtok_usd, cached_input_cost_per_mtok_usd,
  required_env_vars, sort_order
) VALUES
  ('gemini-3.1-pro-preview', 'gemini', 'gemini-3.1-pro-preview', 'Gemini 3.1 Pro (preview)', '', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 20),
  ('gemini-3.1-flash-lite', 'gemini', 'gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite', '', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 30),
  ('gemini-2.5-pro', 'gemini', 'gemini-2.5-pro', 'Gemini 2.5 Pro', '', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 40),
  ('gemini-2.5-flash', 'gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash', 'Default for novelty assessment and style extraction.', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 50),
  ('gemini-2.5-flash-lite', 'gemini', 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', '', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 60),
  ('gemini-3-flash-preview', 'gemini', 'gemini-3-flash-preview', 'Gemini 3 Flash (preview)', 'Legacy id kept so older config resolves.', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 70),
  ('gemini-3.1-flash-lite-preview', 'gemini', 'gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash-Lite (preview)', 'Legacy id kept so older config resolves.', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 80)
ON CONFLICT (model_key) DO NOTHING;

UPDATE public.model_config
SET model_id = CASE task_key
      WHEN 'graphic_style_extraction' THEN 'gemini-2.5-flash'
      WHEN 'agent_novelty_assessment' THEN 'gemini-2.5-flash'
      WHEN 'voice_selection' THEN 'gemini-2.5-flash-lite'
      ELSE 'gemini-3.5-flash'
    END,
    updated_at = NOW()
WHERE model_id = 'gemini-3.8-flash';

DO $$
BEGIN
  IF to_regclass('public.agent_personas') IS NOT NULL THEN
    UPDATE public.agent_personas AS persona
    SET model_overrides = (
      SELECT jsonb_object_agg(
        entry.key,
        CASE WHEN entry.value->>'modelId' = 'gemini-3.8-flash'
             THEN jsonb_set(entry.value, '{modelId}', '"gemini-3.5-flash"')
             ELSE entry.value END
      )
      FROM jsonb_each(persona.model_overrides) AS entry
    )
    WHERE CASE
      WHEN jsonb_typeof(persona.model_overrides) = 'object' THEN EXISTS (
        SELECT 1 FROM jsonb_each(persona.model_overrides) AS entry WHERE entry.value->>'modelId' = 'gemini-3.8-flash'
      )
      ELSE FALSE
    END;
  END IF;
END $$;

DELETE FROM public.text_model_registry WHERE model_key = 'gemini-3.8-flash';

UPDATE public.text_model_registry
SET capabilities = capabilities - 'reasoningLevels',
    default_params = default_params - 'reasoningLevel';

UPDATE public.text_model_registry
SET capabilities = capabilities || '{"temperature":true}'::JSONB
WHERE provider_key = 'gemini';

ALTER TABLE public.model_config DROP CONSTRAINT IF EXISTS model_config_reasoning_level_values;
ALTER TABLE public.model_config DROP COLUMN IF EXISTS reasoning_level;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 120;
