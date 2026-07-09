-- 074_beat_control_pack1.sql
-- Pack 1: beat control, continuity lock & visual regeneration.
--
-- Adds:
--   1. timeline_rewrite_events — audit rows written BEFORE any downstream wipe.
--   2. beat_revisions — append-only beat text edit history.
--   3. Beat-control feature flags (seeded enabled per rollout decision).
--   4. Updated prune_orphaned_beat_images() so regenerated image versions
--      (gallery entries carrying a `mode` other than 'upload') are never
--      pruned; only legacy/user-upload entries remain prunable.
--
-- Rollout safety: everything is additive. No existing table is altered; the
-- prune function change only narrows what the nightly job may delete.

-- 1. Timeline rewrite audit -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.timeline_rewrite_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('beat_text_edit', 'options_regeneration')),
  affected_node_ids TEXT[] NOT NULL DEFAULT '{}',
  wiped_beats_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  removed_storyline_ids UUID[] NOT NULL DEFAULT '{}',
  cancelled_job_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timeline_rewrite_events_story
  ON public.timeline_rewrite_events (story_id, created_at DESC);

ALTER TABLE public.timeline_rewrite_events ENABLE ROW LEVEL SECURITY;

-- Owners can review their rewrite history; all writes go through the
-- service-role client (no INSERT/UPDATE/DELETE policies on purpose).
DROP POLICY IF EXISTS "Users read own rewrite events" ON public.timeline_rewrite_events;
CREATE POLICY "Users read own rewrite events" ON public.timeline_rewrite_events
  FOR SELECT USING (auth.uid() = user_id);

-- 2. Beat text revisions ----------------------------------------------------

-- A separate table (not JSONB on beats) because beats rows are wholesale
-- upserted by several writers (saveStory batch, saveBeat, media patches); an
-- embedded history column would be clobbered by the dual-write race.
CREATE TABLE IF NOT EXISTS public.beat_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  previous_text TEXT NOT NULL,
  new_text TEXT NOT NULL,
  rewrite_event_id UUID NULL REFERENCES public.timeline_rewrite_events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_beat_revisions_story_node
  ON public.beat_revisions (story_id, node_id, created_at DESC);

ALTER TABLE public.beat_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own beat revisions" ON public.beat_revisions;
CREATE POLICY "Users read own beat revisions" ON public.beat_revisions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own beat revisions" ON public.beat_revisions;
CREATE POLICY "Users insert own beat revisions" ON public.beat_revisions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 3. Feature flags ----------------------------------------------------------

INSERT INTO public.feature_flags (flag_key, enabled, value) VALUES
  ('beat_text_edit_enabled', true, NULL),
  ('beat_timeline_rewrite_enabled', true, NULL),
  ('beat_image_regen_enabled', true, NULL),
  ('beat_image_version_history_enabled', true, NULL),
  ('beat_narration_regen_enabled', true, NULL),
  ('beat_options_regen_enabled', true, NULL),
  ('beat_custom_options_enabled', true, NULL),
  ('beat_panel_suggestions_enabled', true, NULL),
  ('beat_image_max_versions_per_beat', true, '10')
ON CONFLICT (flag_key) DO NOTHING;

-- 4. Protect regenerated image versions from the nightly prune job ----------

-- Same body as 035_prompt_only_beat_image_gallery.sql with one change: an
-- entry is only prunable when it has no `mode` or mode = 'upload'. Entries
-- written by the regeneration pipeline (mode: initial/refine/reimagine/
-- restore) are version history and must be retained.
CREATE OR REPLACE FUNCTION public.prune_orphaned_beat_images()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  cleanup_enabled BOOLEAN;
  cleanup_days INTEGER;
  cutoff TIMESTAMPTZ;
  beat_record RECORD;
  active_storage_key TEXT;
  stale_keys TEXT[];
  retained_entries JSONB;
BEGIN
  SELECT enabled INTO cleanup_enabled
  FROM public.feature_flags
  WHERE flag_key = 'prompt_only_image_gallery_cleanup_enabled';

  IF cleanup_enabled IS DISTINCT FROM TRUE THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(value, '')::INTEGER, 7) INTO cleanup_days
  FROM public.feature_flags
  WHERE flag_key = 'prompt_only_image_gallery_cleanup_days';

  IF cleanup_days IS NULL OR cleanup_days < 1 THEN
    cleanup_days := 7;
  END IF;

  cutoff := now() - make_interval(days => cleanup_days);

  FOR beat_record IN
    SELECT b.id, b.image_url, b.image_gallery
    FROM public.beats AS b
    JOIN public.stories AS s ON s.id = b.story_id
    WHERE jsonb_array_length(b.image_gallery) > 0
      AND s.story_config->>'imageGenerationMode' = 'prompt_only'
  LOOP
    active_storage_key := CASE
      WHEN beat_record.image_url IS NULL THEN NULL
      ELSE regexp_replace(beat_record.image_url, '^.*/storage/v1/object/(?:public|sign|authenticated)/story-assets/', '')
    END;

    SELECT
      COALESCE(array_agg(entry->>'storage_key') FILTER (WHERE
        (entry->>'uploaded_at')::timestamptz < cutoff
        AND (active_storage_key IS NULL OR entry->>'storage_key' <> active_storage_key)
        AND (entry->>'mode' IS NULL OR entry->>'mode' = 'upload')
      ), ARRAY[]::TEXT[]),
      COALESCE(jsonb_agg(entry) FILTER (WHERE
        (entry->>'uploaded_at')::timestamptz >= cutoff
        OR (active_storage_key IS NOT NULL AND entry->>'storage_key' = active_storage_key)
        OR (entry->>'mode' IS NOT NULL AND entry->>'mode' <> 'upload')
      ), '[]'::jsonb)
    INTO stale_keys, retained_entries
    FROM jsonb_array_elements(beat_record.image_gallery) AS entry;

    IF array_length(stale_keys, 1) IS NULL THEN
      CONTINUE;
    END IF;

    DELETE FROM storage.objects
    WHERE bucket_id = 'story-assets'
      AND name = ANY(stale_keys);

    UPDATE public.beats
    SET image_gallery = retained_entries
    WHERE id = beat_record.id;
  END LOOP;
END;
$$;
