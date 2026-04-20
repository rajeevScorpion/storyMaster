-- 026_ai_cost_events.sql
-- Store provider cost telemetry for every model call that belongs to a user activity.

CREATE TABLE IF NOT EXISTS public.ai_cost_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
  beat_id uuid REFERENCES public.beats(id) ON DELETE SET NULL,
  storyline_id uuid REFERENCES public.storylines(id) ON DELETE SET NULL,
  node_id text,
  story_session_id text,
  activity_key text NOT NULL,
  task_key text NOT NULL,
  provider text NOT NULL DEFAULT 'google_gemini',
  model_id text NOT NULL,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  image_count integer NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  image_size text,
  audio_seconds numeric(10,3),
  estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_cost_events_created_at
  ON public.ai_cost_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_cost_events_story_node
  ON public.ai_cost_events(story_id, node_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_cost_events_beat
  ON public.ai_cost_events(beat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_cost_events_user
  ON public.ai_cost_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_cost_events_activity_day
  ON public.ai_cost_events(activity_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_cost_events_session
  ON public.ai_cost_events(story_session_id, node_id, created_at DESC);

ALTER TABLE public.ai_cost_events ENABLE ROW LEVEL SECURITY;

-- No end-user policies are intentionally defined.
-- Runtime inserts and admin reads use the service-role client after server-side checks.
