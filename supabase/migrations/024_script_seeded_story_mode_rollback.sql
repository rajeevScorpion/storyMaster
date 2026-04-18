-- 024_script_seeded_story_mode_rollback.sql

ALTER TABLE public.beats
  DROP COLUMN IF EXISTS canonical_option_id,
  DROP COLUMN IF EXISTS seed_plan_beat_index,
  DROP COLUMN IF EXISTS origin_kind;

DELETE FROM public.feature_flags
WHERE flag_key = 'story_authoring_word_cap';

DELETE FROM public.pricing_action_costs
WHERE action_key = 'preview_seed_plan';
