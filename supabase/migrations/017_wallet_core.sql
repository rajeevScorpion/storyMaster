-- 017_wallet_core.sql
-- Add beat wallet grants, reservations, usage events, and usage allocations.

CREATE TABLE IF NOT EXISTS public.beat_grants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('subscription', 'carry_forward', 'topup', 'promotion', 'admin_adjustment', 'migration_grant')),
  source_ref_id text,
  currency_code text,
  beats_total integer NOT NULL CHECK (beats_total >= 0),
  beats_remaining integer NOT NULL CHECK (beats_remaining >= 0 AND beats_remaining <= beats_total),
  expires_at timestamptz,
  granted_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.beat_usage_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  action_key text NOT NULL,
  beat_cost integer NOT NULL CHECK (beat_cost > 0),
  story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
  beat_id uuid REFERENCES public.beats(id) ON DELETE SET NULL,
  storyline_id uuid REFERENCES public.storylines(id) ON DELETE SET NULL,
  related_entity_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.beat_spend_reservations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  action_key text NOT NULL,
  requested_beat_cost integer NOT NULL CHECK (requested_beat_cost >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'finalized', 'released', 'failed', 'expired')),
  idempotency_key text NOT NULL UNIQUE,
  related_story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
  related_node_id text,
  related_storyline_id uuid REFERENCES public.storylines(id) ON DELETE SET NULL,
  usage_event_id uuid REFERENCES public.beat_usage_events(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.beat_usage_allocations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usage_event_id uuid REFERENCES public.beat_usage_events(id) ON DELETE CASCADE NOT NULL,
  beat_grant_id uuid REFERENCES public.beat_grants(id) ON DELETE CASCADE NOT NULL,
  beats_consumed integer NOT NULL CHECK (beats_consumed > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(usage_event_id, beat_grant_id)
);

CREATE INDEX IF NOT EXISTS idx_beat_grants_user_spendable
  ON public.beat_grants(user_id, expires_at, granted_at)
  WHERE beats_remaining > 0;

CREATE INDEX IF NOT EXISTS idx_beat_usage_events_user_action
  ON public.beat_usage_events(user_id, action_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_beat_usage_events_story
  ON public.beat_usage_events(story_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_beat_spend_reservations_pending
  ON public.beat_spend_reservations(user_id, status, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_beat_usage_allocations_grant
  ON public.beat_usage_allocations(beat_grant_id, created_at DESC);

ALTER TABLE public.beat_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beat_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beat_spend_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beat_usage_allocations ENABLE ROW LEVEL SECURITY;
