-- 078_reference_personalization.sql
-- Reference Personalization foundations: user-uploaded character/world reference
-- images that are "adopted" into a story's locked visual style at story creation.
--
-- Two additive tables (no changes to existing tables):
--   reference_sources    = the private original upload (never enters story payloads)
--   reference_adoptions  = the story-styled interpretation of a source; this row IS
--                          the durable job (status machine cloned from
--                          image_generation_jobs, migration 071).
--
-- Rows are user-owned and grouped by a client-generated setup_id so uploads and
-- adoption jobs have a stable owner BEFORE the story row exists (the story row is
-- only persisted after beat 1). story_id is backfilled after story persistence via
-- linkReferenceSetupToStory(). Existing stories get no rows; the feature is off by
-- default (reference_personalization_enabled = false).

-- ---------------------------------------------------------------------------
-- reference_sources: private original upload
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reference_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setup_id UUID NOT NULL,
  story_id UUID NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('character', 'world')),
  slot_index SMALLINT NOT NULL DEFAULT 0,
  display_name TEXT NULL,                       -- optional character name / world label
  -- Private object; served only through short-lived signed URLs, never a public URL.
  r2_bucket TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,                  -- references/{userId}/{setupId}/{id}.webp
  checksum_sha256 TEXT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/webp',
  width INTEGER NULL,
  height INTEGER NULL,
  bytes INTEGER NULL,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live source per (setup, kind, slot): a replace reuses the slot, a remove frees it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reference_sources_setup_slot
  ON public.reference_sources (setup_id, kind, slot_index)
  WHERE status <> 'removed';

CREATE INDEX IF NOT EXISTS idx_reference_sources_user
  ON public.reference_sources (user_id, created_at DESC);

-- Orphan-setup cleanup scan (uploads whose story was never created).
CREATE INDEX IF NOT EXISTS idx_reference_sources_orphan
  ON public.reference_sources (created_at)
  WHERE story_id IS NULL;

-- ---------------------------------------------------------------------------
-- reference_adoptions: story-styled interpretation + durable job state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reference_adoptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setup_id UUID NOT NULL,
  story_id UUID NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.reference_sources(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('character', 'world')),
  adoption_mode TEXT NOT NULL DEFAULT 'canonical_visual' CHECK (
    adoption_mode IN ('canonical_visual', 'description_only', 'description_plus_canonical_visual')
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'ready', 'failed', 'cancelled')
  ),
  display_name TEXT NULL,
  structured_json JSONB NOT NULL DEFAULT '{}'::jsonb,   -- identity traits / World DNA
  prompt_anchor TEXT NULL,                               -- compiled compact continuity anchor
  -- Canonical story-styled asset (private). NULL for description_only worlds.
  canonical_r2_bucket TEXT NULL,
  canonical_r2_object_key TEXT NULL,
  -- Locked style/model snapshotted at enqueue so the canonical matches beat 1.
  image_model_snapshot JSONB NULL,
  visual_style TEXT NULL,
  -- Coin reservations (finalized on ready, released on permanent failure).
  reservation_id UUID NULL,
  visualization_reservation_id UUID NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error TEXT NULL,
  claimed_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reference_adoptions_attempts_nonnegative CHECK (
    attempt_count >= 0 AND max_attempts >= 1
  )
);

-- One live adoption per source: blocks double-enqueue on double click / re-submit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reference_adoptions_live_source
  ON public.reference_adoptions (source_id)
  WHERE status IN ('pending', 'processing', 'ready');

-- Worker / reconcile scans.
CREATE INDEX IF NOT EXISTS idx_reference_adoptions_active
  ON public.reference_adoptions (status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_reference_adoptions_setup
  ON public.reference_adoptions (setup_id, created_at);

CREATE INDEX IF NOT EXISTS idx_reference_adoptions_user
  ON public.reference_adoptions (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at touch triggers (same pattern as image_generation_jobs, 071)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_reference_personalization_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reference_sources_touch_updated_at ON public.reference_sources;
CREATE TRIGGER reference_sources_touch_updated_at
  BEFORE UPDATE ON public.reference_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_reference_personalization_updated_at();

DROP TRIGGER IF EXISTS reference_adoptions_touch_updated_at ON public.reference_adoptions;
CREATE TRIGGER reference_adoptions_touch_updated_at
  BEFORE UPDATE ON public.reference_adoptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_reference_personalization_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owners read their own rows (status polling). All writes go through the
-- service-role client (upload/enqueue actions + worker), which bypasses RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public.reference_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own reference sources" ON public.reference_sources;
CREATE POLICY "Users read own reference sources"
  ON public.reference_sources FOR SELECT
  USING (auth.uid() = user_id);

ALTER TABLE public.reference_adoptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own reference adoptions" ON public.reference_adoptions;
CREATE POLICY "Users read own reference adoptions"
  ON public.reference_adoptions FOR SELECT
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Feature flags: master off by default; settings blob carries tier matrix and
-- processing/upload knobs (normalized in lib/references/reference-settings.ts).
-- reference_custom_option_attachment_enabled is seeded off for the deferred
-- branch-local attachment phase (pack doc 11).
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (flag_key, enabled, value) VALUES
  ('reference_personalization_enabled', false, NULL),
  ('reference_personalization_settings', true, '{"charactersEnabled":true,"worldsEnabled":true,"worldVisualizationEnabled":true,"descriptionOnlyFallbackEnabled":true,"pauseNewAdoptions":false,"tierMatrix":{"free":{"enabled":true,"maxCharacterRefs":2,"maxWorldRefs":1,"worldAdoptionMode":"description_only"},"plus":{"enabled":true,"maxCharacterRefs":3,"maxWorldRefs":3,"worldAdoptionMode":"description_plus_canonical_visual"},"studio":{"enabled":true,"maxCharacterRefs":3,"maxWorldRefs":3,"worldAdoptionMode":"description_plus_canonical_visual"}},"maxAttempts":3,"staleReclaimMinutes":10,"maxFileSizeMb":8,"minDimensionPx":512,"abandonedSetupTtlHours":48}'),
  ('reference_custom_option_attachment_enabled', false, NULL)
ON CONFLICT (flag_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Analysis model config (multimodal identity / World DNA extraction). Uses the
-- current default text+vision model; admin-editable in the model playground.
-- ---------------------------------------------------------------------------
INSERT INTO public.model_config (task_key, model_id, temperature) VALUES
  ('reference_character_analysis', 'gemini-3.5-flash', 0.2),
  ('reference_world_analysis', 'gemini-3.5-flash', 0.2)
ON CONFLICT (task_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Coin costs (beats; 1 beat = 10 coins). Character adoption = 15 coins (1.5),
-- world DNA analysis = 5 coins (0.5), world canonical visualization = 10 coins
-- (1.0). All admin-editable in pricing_action_costs.
-- ---------------------------------------------------------------------------
INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active) VALUES
  ('adopt_character_reference', 1.5, true),
  ('adopt_world_reference', 0.5, true),
  ('visualize_world_reference', 1.0, true)
ON CONFLICT (action_key) DO UPDATE
SET
  beat_cost = EXCLUDED.beat_cost,
  is_active = EXCLUDED.is_active,
  updated_at = now();
