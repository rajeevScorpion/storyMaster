-- Rollback for 069_narration_accent.sql

ALTER TABLE public.narration_batch_jobs
  DROP COLUMN IF EXISTS accent;
