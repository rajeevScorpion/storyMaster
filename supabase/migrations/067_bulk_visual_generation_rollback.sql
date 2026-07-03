-- Rollback for 067_bulk_visual_generation.sql

ALTER TABLE public.ai_cost_events
  DROP COLUMN IF EXISTS generation_mode;

DROP INDEX IF EXISTS public.idx_image_batch_items_job_sequence;

ALTER TABLE public.image_batch_items
  DROP COLUMN IF EXISTS sequence_index,
  DROP COLUMN IF EXISTS regular_cost_usd;

ALTER TABLE public.image_batch_jobs
  DROP CONSTRAINT IF EXISTS image_batch_jobs_generation_mode;

ALTER TABLE public.image_batch_jobs
  DROP COLUMN IF EXISTS generation_mode,
  DROP COLUMN IF EXISTS episodic,
  DROP COLUMN IF EXISTS provider_model_id,
  DROP COLUMN IF EXISTS last_state;
