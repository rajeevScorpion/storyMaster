-- Rollback for 066_image_batch_jobs.sql

DELETE FROM public.feature_flags WHERE flag_key = 'image_batch_scope';

DROP TRIGGER IF EXISTS image_batch_items_touch_updated_at ON public.image_batch_items;
DROP TRIGGER IF EXISTS image_batch_jobs_touch_updated_at ON public.image_batch_jobs;

DROP TABLE IF EXISTS public.image_batch_items;
DROP TABLE IF EXISTS public.image_batch_jobs;

DROP FUNCTION IF EXISTS public.touch_image_batch_updated_at();
