-- Two-path bulk visual generation.
--
-- Adds support for a second bulk-visual delivery path alongside the existing
-- provider batch API path ('batch_api'):
--   * 'stateful' — a fast, server-side SEQUENTIAL job that renders beats in a
--     provider-stateful thread (Gemini interactions / OpenAI responses) at regular
--     price. Each beat inherits the prior turn's state (chain link stored in
--     image_batch_jobs.last_state), so characters stay consistent without resending
--     reference images. Items carry an explicit sequence_index for ordered processing.
--
-- Also tags cost ledger rows with the generation mode so the admin cost cards can
-- distinguish regular / batch / stateful image spend, and records the full regular
-- (un-discounted) cost basis for batch items in image_batch_items.regular_cost_usd.

ALTER TABLE public.image_batch_jobs
  ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'batch_api',
  ADD COLUMN IF NOT EXISTS episodic BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS provider_model_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_state JSONB NULL;

ALTER TABLE public.image_batch_jobs
  ADD CONSTRAINT image_batch_jobs_generation_mode
  CHECK (generation_mode IN ('batch_api', 'stateful'));

ALTER TABLE public.image_batch_items
  ADD COLUMN IF NOT EXISTS sequence_index INTEGER NULL,
  ADD COLUMN IF NOT EXISTS regular_cost_usd NUMERIC(12,6) NULL;

-- Ordered processing of a stateful job's items.
CREATE INDEX IF NOT EXISTS idx_image_batch_items_job_sequence
  ON public.image_batch_items (job_id, sequence_index);

ALTER TABLE public.ai_cost_events
  ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'regular';
