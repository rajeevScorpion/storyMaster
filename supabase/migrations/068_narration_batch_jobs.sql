-- Server-side background narration generation.
--
-- Mirrors the fast stateful image path: "Generate all narration" no longer runs
-- as a browser-side loop (which dies if the tab closes) but as a background job
-- that a server worker drives to completion. The user can leave and come back;
-- narration audio streams onto the beats as each is produced.
--
-- Per-beat audio state continues to live on public.beats (audio_status/audio_url),
-- exactly like the interactive narration path — so no items table is needed. This
-- job row only tracks the target beat list, the locked narrator voice, aggregate
-- progress counts, and lifecycle status for resumability.

CREATE TABLE IF NOT EXISTS public.narration_batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'current_path',
  status TEXT NOT NULL DEFAULT 'pending',
  -- Ordered list of target beat node_ids (root -> current-node path at submit time).
  node_ids JSONB NOT NULL DEFAULT '[]'::JSONB,
  -- Narrator voice locked at submit time so the worker reproduces it exactly.
  voice_id TEXT NULL,
  voice_mode TEXT NULL,
  voice_gender_bucket TEXT NULL,
  language_code TEXT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT narration_batch_jobs_status CHECK (
    status IN ('pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled')
  ),
  CONSTRAINT narration_batch_jobs_counts_nonnegative CHECK (
    item_count >= 0 AND succeeded_count >= 0 AND failed_count >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_narration_batch_jobs_story
  ON public.narration_batch_jobs (story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_narration_batch_jobs_user
  ON public.narration_batch_jobs (user_id, created_at DESC);
-- The reconcile cron / reopen scan looks for in-flight jobs.
CREATE INDEX IF NOT EXISTS idx_narration_batch_jobs_active
  ON public.narration_batch_jobs (status)
  WHERE status IN ('pending', 'running');

-- Reuse the shared updated_at touch trigger function created in migration 066.
DROP TRIGGER IF EXISTS narration_batch_jobs_touch_updated_at ON public.narration_batch_jobs;
CREATE TRIGGER narration_batch_jobs_touch_updated_at
  BEFORE UPDATE ON public.narration_batch_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_image_batch_updated_at();

-- RLS: owners can read their own jobs. All writes happen through the service-role
-- client (submit server action + background worker), which bypasses RLS.
ALTER TABLE public.narration_batch_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own narration batch jobs"
  ON public.narration_batch_jobs FOR SELECT
  USING (auth.uid() = user_id);
