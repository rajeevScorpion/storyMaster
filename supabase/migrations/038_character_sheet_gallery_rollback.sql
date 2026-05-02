-- 038_character_sheet_gallery_rollback.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'prune-orphaned-character-sheets'
  ) THEN
    PERFORM cron.unschedule('prune-orphaned-character-sheets');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.prune_orphaned_character_sheets();

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'character_sheet_max_per_character',
  'character_sheet_cleanup_enabled',
  'character_sheet_cleanup_days'
);

-- Note: backfilled referenceSheetGallery entries on stories.characters and
-- story_map.nodes[*].data.characters[] are intentionally left in place. They
-- are valid, idempotent data and removing them risks losing user uploads.
