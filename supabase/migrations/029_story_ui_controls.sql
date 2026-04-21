-- 029_story_ui_controls.sql
-- Add admin-controlled story reader UI settings.

ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('story_ui_text_line_count', true, '7'),
  ('story_ui_auto_scroll_enabled', true, NULL)
ON CONFLICT (flag_key) DO NOTHING;
