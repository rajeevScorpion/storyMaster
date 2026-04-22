-- 030_user_led_narration_voice_selection.sql
-- Add deterministic, user-led narration voice selection settings and sample storage.

ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS narration_voice_mode TEXT NOT NULL DEFAULT 'legacy_auto',
  ADD COLUMN IF NOT EXISTS narration_voice_gender_bucket TEXT NULL,
  ADD COLUMN IF NOT EXISTS narration_language_code TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stories_narration_voice_mode_check'
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_narration_voice_mode_check
      CHECK (narration_voice_mode IN ('legacy_auto', 'user_selected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stories_narration_voice_gender_bucket_check'
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_narration_voice_gender_bucket_check
      CHECK (narration_voice_gender_bucket IS NULL OR narration_voice_gender_bucket IN ('male', 'female'));
  END IF;
END $$;

ALTER TABLE public.beats
  ADD COLUMN IF NOT EXISTS narration_voice_id TEXT NULL;

CREATE TABLE IF NOT EXISTS public.narration_voice_samples (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  voice_id TEXT NOT NULL,
  gender_bucket TEXT NOT NULL CHECK (gender_bucket IN ('male', 'female')),
  language_code TEXT NOT NULL,
  sample_text_hash TEXT NOT NULL,
  sample_text TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'narration-voice-samples',
  storage_path TEXT NULL,
  file_url TEXT NULL,
  duration_ms INTEGER NULL,
  generation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (generation_status IN ('pending', 'generating', 'ready', 'failed')),
  generation_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (voice_id, language_code, sample_text_hash)
);

CREATE INDEX IF NOT EXISTS idx_narration_voice_samples_lookup
  ON public.narration_voice_samples (voice_id, language_code, sample_text_hash);

CREATE INDEX IF NOT EXISTS idx_narration_voice_samples_status
  ON public.narration_voice_samples (generation_status, updated_at DESC);

ALTER TABLE public.narration_voice_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read narration voice samples" ON public.narration_voice_samples;
CREATE POLICY "Public can read narration voice samples"
  ON public.narration_voice_samples FOR SELECT
  USING (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('narration-voice-samples', 'narration-voice-samples', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Anyone can read narration voice sample files" ON storage.objects;
CREATE POLICY "Anyone can read narration voice sample files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'narration-voice-samples');

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('narration_user_led_voice_selection_enabled', false, NULL),
  ('narration_male_voice_list', true, '["Charon","Puck","Fenrir","Umbriel","Orus","Achird"]'),
  ('narration_female_voice_list', true, '["Kore","Aoede","Leda","Zephyr","Sulafat","Callirrhoe"]'),
  ('narration_default_male_voice', true, 'Charon'),
  ('narration_default_female_voice', true, 'Kore'),
  ('narration_sample_text_en_in', true, 'Once upon a time, in a quiet corner of the world, a small story was waiting to come alive.'),
  ('narration_sample_text_hi_in', true, 'एक बार की बात है, दुनिया के एक शांत कोने में, एक छोटी सी कहानी जीवंत होने का इंतज़ार कर रही थी।')
ON CONFLICT (flag_key) DO NOTHING;
