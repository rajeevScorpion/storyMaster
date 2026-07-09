-- Rollback for 068_narration_batch_jobs.sql

DROP POLICY IF EXISTS "Users can view own narration batch jobs" ON public.narration_batch_jobs;
DROP TRIGGER IF EXISTS narration_batch_jobs_touch_updated_at ON public.narration_batch_jobs;
DROP INDEX IF EXISTS public.idx_narration_batch_jobs_active;
DROP INDEX IF EXISTS public.idx_narration_batch_jobs_user;
DROP INDEX IF EXISTS public.idx_narration_batch_jobs_story;
DROP TABLE IF EXISTS public.narration_batch_jobs;
