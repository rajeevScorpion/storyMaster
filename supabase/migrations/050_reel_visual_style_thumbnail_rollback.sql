-- 050_reel_visual_style_thumbnail_rollback.sql
-- Rollback for 050: removes thumbnail columns from reel_visual_styles.

ALTER TABLE public.reel_visual_styles
  DROP COLUMN IF EXISTS thumbnail_url,
  DROP COLUMN IF EXISTS thumbnail_r2_object_key,
  DROP COLUMN IF EXISTS thumbnail_r2_bucket;
