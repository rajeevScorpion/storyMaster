-- 024_script_seeded_story_mode.sql
-- Add canonical seed-path metadata, shared authoring cap, and seed-preview pricing support.

ALTER TABLE public.beats
  ADD COLUMN IF NOT EXISTS origin_kind TEXT NULL,
  ADD COLUMN IF NOT EXISTS seed_plan_beat_index INTEGER NULL,
  ADD COLUMN IF NOT EXISTS canonical_option_id TEXT NULL;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('story_authoring_word_cap', false, '500')
ON CONFLICT (flag_key) DO UPDATE
SET
  value = COALESCE(public.feature_flags.value, EXCLUDED.value),
  updated_at = now();

INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active)
VALUES ('preview_seed_plan', 0, true)
ON CONFLICT (action_key) DO UPDATE
SET
  beat_cost = EXCLUDED.beat_cost,
  is_active = EXCLUDED.is_active,
  updated_at = now();
