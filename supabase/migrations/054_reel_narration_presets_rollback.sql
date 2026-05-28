-- 054_reel_narration_presets_rollback.sql
-- Roll back reel narration presets/settings/logs without touching unrelated reel,
-- story, or media data.

DROP POLICY IF EXISTS "Users can read own narration generation logs" ON public.narration_generation_logs;

DROP POLICY IF EXISTS "Users can delete own reel narration settings" ON public.reel_narration_settings;
DROP POLICY IF EXISTS "Users can update own reel narration settings" ON public.reel_narration_settings;
DROP POLICY IF EXISTS "Users can insert own reel narration settings" ON public.reel_narration_settings;
DROP POLICY IF EXISTS "Users can read own reel narration settings" ON public.reel_narration_settings;

DROP POLICY IF EXISTS "Users can delete own narration presets" ON public.narration_presets;
DROP POLICY IF EXISTS "Users can update own narration presets" ON public.narration_presets;
DROP POLICY IF EXISTS "Users can insert own narration presets" ON public.narration_presets;
DROP POLICY IF EXISTS "Users can read own narration presets" ON public.narration_presets;
DROP POLICY IF EXISTS "Public can read system narration presets" ON public.narration_presets;

DROP TRIGGER IF EXISTS reel_narration_settings_touch_updated_at ON public.reel_narration_settings;
DROP TRIGGER IF EXISTS narration_presets_touch_updated_at ON public.narration_presets;
DROP FUNCTION IF EXISTS public.touch_reel_narration_updated_at();

DROP TABLE IF EXISTS public.narration_generation_logs;
DROP TABLE IF EXISTS public.reel_narration_settings;
DROP TABLE IF EXISTS public.narration_presets;

UPDATE public.feature_flags
SET
  value = (COALESCE(value::jsonb, '{}'::jsonb) - 'narration')::text,
  updated_at = now()
WHERE flag_key = 'reel_story_settings';
