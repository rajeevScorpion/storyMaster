-- 074_beat_control_pack1_rollback.sql
-- Reverts 074_beat_control_pack1.sql.
--
-- Prefer feature-flag rollback (disable the beat_* flags) over running this
-- file: dropping the tables discards rewrite audit history and beat text
-- revisions permanently.

-- 1. Drop tables (beat_revisions first — it references timeline_rewrite_events)

DROP TABLE IF EXISTS public.beat_revisions;
DROP TABLE IF EXISTS public.timeline_rewrite_events;

-- 2. Remove seeded flags

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'beat_text_edit_enabled',
  'beat_timeline_rewrite_enabled',
  'beat_image_regen_enabled',
  'beat_image_version_history_enabled',
  'beat_narration_regen_enabled',
  'beat_options_regen_enabled',
  'beat_custom_options_enabled',
  'beat_panel_suggestions_enabled',
  'beat_image_max_versions_per_beat'
);

-- 3. Restore prune_orphaned_beat_images() to the 035 behavior (verbatim body
--    from 035_prompt_only_beat_image_gallery.sql).

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
