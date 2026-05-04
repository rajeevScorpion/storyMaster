-- 042_storyline_choice_flash_controls_rollback.sql

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'storyline_choice_flash_enabled',
  'storyline_choice_flash_ms'
);
