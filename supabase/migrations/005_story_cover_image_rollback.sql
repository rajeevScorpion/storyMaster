-- Rollback 005: Remove cover_image_url from stories table
ALTER TABLE public.stories DROP COLUMN IF EXISTS cover_image_url;
