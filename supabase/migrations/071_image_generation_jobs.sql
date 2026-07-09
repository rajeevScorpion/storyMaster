-- 071_image_generation_jobs.sql
-- Durable per-image generation jobs for the server-side media pipeline.
-- One row = one interactive beat/reel image request. Created by the enqueue
-- server action while the admin processing mode routes to server_pipeline;
-- processed by the background worker (app/api/media/jobs/run). Bulk flows
-- keep their own image_batch_jobs tables.

CREATE TABLE IF NOT EXISTS public.image_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'beat_image',
  status TEXT NOT NULL DEFAULT 'pending',
  -- Mode stored on every job for rollout traceability. requested_mode is the
  -- admin setting at request time; processing_mode is the executed flow.
  processing_mode TEXT NOT NULL DEFAULT 'server_pipeline',
  requested_mode TEXT NULL,
  -- Full serializable generateImage() argument set (data URLs staged out to
  -- private R2 and replaced with r2:// references so rows stay small).
  request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Staged private-R2 reference objects (r2://bucket/key) to GC on completion.
  reference_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  media_group_id UUID NULL,
  reservation_id UUID NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error TEXT NULL,
  claimed_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT image_generation_jobs_kind CHECK (kind IN ('beat_image', 'reel_image')),
  CONSTRAINT image_generation_jobs_status CHECK (
    status IN ('pending', 'processing', 'ready', 'failed', 'cancelled')
  ),
  CONSTRAINT image_generation_jobs_processing_mode CHECK (
    processing_mode IN ('server_pipeline')
  ),
  CONSTRAINT image_generation_jobs_attempts_nonnegative CHECK (
    attempt_count >= 0 AND max_attempts >= 1
  )
);

-- One active job per beat: prevents duplicate generation on double-click or
-- admin mode flips.
CREATE UNIQUE INDEX IF NOT EXISTS idx_image_generation_jobs_active_node
  ON public.image_generation_jobs (story_id, node_id)
  WHERE status IN ('pending', 'processing');

-- Worker/reconcile scans.
CREATE INDEX IF NOT EXISTS idx_image_generation_jobs_active
  ON public.image_generation_jobs (status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_image_generation_jobs_story
  ON public.image_generation_jobs (story_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_generation_jobs_user
  ON public.image_generation_jobs (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_image_generation_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS image_generation_jobs_touch_updated_at ON public.image_generation_jobs;
CREATE TRIGGER image_generation_jobs_touch_updated_at
  BEFORE UPDATE ON public.image_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_image_generation_jobs_updated_at();

-- RLS: owners can read their own jobs (status polling). All writes happen
-- through the service-role client (enqueue action + worker), which bypasses RLS.
ALTER TABLE public.image_generation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own image generation jobs" ON public.image_generation_jobs;
CREATE POLICY "Users can view own image generation jobs"
  ON public.image_generation_jobs FOR SELECT
  USING (auth.uid() = user_id);
