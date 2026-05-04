-- 042_storyline_choice_flash_controls.sql
-- Add admin controls for the selected-branch flash in published storyline playback.

ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('storyline_choice_flash_enabled', true, NULL),
  ('storyline_choice_flash_ms', true, '3000')
ON CONFLICT (flag_key) DO NOTHING;
