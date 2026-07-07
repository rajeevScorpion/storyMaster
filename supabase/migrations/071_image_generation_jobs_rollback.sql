-- 071_image_generation_jobs_rollback.sql
-- Drop the interactive image generation job table. Safe only while the admin
-- processing mode is client_legacy (no rows being produced/consumed).

DROP TRIGGER IF EXISTS image_generation_jobs_touch_updated_at ON public.image_generation_jobs;
DROP FUNCTION IF EXISTS public.touch_image_generation_jobs_updated_at();
DROP TABLE IF EXISTS public.image_generation_jobs;
