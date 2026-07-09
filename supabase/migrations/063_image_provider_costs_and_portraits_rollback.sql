DELETE FROM public.feature_flags
WHERE flag_key = 'elevenlabs_cost_per_1k_chars_usd';

DELETE FROM public.image_model_registry
WHERE task_key = 'portrait_generation'
  AND model_key IN ('openai-gpt-image-2', 'xai-grok-imagine-image-quality');

ALTER TABLE public.image_model_registry
  DROP CONSTRAINT IF EXISTS image_model_registry_input_cost_nonnegative,
  DROP CONSTRAINT IF EXISTS image_model_registry_output_cost_nonnegative,
  DROP COLUMN IF EXISTS provider_cost_per_input_image_usd,
  DROP COLUMN IF EXISTS provider_cost_per_output_image_usd;
