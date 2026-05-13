-- 050_reel_visual_style_thumbnail.sql
-- Adds optional thumbnail columns to reel_visual_styles.
-- Thumbnails are 256x256 WebP generated client-side in the Graphic Style Studio
-- and stored in the public R2 bucket alongside the 512x512 sample image.

ALTER TABLE public.reel_visual_styles
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_r2_object_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_r2_bucket TEXT NULL;
