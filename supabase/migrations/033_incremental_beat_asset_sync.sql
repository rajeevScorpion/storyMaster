-- 033_incremental_beat_asset_sync.sql
-- Add durable beat media status fields and rollout flags for incremental beat asset sync.

ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

ALTER TABLE public.beats
  ADD COLUMN IF NOT EXISTS image_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS image_error TEXT NULL,
  ADD COLUMN IF NOT EXISTS image_synced_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS audio_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS audio_error TEXT NULL,
  ADD COLUMN IF NOT EXISTS audio_synced_at TIMESTAMPTZ NULL;

UPDATE public.beats
SET image_status = CASE
  WHEN image_url IS NOT NULL THEN 'ready'
  WHEN is_storyboard = true THEN 'failed'
  ELSE 'not_requested'
END
WHERE image_status IS NULL;

UPDATE public.beats
SET audio_status = CASE
  WHEN audio_url IS NOT NULL THEN 'ready'
  ELSE 'not_requested'
END
WHERE audio_status IS NULL;

ALTER TABLE public.beats
  ALTER COLUMN image_status SET DEFAULT 'not_requested',
  ALTER COLUMN image_status SET NOT NULL,
  ALTER COLUMN audio_status SET DEFAULT 'not_requested',
  ALTER COLUMN audio_status SET NOT NULL;

UPDATE public.beats
SET image_synced_at = COALESCE(image_synced_at, created_at)
WHERE image_status = 'ready' AND image_synced_at IS NULL;

UPDATE public.beats
SET audio_synced_at = COALESCE(audio_synced_at, created_at)
WHERE audio_status = 'ready' AND audio_synced_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'beats_image_status_check'
  ) THEN
    ALTER TABLE public.beats
      ADD CONSTRAINT beats_image_status_check
      CHECK (image_status IN ('not_requested', 'pending', 'ready', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'beats_audio_status_check'
  ) THEN
    ALTER TABLE public.beats
      ADD CONSTRAINT beats_audio_status_check
      CHECK (audio_status IN ('not_requested', 'pending', 'ready', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_beats_image_status
  ON public.beats (story_id, image_status, beat_number);

CREATE INDEX IF NOT EXISTS idx_beats_audio_status
  ON public.beats (story_id, audio_status, beat_number);

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('story_incremental_asset_sync_enabled', false, NULL),
  ('story_asset_upload_pause_during_generation_enabled', false, NULL),
  ('story_asset_sync_warning_timeout_ms', true, '15000')
ON CONFLICT (flag_key) DO NOTHING;
