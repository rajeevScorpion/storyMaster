DROP TRIGGER IF EXISTS image_model_registry_touch_updated_at ON public.image_model_registry;
DROP FUNCTION IF EXISTS public.touch_image_model_registry_updated_at();
DROP TABLE IF EXISTS public.image_model_registry;

ALTER TABLE public.beats
  DROP COLUMN IF EXISTS image_generation_metadata,
  DROP COLUMN IF EXISTS image_model_key,
  DROP COLUMN IF EXISTS image_provider_key;

ALTER TABLE public.stories
  DROP COLUMN IF EXISTS visual_profile,
  DROP COLUMN IF EXISTS image_model_snapshot,
  DROP COLUMN IF EXISTS image_model_key,
  DROP COLUMN IF EXISTS image_provider_key;
