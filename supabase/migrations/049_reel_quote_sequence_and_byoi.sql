-- 049_reel_quote_sequence_and_byoi.sql
-- Manual migration. Pivots the reel action-cost keys to the new one-shot
-- quote-sequence model with a BYOI variant.
--
-- Old keys (from 046 / 047):
--   start_reel_initial_beat        — per-beat reel start cost
--   continue_reel_new_beat         — per-beat reel continue cost
--
-- New keys:
--   start_reel_full_generation                  — full reel with AI images (N draft + N composer + N image + N TTS)
--   start_reel_full_generation_prompt_only      — full reel without AI images (N draft + N composer + N TTS, user uploads images)
--
-- The branch is unreleased; no user-facing reels exist in production, so we
-- can drop the obsolete keys outright without back-compat shims.

-- 1) Seed the new action-cost rows. The full-generation cost is approximated
--    as 3x the story-start cost (covers 1-3 reel beats with per-beat composer
--    + image + TTS). The BYOI variant is 1.5x because it skips the image-gen
--    calls. Admin can tune these in the pricing workspace afterwards.

INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active)
SELECT
  'start_reel_full_generation',
  COALESCE(
    (SELECT beat_cost * 3 FROM public.pricing_action_costs WHERE action_key = 'start_story_initial_beat' ORDER BY effective_from DESC LIMIT 1),
    3
  ),
  true
ON CONFLICT (action_key) DO NOTHING;

INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active)
SELECT
  'start_reel_full_generation_prompt_only',
  COALESCE(
    (SELECT beat_cost * 3 FROM public.pricing_action_costs WHERE action_key = 'start_story_initial_beat_prompt_only' ORDER BY effective_from DESC LIMIT 1),
    1.5
  ),
  true
ON CONFLICT (action_key) DO NOTHING;

-- 2) Retire the obsolete per-beat reel keys. They were never live in prod;
--    deleting them keeps the action_cost table tidy and prevents accidental
--    re-use from old admin payloads.

DELETE FROM public.pricing_action_costs
WHERE action_key IN ('start_reel_initial_beat', 'continue_reel_new_beat');
