-- 033_incremental_beat_asset_sync_rollback.sql

ALTER TABLE public.beats DROP CONSTRAINT IF EXISTS beats_image_status_check;
ALTER TABLE public.beats DROP CONSTRAINT IF EXISTS beats_audio_status_check;

DROP INDEX IF EXISTS public.idx_beats_image_status;
DROP INDEX IF EXISTS public.idx_beats_audio_status;

ALTER TABLE public.beats
  DROP COLUMN IF EXISTS image_status,
  DROP COLUMN IF EXISTS image_error,
  DROP COLUMN IF EXISTS image_synced_at,
  DROP COLUMN IF EXISTS audio_status,
  DROP COLUMN IF EXISTS audio_error,
  DROP COLUMN IF EXISTS audio_synced_at;

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'story_incremental_asset_sync_enabled',
  'story_asset_upload_pause_during_generation_enabled',
  'story_asset_sync_warning_timeout_ms'
);
