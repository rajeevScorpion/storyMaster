-- ============================================================
-- 005: Add cover_image_url to stories table for tree thumbnails
-- ============================================================

ALTER TABLE public.stories ADD COLUMN cover_image_url text;
