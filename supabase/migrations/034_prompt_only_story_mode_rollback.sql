-- 034_prompt_only_story_mode_rollback.sql

DELETE FROM public.pricing_action_costs
WHERE action_key IN (
  'start_story_initial_beat_prompt_only',
  'continue_story_new_beat_prompt_only'
);

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'story_prompt_only_mode_enabled',
  'audio_storyline_publish_enabled'
);
