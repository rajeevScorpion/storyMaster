-- 119_text_model_registry.sql
--
-- Text model catalogue. model_config.model_id and agent_personas.model_overrides[*].modelId now name a
-- row here by model_key; the runtime refuses any key that is not an enabled row.
--
-- Trap: Gemini rows keep their bare provider ids as model_key so existing config resolves unchanged.
-- Never rename a model_key -- every task pointing at the old key silently drops to its code default.
-- Add a new row instead.
--
-- Non-Gemini rows seed disabled. Prices are advisory USD per 1M tokens, checked 2026-09-14; NULL means
-- "use the code price table". Without this table the app runs Gemini-only, exactly as before.
--
-- Verify: select model_key, provider_key, is_enabled from public.text_model_registry order by sort_order;

CREATE TABLE IF NOT EXISTS public.text_model_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL UNIQUE,
  provider_key TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  capabilities JSONB NOT NULL DEFAULT '{}'::JSONB,
  default_params JSONB NOT NULL DEFAULT '{}'::JSONB,
  timeout_ms INTEGER NULL,
  input_cost_per_mtok_usd NUMERIC(12,6) NULL,
  output_cost_per_mtok_usd NUMERIC(12,6) NULL,
  cached_input_cost_per_mtok_usd NUMERIC(12,6) NULL,
  required_env_vars TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT text_model_registry_provider_key CHECK (provider_key IN ('gemini', 'openai', 'openrouter')),
  CONSTRAINT text_model_registry_model_key_format CHECK (model_key ~ '^[a-z0-9][a-z0-9._:/-]{0,119}$'),
  CONSTRAINT text_model_registry_provider_model_id_length CHECK (char_length(trim(provider_model_id)) BETWEEN 1 AND 200),
  CONSTRAINT text_model_registry_display_name_length CHECK (char_length(trim(display_name)) BETWEEN 1 AND 120),
  CONSTRAINT text_model_registry_description_length CHECK (char_length(description) <= 500),
  CONSTRAINT text_model_registry_timeout_range CHECK (timeout_ms IS NULL OR timeout_ms BETWEEN 1000 AND 300000),
  CONSTRAINT text_model_registry_costs_nonnegative CHECK (
    COALESCE(input_cost_per_mtok_usd, 0) >= 0
    AND COALESCE(output_cost_per_mtok_usd, 0) >= 0
    AND COALESCE(cached_input_cost_per_mtok_usd, 0) >= 0
  )
);

CREATE OR REPLACE FUNCTION public.touch_text_model_registry_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS text_model_registry_touch_updated_at ON public.text_model_registry;
CREATE TRIGGER text_model_registry_touch_updated_at
  BEFORE UPDATE ON public.text_model_registry
  FOR EACH ROW EXECUTE FUNCTION public.touch_text_model_registry_updated_at();

ALTER TABLE public.text_model_registry ENABLE ROW LEVEL SECURITY;

INSERT INTO public.text_model_registry (
  model_key, provider_key, provider_model_id, display_name, description, is_enabled,
  capabilities, default_params, timeout_ms,
  input_cost_per_mtok_usd, output_cost_per_mtok_usd, cached_input_cost_per_mtok_usd,
  required_env_vars, sort_order
) VALUES
  ('gemini-3.5-flash', 'gemini', 'gemini-3.5-flash', 'Gemini 3.5 Flash', 'Current default text model.', TRUE,
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 10),
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
   '{"structuredOutput":"native","vision":true,"temperature":true}', '{}', NULL, NULL, NULL, NULL, ARRAY['GEMINI_API_KEY'], 80),
  ('openai:gpt-5.6-luna', 'openai', 'gpt-5.6-luna', 'GPT-5.6 Luna (OpenAI)', 'Preferred creative writer. Rejects temperature.', FALSE,
   '{"structuredOutput":"native","vision":true,"temperature":false}', '{}', 120000, 0.20, 1.20, 0.02, ARRAY['OPENAI_API_KEY'], 100),
  ('openrouter:openai/gpt-5.6-luna', 'openrouter', 'openai/gpt-5.6-luna', 'GPT-5.6 Luna (OpenRouter)', 'Experimentation route for Luna.', FALSE,
   '{"structuredOutput":"native","vision":true,"temperature":false}', '{}', 120000, 0.20, 1.20, 0.02, ARRAY['OPENROUTER_API_KEY'], 110),
  ('openrouter:qwen/qwen3.7-flash', 'openrouter', 'qwen/qwen3.7-flash', 'Qwen 3.7 Flash (OpenRouter)', 'Cheap evaluator/planner candidate. JSON mode only; prices rise above 32K prompt tokens.', FALSE,
   '{"structuredOutput":"json","vision":true,"temperature":true}', '{}', 60000, 0.03, 0.13, 0.006, ARRAY['OPENROUTER_API_KEY'], 120),
  ('openrouter:deepseek/deepseek-v4-flash-0731', 'openrouter', 'deepseek/deepseek-v4-flash-0731', 'DeepSeek V4 Flash (OpenRouter)', 'Cheap structured-output candidate. Text only.', FALSE,
   '{"structuredOutput":"native","vision":false,"temperature":true}', '{}', 60000, 0.06, 0.12, 0.012, ARRAY['OPENROUTER_API_KEY'], 130)
ON CONFLICT (model_key) DO NOTHING;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (119, '119_text_model_registry.sql')
ON CONFLICT (migration_number) DO NOTHING;
