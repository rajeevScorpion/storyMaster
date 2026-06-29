-- Provider cost metadata for image telemetry and provider-matched portrait rows.

ALTER TABLE public.image_model_registry
  ADD COLUMN IF NOT EXISTS provider_cost_per_output_image_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_cost_per_input_image_usd NUMERIC(12,6) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'image_model_registry_output_cost_nonnegative'
  ) THEN
    ALTER TABLE public.image_model_registry
      ADD CONSTRAINT image_model_registry_output_cost_nonnegative
      CHECK (provider_cost_per_output_image_usd >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'image_model_registry_input_cost_nonnegative'
  ) THEN
    ALTER TABLE public.image_model_registry
      ADD CONSTRAINT image_model_registry_input_cost_nonnegative
      CHECK (provider_cost_per_input_image_usd >= 0);
  END IF;
END;
$$;

UPDATE public.image_model_registry
SET
  provider_cost_per_output_image_usd = CASE provider_key
    WHEN 'gemini' THEN 0.067
    WHEN 'xai' THEN 0.050
    WHEN 'openai' THEN 0.041
    ELSE provider_cost_per_output_image_usd
  END,
  provider_cost_per_input_image_usd = CASE provider_key
    WHEN 'xai' THEN 0.010
    ELSE provider_cost_per_input_image_usd
  END,
  capabilities = CASE
    WHEN provider_key IN ('xai', 'openai') AND task_key IN ('image_generation', 'reel_image_generation') THEN
      capabilities
        || '{"supportsReferences":true,"supportsBase64":true}'::jsonb
        || CASE provider_key
          WHEN 'xai' THEN '{"maxReferenceImages":3}'::jsonb
          ELSE '{"maxReferenceImages":4}'::jsonb
        END
    ELSE capabilities
  END;

INSERT INTO public.image_model_registry (
  task_key,
  provider_key,
  model_key,
  provider_model_id,
  display_name,
  description,
  badge,
  is_enabled,
  is_user_visible,
  is_admin_test_enabled,
  is_default,
  is_recommended,
  allowed_plan_keys,
  coin_cost_per_image,
  provider_cost_per_output_image_usd,
  provider_cost_per_input_image_usd,
  capabilities,
  required_env_vars,
  sort_order
) VALUES
  (
    'portrait_generation',
    'openai',
    'openai-gpt-image-2',
    'gpt-image-2',
    'OpenAI GPT Image 2 Portrait',
    'Hidden portrait renderer paired with OpenAI storyboard image models.',
    'Internal',
    TRUE,
    FALSE,
    TRUE,
    FALSE,
    FALSE,
    ARRAY['studio']::TEXT[],
    0,
    0.041,
    0,
    '{"aspectRatios":["1:1"],"supportsReferences":false,"supportsBase64":true}'::JSONB,
    ARRAY['OPENAI_API_KEY']::TEXT[],
    40
  ),
  (
    'portrait_generation',
    'xai',
    'xai-grok-imagine-image-quality',
    'grok-imagine-image-quality',
    'xAI Grok Imagine Quality Portrait',
    'Hidden portrait renderer paired with xAI storyboard image models.',
    'Internal',
    TRUE,
    FALSE,
    TRUE,
    FALSE,
    FALSE,
    ARRAY['free', 'plus', 'studio']::TEXT[],
    0,
    0.050,
    0,
    '{"aspectRatios":["1:1"],"supportsReferences":false,"supportsBase64":true}'::JSONB,
    ARRAY['XAI_API_KEY']::TEXT[],
    50
  )
ON CONFLICT (task_key, model_key) DO UPDATE SET
  provider_key = EXCLUDED.provider_key,
  provider_model_id = EXCLUDED.provider_model_id,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  badge = EXCLUDED.badge,
  capabilities = EXCLUDED.capabilities,
  required_env_vars = EXCLUDED.required_env_vars,
  provider_cost_per_output_image_usd = EXCLUDED.provider_cost_per_output_image_usd,
  provider_cost_per_input_image_usd = EXCLUDED.provider_cost_per_input_image_usd,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES (
  'elevenlabs_cost_per_1k_chars_usd',
  TRUE,
  '{"models":[{"modelId":"eleven_multilingual_v2","displayName":"Eleven Multilingual v2","usdPer1kChars":0.22},{"modelId":"eleven_flash_v2_5","displayName":"Eleven Flash v2.5","usdPer1kChars":0.11},{"modelId":"eleven_v3","displayName":"Eleven v3","usdPer1kChars":0.22}]}'::TEXT
)
ON CONFLICT (flag_key) DO UPDATE
SET
  enabled = TRUE,
  value = COALESCE(public.feature_flags.value, EXCLUDED.value);
