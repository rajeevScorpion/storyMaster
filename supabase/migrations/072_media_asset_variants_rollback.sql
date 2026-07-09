-- 072_media_asset_variants_rollback.sql
-- Remove the variant-pipeline columns from media_assets. Safe only while the
-- admin processing mode is client_legacy and variantsForBulkJobs is off.

DROP INDEX IF EXISTS idx_media_assets_group;
DROP INDEX IF EXISTS idx_media_assets_original_expiry;
DROP INDEX IF EXISTS idx_media_assets_story_node;

ALTER TABLE public.media_assets
  DROP CONSTRAINT IF EXISTS media_assets_variant_check,
  DROP CONSTRAINT IF EXISTS media_assets_processing_mode_check;

ALTER TABLE public.media_assets
  DROP COLUMN IF EXISTS variant,
  DROP COLUMN IF EXISTS media_group_id,
  DROP COLUMN IF EXISTS processing_mode,
  DROP COLUMN IF EXISTS source_job_id,
  DROP COLUMN IF EXISTS original_expires_at;
