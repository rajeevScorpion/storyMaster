-- Rollback 095: remove Runware rows and narrow the provider allowlist back.

DELETE FROM public.image_model_registry
WHERE provider_key = 'runware';

ALTER TABLE public.image_model_registry
  DROP CONSTRAINT IF EXISTS image_model_registry_provider_key;

ALTER TABLE public.image_model_registry
  ADD CONSTRAINT image_model_registry_provider_key CHECK (
    provider_key IN ('gemini', 'openai', 'xai')
  );
