-- 079_reference_direct_input.sql
-- Reference Direct Input (v2). Adds a per-reference free-text description column
-- to reference_sources, a mode flag that switches the References feature between
-- the v1 "adoption" pipeline and the v2 "direct" (raw refs to the image model)
-- flow, and a coin cost for the lazy prompt_only analysis call.
--
-- Applied manually in the Supabase dashboard (never via CLI). Requires 078.

-- ---------------------------------------------------------------------------
-- v2 stores an optional user-typed description per uploaded reference (used as
-- the seeded character's appearanceSummary / the world's prompt anchor). v1 has
-- only display_name; this column is nullable and inert for the adoption path.
-- ---------------------------------------------------------------------------
ALTER TABLE public.reference_sources
  ADD COLUMN IF NOT EXISTS description TEXT NULL;

-- ---------------------------------------------------------------------------
-- Input mode: 'direct' (v2 — raw references sent to the image model at
-- generation time; no adoption jobs) or 'adoption' (v1 — analyze + canonical
-- image pipeline). Seeded 'direct'. The master flag
-- reference_personalization_enabled still gates the whole feature.
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (flag_key, enabled, value) VALUES
  ('reference_input_mode', true, 'direct')
ON CONFLICT (flag_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Coin cost for the direct-mode prompt_only analysis call (one multimodal call
-- per reference at story start to enrich text prompts). 0.5 beat = 5 coins.
-- Image stories charge nothing extra for direct references.
-- ---------------------------------------------------------------------------
INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active) VALUES
  ('analyze_direct_reference', 0.5, true)
ON CONFLICT (action_key) DO UPDATE
SET
  beat_cost = EXCLUDED.beat_cost,
  is_active = EXCLUDED.is_active,
  updated_at = now();
