-- 035_prompt_only_beat_image_gallery_rollback.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'prune-orphaned-beat-images'
  ) THEN
    PERFORM cron.unschedule('prune-orphaned-beat-images');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.prune_orphaned_beat_images();

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'prompt_only_max_images_per_beat',
  'prompt_only_image_gallery_cleanup_enabled',
  'prompt_only_image_gallery_cleanup_days'
);

ALTER TABLE public.beats DROP COLUMN IF EXISTS image_gallery;
