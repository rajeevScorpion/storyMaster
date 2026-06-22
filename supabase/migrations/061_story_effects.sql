-- Per-beat story effects and reusable personal effect presets.

ALTER TABLE public.beats
  ADD COLUMN IF NOT EXISTS story_effects JSONB NULL;

CREATE TABLE IF NOT EXISTS public.story_effect_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1,
  effect_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT story_effect_presets_name_length CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  CONSTRAINT story_effect_presets_description_length CHECK (char_length(description) <= 240),
  CONSTRAINT story_effect_presets_schema_version CHECK (schema_version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_story_effect_presets_user_updated
  ON public.story_effect_presets (user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.touch_story_effect_preset_updated_at()
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

DROP TRIGGER IF EXISTS story_effect_presets_touch_updated_at ON public.story_effect_presets;
CREATE TRIGGER story_effect_presets_touch_updated_at
  BEFORE UPDATE ON public.story_effect_presets
  FOR EACH ROW EXECUTE FUNCTION public.touch_story_effect_preset_updated_at();

ALTER TABLE public.story_effect_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own story effect presets" ON public.story_effect_presets;
CREATE POLICY "Users can read own story effect presets"
  ON public.story_effect_presets FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own story effect presets" ON public.story_effect_presets;
CREATE POLICY "Users can create own story effect presets"
  ON public.story_effect_presets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own story effect presets" ON public.story_effect_presets;
CREATE POLICY "Users can update own story effect presets"
  ON public.story_effect_presets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own story effect presets" ON public.story_effect_presets;
CREATE POLICY "Users can delete own story effect presets"
  ON public.story_effect_presets FOR DELETE
  USING (auth.uid() = user_id);

