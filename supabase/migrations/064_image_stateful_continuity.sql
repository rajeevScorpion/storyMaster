-- Stateful image continuity defaults and provider capability hints.

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES (
  'image_continuity_settings',
  TRUE,
  '{
    "defaultStrategy":"auto",
    "openai":{
      "enabled":true,
      "runtimeModelId":"gpt-5.4-mini",
      "inputUsdPer1MTokens":0.75,
      "cachedInputUsdPer1MTokens":0.075,
      "outputUsdPer1MTokens":4.5
    },
    "gemini":{
      "enabled":true,
      "runtimeModelId":"gemini-3.1-flash-image",
      "inputUsdPer1MTokens":0.5,
      "cachedInputUsdPer1MTokens":0.125,
      "outputUsdPer1MTokens":3
    },
    "xai":{"enabled":false}
  }'::TEXT
)
ON CONFLICT (flag_key) DO UPDATE
SET
  enabled = TRUE,
  value = COALESCE(public.feature_flags.value, EXCLUDED.value);

UPDATE public.image_model_registry
SET capabilities = capabilities || '{"statefulContinuity":{"supported":true,"mode":"gemini_interactions"}}'::jsonb
WHERE provider_key = 'gemini'
  AND task_key IN ('image_generation', 'reel_image_generation', 'portrait_generation');

UPDATE public.image_model_registry
SET capabilities = capabilities || '{"statefulContinuity":{"supported":true,"mode":"openai_responses"}}'::jsonb
WHERE provider_key = 'openai'
  AND task_key IN ('image_generation', 'reel_image_generation', 'portrait_generation');

UPDATE public.image_model_registry
SET capabilities = capabilities || '{"statefulContinuity":{"supported":false,"mode":"resend_refs"}}'::jsonb
WHERE provider_key = 'xai'
  AND task_key IN ('image_generation', 'reel_image_generation', 'portrait_generation');
