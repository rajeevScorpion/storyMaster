-- 029_story_ui_controls_rollback.sql

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'story_ui_text_line_count',
  'story_ui_auto_scroll_enabled'
);
