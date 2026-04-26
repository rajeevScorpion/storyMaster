-- 035_prompt_only_beat_image_gallery.sql
-- Add per-beat image gallery for prompt-only stories, plus runtime flags and a
-- nightly pg_cron job that prunes orphaned (non-active, aged) gallery entries.

ALTER TABLE public.beats
  ADD COLUMN IF NOT EXISTS image_gallery JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: seed image_gallery with the current image_url for prompt-only beats
-- whose row already has an uploaded image.
UPDATE public.beats AS b
SET image_gallery = jsonb_build_array(
  jsonb_build_object(
    'url', b.image_url,
    'storage_key', regexp_replace(b.image_url, '^.*/storage/v1/object/(?:public|sign|authenticated)/story-assets/', ''),
    'uploaded_at', COALESCE(b.image_synced_at, b.created_at, now())
  )
)
FROM public.stories AS s
WHERE b.story_id = s.id
  AND b.image_url IS NOT NULL
  AND jsonb_array_length(b.image_gallery) = 0
  AND s.story_config->>'imageGenerationMode' = 'prompt_only';

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('prompt_only_max_images_per_beat', true, '3'),
  ('prompt_only_image_gallery_cleanup_enabled', true, NULL),
  ('prompt_only_image_gallery_cleanup_days', true, '7')
ON CONFLICT (flag_key) DO NOTHING;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Prune gallery entries that are not the active image and were uploaded more
-- than `prompt_only_image_gallery_cleanup_days` ago. Storage objects are
-- removed in lockstep so abandoned uploads do not accumulate cost.
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
      ), ARRAY[]::TEXT[]),
      COALESCE(jsonb_agg(entry) FILTER (WHERE
        (entry->>'uploaded_at')::timestamptz >= cutoff
        OR (active_storage_key IS NOT NULL AND entry->>'storage_key' = active_storage_key)
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

-- Schedule nightly at 03:00 UTC. Idempotent: if the job already exists with
-- the same name, the second cron.schedule call updates the existing entry.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'prune-orphaned-beat-images'
  ) THEN
    PERFORM cron.schedule(
      'prune-orphaned-beat-images',
      '0 3 * * *',
      $cron$SELECT public.prune_orphaned_beat_images();$cron$
    );
  END IF;
END $$;
