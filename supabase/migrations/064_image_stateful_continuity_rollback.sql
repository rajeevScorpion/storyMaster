-- Roll back stateful image continuity defaults.

DELETE FROM public.feature_flags
WHERE flag_key = 'image_continuity_settings';

UPDATE public.image_model_registry
SET capabilities = capabilities - 'statefulContinuity'
WHERE provider_key IN ('gemini', 'openai', 'xai')
  AND task_key IN ('image_generation', 'reel_image_generation', 'portrait_generation');
