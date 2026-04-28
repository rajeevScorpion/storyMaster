-- 034_prompt_only_story_mode.sql
-- Seed rollout flags and pricing defaults for prompt-only story creation.

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('story_prompt_only_mode_enabled', false, NULL),
  ('audio_storyline_publish_enabled', false, NULL)
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active)
VALUES
  ('start_story_initial_beat_prompt_only', 0.5, true),
  ('continue_story_new_beat_prompt_only', 0.5, true)
ON CONFLICT (action_key) DO UPDATE
SET
  beat_cost = EXCLUDED.beat_cost,
  is_active = EXCLUDED.is_active,
  updated_at = now();
