-- 038_character_sheet_gallery.sql
-- Per-character reference sheet gallery: history of past uploads stored on
-- stories.characters JSONB, with a nightly pg_cron job that prunes orphaned
-- (non-active, aged) entries. The active pointer fields (referenceSheetUrl /
-- referenceSheetStorageKey / referenceSheetUploadedAt) continue to be
-- propagated to beats.characters; the gallery itself lives only at the
-- story level to keep beat rows lean.

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('character_sheet_max_per_character', true, '3'),
  ('character_sheet_cleanup_enabled',   true, NULL),
  ('character_sheet_cleanup_days',      true, '7')
ON CONFLICT (flag_key) DO NOTHING;

-- Backfill: seed referenceSheetGallery on stories.characters for any character
-- that already has a single active sheet from migration 037. story_map is
-- patched in lockstep so in-flight client sessions render history immediately.

UPDATE public.stories AS s
SET characters = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN c->>'referenceSheetUrl' IS NOT NULL
       AND c->>'referenceSheetStorageKey' IS NOT NULL
       AND (
         c->'referenceSheetGallery' IS NULL
         OR jsonb_typeof(c->'referenceSheetGallery') <> 'array'
         OR jsonb_array_length(c->'referenceSheetGallery') = 0
       )
      THEN c || jsonb_build_object('referenceSheetGallery', jsonb_build_array(jsonb_build_object(
        'url',         c->>'referenceSheetUrl',
        'storageKey',  c->>'referenceSheetStorageKey',
        'uploadedAt',  COALESCE(c->>'referenceSheetUploadedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      )))
      ELSE c
    END
  ), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(s.characters, '[]'::jsonb)) AS c
)
WHERE s.characters IS NOT NULL
  AND jsonb_array_length(s.characters) > 0;

UPDATE public.stories AS s
SET story_map = jsonb_set(
  s.story_map,
  '{nodes}',
  COALESCE((
    SELECT jsonb_object_agg(node_key, jsonb_set(
      node_value,
      '{data,characters}',
      COALESCE((
        SELECT jsonb_agg(
          CASE
            WHEN c->>'referenceSheetUrl' IS NOT NULL
             AND c->>'referenceSheetStorageKey' IS NOT NULL
             AND (
               c->'referenceSheetGallery' IS NULL
               OR jsonb_typeof(c->'referenceSheetGallery') <> 'array'
               OR jsonb_array_length(c->'referenceSheetGallery') = 0
             )
            THEN c || jsonb_build_object('referenceSheetGallery', jsonb_build_array(jsonb_build_object(
              'url',         c->>'referenceSheetUrl',
              'storageKey',  c->>'referenceSheetStorageKey',
              'uploadedAt',  COALESCE(c->>'referenceSheetUploadedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
            )))
            ELSE c
          END
        )
        FROM jsonb_array_elements(COALESCE(node_value->'data'->'characters', '[]'::jsonb)) AS c
      ), '[]'::jsonb)
    ))
    FROM jsonb_each(s.story_map->'nodes') AS nodes(node_key, node_value)
  ), '{}'::jsonb)
)
WHERE s.story_map IS NOT NULL
  AND s.story_map ? 'nodes';

-- Pruning function — removes gallery entries older than `cleanup_days` whose
-- storage_key is not the character's active referenceSheetStorageKey; deletes
-- the corresponding storage objects in lockstep so abandoned uploads do not
-- accumulate cost.
CREATE OR REPLACE FUNCTION public.prune_orphaned_character_sheets()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  cleanup_enabled BOOLEAN;
  cleanup_days INTEGER;
  cutoff TIMESTAMPTZ;
  story_record RECORD;
  patched_characters JSONB;
  pruned_keys TEXT[];
  active_key TEXT;
  character_entry JSONB;
  retained_gallery JSONB;
  stale_keys TEXT[];
BEGIN
  SELECT enabled INTO cleanup_enabled
  FROM public.feature_flags
  WHERE flag_key = 'character_sheet_cleanup_enabled';

  IF cleanup_enabled IS DISTINCT FROM TRUE THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(value, '')::INTEGER, 7) INTO cleanup_days
  FROM public.feature_flags
  WHERE flag_key = 'character_sheet_cleanup_days';

  IF cleanup_days IS NULL OR cleanup_days < 1 THEN
    cleanup_days := 7;
  END IF;

  cutoff := now() - make_interval(days => cleanup_days);

  FOR story_record IN
    SELECT id, characters
    FROM public.stories
    WHERE characters IS NOT NULL
      AND jsonb_typeof(characters) = 'array'
      AND jsonb_array_length(characters) > 0
  LOOP
    pruned_keys := ARRAY[]::TEXT[];
    patched_characters := '[]'::jsonb;

    FOR character_entry IN
      SELECT * FROM jsonb_array_elements(story_record.characters)
    LOOP
      IF character_entry->'referenceSheetGallery' IS NULL
         OR jsonb_typeof(character_entry->'referenceSheetGallery') <> 'array'
         OR jsonb_array_length(character_entry->'referenceSheetGallery') = 0 THEN
        patched_characters := patched_characters || jsonb_build_array(character_entry);
        CONTINUE;
      END IF;

      active_key := character_entry->>'referenceSheetStorageKey';

      SELECT
        COALESCE(array_agg(entry->>'storageKey') FILTER (WHERE
          (entry->>'uploadedAt')::timestamptz < cutoff
          AND (active_key IS NULL OR entry->>'storageKey' <> active_key)
        ), ARRAY[]::TEXT[]),
        COALESCE(jsonb_agg(entry) FILTER (WHERE
          (entry->>'uploadedAt')::timestamptz >= cutoff
          OR (active_key IS NOT NULL AND entry->>'storageKey' = active_key)
        ), '[]'::jsonb)
      INTO stale_keys, retained_gallery
      FROM jsonb_array_elements(character_entry->'referenceSheetGallery') AS entry;

      IF array_length(stale_keys, 1) IS NULL THEN
        patched_characters := patched_characters || jsonb_build_array(character_entry);
        CONTINUE;
      END IF;

      pruned_keys := pruned_keys || stale_keys;
      patched_characters := patched_characters
        || jsonb_build_array(jsonb_set(character_entry, '{referenceSheetGallery}', retained_gallery));
    END LOOP;

    IF array_length(pruned_keys, 1) IS NULL THEN
      CONTINUE;
    END IF;

    DELETE FROM storage.objects
    WHERE bucket_id = 'story-assets'
      AND name = ANY(pruned_keys);

    UPDATE public.stories
    SET characters = patched_characters
    WHERE id = story_record.id;
  END LOOP;
END;
$$;

-- Schedule nightly at 03:05 UTC (5-minute offset from prune-orphaned-beat-images).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'prune-orphaned-character-sheets'
  ) THEN
    PERFORM cron.schedule(
      'prune-orphaned-character-sheets',
      '5 3 * * *',
      $cron$SELECT public.prune_orphaned_character_sheets();$cron$
    );
  END IF;
END $$;
