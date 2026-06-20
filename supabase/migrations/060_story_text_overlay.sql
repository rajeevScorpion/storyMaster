-- Add isolated story text overlay metadata for non-reel storyboard narration.

ALTER TABLE public.beats
  ADD COLUMN IF NOT EXISTS story_text_overlay_enabled BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS story_text_overlay_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS story_text_overlay_style JSONB NULL,
  ADD COLUMN IF NOT EXISTS story_text_overlay_captions JSONB NULL,
  ADD COLUMN IF NOT EXISTS story_text_overlay_alignment JSONB NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'beats_story_text_overlay_mode_check'
  ) THEN
    ALTER TABLE public.beats
      ADD CONSTRAINT beats_story_text_overlay_mode_check
      CHECK (story_text_overlay_mode IS NULL OR story_text_overlay_mode IN ('word', 'line'));
  END IF;
END $$;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('story_text_overlay_words_per_line', true, '7')
ON CONFLICT (flag_key) DO UPDATE
SET value = COALESCE(feature_flags.value, EXCLUDED.value);
