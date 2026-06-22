DROP POLICY IF EXISTS "Users can delete own story effect presets" ON public.story_effect_presets;
DROP POLICY IF EXISTS "Users can update own story effect presets" ON public.story_effect_presets;
DROP POLICY IF EXISTS "Users can create own story effect presets" ON public.story_effect_presets;
DROP POLICY IF EXISTS "Users can read own story effect presets" ON public.story_effect_presets;
DROP TRIGGER IF EXISTS story_effect_presets_touch_updated_at ON public.story_effect_presets;
DROP FUNCTION IF EXISTS public.touch_story_effect_preset_updated_at();
DROP TABLE IF EXISTS public.story_effect_presets;
ALTER TABLE public.beats DROP COLUMN IF EXISTS story_effects;
