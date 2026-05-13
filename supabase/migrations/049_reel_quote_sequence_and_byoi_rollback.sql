-- 049_reel_quote_sequence_and_byoi_rollback.sql
-- Rollback for 049: restores the old reel per-beat action-cost keys and
-- removes the one-shot keys.

INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active)
SELECT
  'start_reel_initial_beat',
  COALESCE(
    (SELECT beat_cost FROM public.pricing_action_costs WHERE action_key = 'start_story_initial_beat' ORDER BY effective_from DESC LIMIT 1),
    1
  ),
  true
ON CONFLICT (action_key) DO NOTHING;

INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active)
SELECT
  'continue_reel_new_beat',
  COALESCE(
    (SELECT beat_cost FROM public.pricing_action_costs WHERE action_key = 'continue_story_new_beat' ORDER BY effective_from DESC LIMIT 1),
    1
  ),
  true
ON CONFLICT (action_key) DO NOTHING;

DELETE FROM public.pricing_action_costs
WHERE action_key IN ('start_reel_full_generation', 'start_reel_full_generation_prompt_only');
