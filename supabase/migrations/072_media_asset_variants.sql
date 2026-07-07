-- 072_media_asset_variants.sql
-- Extend the media_assets ledger for the server-side variant pipeline:
-- one row per stored object, grouped by media_group_id, tagged with the
-- variant role, the processing mode that created it, the source job, and
-- (for originals) the tier-based retention expiry.

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS media_group_id UUID NULL,
  ADD COLUMN IF NOT EXISTS processing_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS source_job_id UUID NULL,
  ADD COLUMN IF NOT EXISTS original_expires_at TIMESTAMPTZ NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_variant_check'
  ) THEN
    ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_variant_check
      CHECK (variant IN ('legacy', 'original', 'display', 'thumbnail', 'share_low', 'share_high'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_processing_mode_check'
  ) THEN
    ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_processing_mode_check
      CHECK (processing_mode IS NULL OR processing_mode IN ('client_legacy', 'server_pipeline', 'imported'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_media_assets_group
  ON public.media_assets (media_group_id, variant)
  WHERE media_group_id IS NOT NULL;

-- Retention cleanup scan: originals that still exist and can expire.
CREATE INDEX IF NOT EXISTS idx_media_assets_original_expiry
  ON public.media_assets (original_expires_at)
  WHERE variant = 'original' AND original_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_story_node
  ON public.media_assets (story_id, node_id, variant, created_at DESC);
