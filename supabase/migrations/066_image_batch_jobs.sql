-- Batch background image generation: deferred (async, ~24h, 50% cheaper) image jobs.
-- A job groups the beat/portrait image requests for one story submitted to a provider
-- batch endpoint (Gemini `batches` / OpenAI `/v1/batches`). A reconcile worker polls the
-- provider, materializes results, and attaches them back to the story's beats.

CREATE TABLE IF NOT EXISTS public.image_batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_batch_name TEXT NULL,
  scope TEXT NOT NULL DEFAULT 'path_to_completion',
  status TEXT NOT NULL DEFAULT 'pending',
  display_name TEXT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  reservation_id UUID NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  CONSTRAINT image_batch_jobs_provider CHECK (provider IN ('gemini', 'openai')),
  CONSTRAINT image_batch_jobs_scope CHECK (
    scope IN ('path_to_completion', 'all_existing', 'expand_branches', 'current_path')
  ),
  CONSTRAINT image_batch_jobs_status CHECK (
    status IN ('pending', 'submitted', 'running', 'succeeded', 'partial', 'failed', 'expired', 'cancelled')
  ),
  CONSTRAINT image_batch_jobs_counts_nonnegative CHECK (
    item_count >= 0 AND succeeded_count >= 0 AND failed_count >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_image_batch_jobs_user ON public.image_batch_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_batch_jobs_story ON public.image_batch_jobs (story_id, created_at DESC);
-- The reconcile worker scans for in-flight jobs.
CREATE INDEX IF NOT EXISTS idx_image_batch_jobs_active_status
  ON public.image_batch_jobs (status)
  WHERE status IN ('submitted', 'running');

CREATE TABLE IF NOT EXISTS public.image_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.image_batch_jobs(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  target_kind TEXT NOT NULL DEFAULT 'beat_image',
  request_key TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  aspect_ratio TEXT NULL,
  image_size TEXT NULL,
  reference_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'pending',
  image_storage_key TEXT NULL,
  image_url TEXT NULL,
  provider_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT image_batch_items_target_kind CHECK (
    target_kind IN ('beat_image', 'reel_image')
  ),
  CONSTRAINT image_batch_items_status CHECK (
    status IN ('pending', 'processing', 'ready', 'failed')
  ),
  CONSTRAINT image_batch_items_request_key_unique UNIQUE (job_id, request_key)
);

CREATE INDEX IF NOT EXISTS idx_image_batch_items_job ON public.image_batch_items (job_id);
-- The reconcile worker pulls unfinished items for materialization.
CREATE INDEX IF NOT EXISTS idx_image_batch_items_pending
  ON public.image_batch_items (job_id, status)
  WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION public.touch_image_batch_updated_at()
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

DROP TRIGGER IF EXISTS image_batch_jobs_touch_updated_at ON public.image_batch_jobs;
CREATE TRIGGER image_batch_jobs_touch_updated_at
  BEFORE UPDATE ON public.image_batch_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_image_batch_updated_at();

DROP TRIGGER IF EXISTS image_batch_items_touch_updated_at ON public.image_batch_items;
CREATE TRIGGER image_batch_items_touch_updated_at
  BEFORE UPDATE ON public.image_batch_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_image_batch_updated_at();

-- RLS: owners can read their own jobs/items. All writes happen through the
-- service-role client (submission server action + reconcile worker), which bypasses RLS.
ALTER TABLE public.image_batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own image batch jobs"
  ON public.image_batch_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own image batch items"
  ON public.image_batch_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.image_batch_jobs j
      WHERE j.id = image_batch_items.job_id AND j.user_id = auth.uid()
    )
  );

-- Admin-configurable default scope for the "Create visuals" / "Visualise whole story"
-- action. Overridable per-submission by the caller.
INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES (
  'image_batch_scope',
  TRUE,
  '{"defaultScope":"path_to_completion","allowExpandBranches":false}'::TEXT
)
ON CONFLICT (flag_key) DO NOTHING;
