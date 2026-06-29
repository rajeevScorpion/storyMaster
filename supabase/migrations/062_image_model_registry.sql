-- Multimodel image registry, model snapshots, and per-beat generation metadata.

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS image_provider_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS image_model_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS image_model_snapshot JSONB NULL,
  ADD COLUMN IF NOT EXISTS visual_profile JSONB NULL;

ALTER TABLE public.beats
  ADD COLUMN IF NOT EXISTS image_provider_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS image_model_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS image_generation_metadata JSONB NULL;

CREATE TABLE IF NOT EXISTS public.image_model_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  model_key TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  badge TEXT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_user_visible BOOLEAN NOT NULL DEFAULT FALSE,
  is_admin_test_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_recommended BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_plan_keys TEXT[] NOT NULL DEFAULT ARRAY['free', 'plus', 'studio']::TEXT[],
  coin_cost_per_image NUMERIC(10,2) NOT NULL DEFAULT 0,
  capabilities JSONB NOT NULL DEFAULT '{}'::JSONB,
  required_env_vars TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT image_model_registry_task_key CHECK (
    task_key IN ('image_generation', 'reel_image_generation', 'portrait_generation')
  ),
  CONSTRAINT image_model_registry_provider_key CHECK (
    provider_key IN ('gemini', 'openai', 'xai')
  ),
  CONSTRAINT image_model_registry_display_name_length CHECK (
    char_length(trim(display_name)) BETWEEN 1 AND 120
  ),
  CONSTRAINT image_model_registry_description_length CHECK (
    char_length(description) <= 500
  ),
  CONSTRAINT image_model_registry_coin_cost_nonnegative CHECK (
    coin_cost_per_image >= 0
  ),
  CONSTRAINT image_model_registry_allowed_plans_nonempty CHECK (
    array_length(allowed_plan_keys, 1) IS NOT NULL
  ),
  CONSTRAINT image_model_registry_task_model_unique UNIQUE (task_key, model_key)
);

CREATE INDEX IF NOT EXISTS idx_image_model_registry_task_visible
  ON public.image_model_registry (task_key, is_enabled, is_user_visible, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS idx_image_model_registry_one_default_per_task
  ON public.image_model_registry (task_key)
  WHERE is_enabled AND is_user_visible AND is_default;

CREATE OR REPLACE FUNCTION public.touch_image_model_registry_updated_at()
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

DROP TRIGGER IF EXISTS image_model_registry_touch_updated_at ON public.image_model_registry;
CREATE TRIGGER image_model_registry_touch_updated_at
  BEFORE UPDATE ON public.image_model_registry
  FOR EACH ROW EXECUTE FUNCTION public.touch_image_model_registry_updated_at();

ALTER TABLE public.image_model_registry ENABLE ROW LEVEL SECURITY;

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
  capabilities,
  required_env_vars,
  sort_order
) VALUES
  (
    'image_generation',
    'gemini',
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-image',
    'Gemini Flash Image',
    'Default storyboard image renderer for branching stories.',
    'Default',
    TRUE,
    TRUE,
    TRUE,
    TRUE,
    TRUE,
    ARRAY['free', 'plus', 'studio']::TEXT[],
    5,
    '{"aspectRatios":["16:9","9:16"],"supportsReferences":true,"supportsBase64":true}'::JSONB,
    ARRAY['GEMINI_API_KEY']::TEXT[],
    10
  ),
  (
    'reel_image_generation',
    'gemini',
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-image',
    'Gemini Flash Image',
    'Default vertical storyboard renderer for short reels.',
    'Default',
    TRUE,
    TRUE,
    TRUE,
    TRUE,
    TRUE,
    ARRAY['free', 'plus', 'studio']::TEXT[],
    5,
    '{"aspectRatios":["9:16"],"supportsReferences":true,"supportsBase64":true}'::JSONB,
    ARRAY['GEMINI_API_KEY']::TEXT[],
    10
  ),
  (
    'portrait_generation',
    'gemini',
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-image',
    'Gemini Flash Portrait',
    'Default character reference portrait renderer.',
    'Default',
    TRUE,
    FALSE,
    TRUE,
    TRUE,
    TRUE,
    ARRAY['free', 'plus', 'studio']::TEXT[],
    0,
    '{"aspectRatios":["1:1"],"supportsReferences":false,"supportsBase64":true}'::JSONB,
    ARRAY['GEMINI_API_KEY']::TEXT[],
    10
  ),
  (
    'image_generation',
    'openai',
    'openai-gpt-image-2',
    'gpt-image-2',
    'OpenAI GPT Image 2',
    'Admin-disabled seed for future OpenAI image generation.',
    'Admin only',
    FALSE,
    FALSE,
    TRUE,
    FALSE,
    FALSE,
    ARRAY['studio']::TEXT[],
    0,
    '{"aspectRatios":["16:9","9:16","1:1"],"supportsReferences":false,"supportsBase64":true}'::JSONB,
    ARRAY['OPENAI_API_KEY']::TEXT[],
    40
  ),
  (
    'reel_image_generation',
    'openai',
    'openai-gpt-image-2',
    'gpt-image-2',
    'OpenAI GPT Image 2',
    'Admin-disabled seed for future OpenAI reel image generation.',
    'Admin only',
    FALSE,
    FALSE,
    TRUE,
    FALSE,
    FALSE,
    ARRAY['studio']::TEXT[],
    0,
    '{"aspectRatios":["9:16"],"supportsReferences":false,"supportsBase64":true}'::JSONB,
    ARRAY['OPENAI_API_KEY']::TEXT[],
    40
  ),
  (
    'image_generation',
    'xai',
    'xai-grok-imagine-image-quality',
    'grok-imagine-image-quality',
    'xAI Grok Imagine Quality',
    'Admin-disabled seed for future xAI image generation.',
    'Admin only',
    FALSE,
    FALSE,
    TRUE,
    FALSE,
    FALSE,
    ARRAY['studio']::TEXT[],
    0,
    '{"aspectRatios":["16:9","9:16","1:1"],"supportsReferences":false,"supportsBase64":true}'::JSONB,
    ARRAY['XAI_API_KEY']::TEXT[],
    50
  ),
  (
    'reel_image_generation',
    'xai',
    'xai-grok-imagine-image-quality',
    'grok-imagine-image-quality',
    'xAI Grok Imagine Quality',
    'Admin-disabled seed for future xAI reel image generation.',
    'Admin only',
    FALSE,
    FALSE,
    TRUE,
    FALSE,
    FALSE,
    ARRAY['studio']::TEXT[],
    0,
    '{"aspectRatios":["9:16"],"supportsReferences":false,"supportsBase64":true}'::JSONB,
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
  sort_order = EXCLUDED.sort_order;
