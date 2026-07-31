-- 083_admin_user_management.sql
-- Phase 1 admin user operations: private auth directory, moderation state,
-- immutable audit history, wallet/story aggregates, and safe manual grants.

CREATE TABLE IF NOT EXISTS public.admin_user_directory (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  avatar_url text,
  auth_provider text,
  created_at timestamptz NOT NULL,
  last_sign_in_at timestamptz,
  auth_updated_at timestamptz,
  indexed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_user_directory_email
  ON public.admin_user_directory (lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_user_directory_created
  ON public.admin_user_directory (created_at DESC, user_id DESC);

CREATE INDEX IF NOT EXISTS idx_admin_user_directory_last_sign_in
  ON public.admin_user_directory (last_sign_in_at DESC NULLS LAST);

ALTER TABLE public.admin_user_directory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_user_directory FROM anon, authenticated;
GRANT ALL ON TABLE public.admin_user_directory TO service_role;

-- Intentionally no end-user policies. The service-role client is only created
-- after verifyAdmin() in the application.

CREATE OR REPLACE FUNCTION public.sync_admin_user_directory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  resolved_name text;
  resolved_avatar text;
  resolved_provider text;
BEGIN
  resolved_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'Kissago user'
  );
  resolved_avatar := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'avatar_url', ''),
    NULLIF(NEW.raw_user_meta_data->>'picture', '')
  );
  resolved_provider := COALESCE(
    NULLIF(NEW.raw_app_meta_data->>'provider', ''),
    NULLIF(NEW.raw_user_meta_data->>'provider', '')
  );

  INSERT INTO public.admin_user_directory (
    user_id,
    email,
    display_name,
    avatar_url,
    auth_provider,
    created_at,
    last_sign_in_at,
    auth_updated_at,
    indexed_at
  )
  VALUES (
    NEW.id,
    lower(NULLIF(NEW.email, '')),
    resolved_name,
    resolved_avatar,
    resolved_provider,
    NEW.created_at,
    NEW.last_sign_in_at,
    NEW.updated_at,
    now()
  )
  ON CONFLICT ON CONSTRAINT admin_user_directory_pkey DO UPDATE
  SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    avatar_url = EXCLUDED.avatar_url,
    auth_provider = EXCLUDED.auth_provider,
    created_at = EXCLUDED.created_at,
    last_sign_in_at = EXCLUDED.last_sign_in_at,
    auth_updated_at = EXCLUDED.auth_updated_at,
    indexed_at = now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_admin_user_directory()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS auth_users_sync_admin_directory ON auth.users;
CREATE TRIGGER auth_users_sync_admin_directory
  AFTER INSERT OR UPDATE OF email, raw_user_meta_data, raw_app_meta_data, last_sign_in_at, updated_at
  ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_admin_user_directory();

INSERT INTO public.admin_user_directory (
  user_id,
  email,
  display_name,
  avatar_url,
  auth_provider,
  created_at,
  last_sign_in_at,
  auth_updated_at,
  indexed_at
)
SELECT
  user_row.id,
  lower(NULLIF(user_row.email, '')),
  COALESCE(
    NULLIF(user_row.raw_user_meta_data->>'full_name', ''),
    NULLIF(user_row.raw_user_meta_data->>'name', ''),
    NULLIF(split_part(COALESCE(user_row.email, ''), '@', 1), ''),
    'Kissago user'
  ),
  COALESCE(
    NULLIF(user_row.raw_user_meta_data->>'avatar_url', ''),
    NULLIF(user_row.raw_user_meta_data->>'picture', '')
  ),
  COALESCE(
    NULLIF(user_row.raw_app_meta_data->>'provider', ''),
    NULLIF(user_row.raw_user_meta_data->>'provider', '')
  ),
  user_row.created_at,
  user_row.last_sign_in_at,
  user_row.updated_at,
  now()
FROM auth.users user_row
ON CONFLICT (user_id) DO UPDATE
SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  avatar_url = EXCLUDED.avatar_url,
  auth_provider = EXCLUDED.auth_provider,
  created_at = EXCLUDED.created_at,
  last_sign_in_at = EXCLUDED.last_sign_in_at,
  auth_updated_at = EXCLUDED.auth_updated_at,
  indexed_at = now();

CREATE TABLE IF NOT EXISTS public.user_account_moderation (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'blocked')),
  suspended_until timestamptz,
  reason text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND suspended_until IS NULL)
    OR (status = 'suspended' AND suspended_until IS NOT NULL)
    OR (status = 'blocked' AND suspended_until IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_user_account_moderation_status
  ON public.user_account_moderation (status, suspended_until);

ALTER TABLE public.user_account_moderation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_account_moderation FROM anon, authenticated;
GRANT ALL ON TABLE public.user_account_moderation TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_user_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (
    action_type IN (
      'account_suspended',
      'account_blocked',
      'account_reactivated',
      'coins_granted',
      'cohort_executed'
    )
  ),
  reason text NOT NULL,
  request_key text,
  before_json jsonb,
  after_json jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_user_audit_request_key
  ON public.admin_user_audit_events (request_key)
  WHERE request_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_user_audit_target
  ON public.admin_user_audit_events (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_user_audit_actor
  ON public.admin_user_audit_events (actor_user_id, created_at DESC);

ALTER TABLE public.admin_user_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_user_audit_events FROM anon, authenticated;
GRANT ALL ON TABLE public.admin_user_audit_events TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_promotional_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL UNIQUE,
  name text NOT NULL,
  rules_json jsonb NOT NULL,
  coins_per_user numeric(14,2) NOT NULL CHECK (coins_per_user > 0),
  beats_per_user numeric(12,2) NOT NULL CHECK (beats_per_user > 0),
  grant_expires_at timestamptz,
  eligible_count integer NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  granted_count integer NOT NULL DEFAULT 0 CHECK (granted_count >= 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_promotional_cohorts_created
  ON public.admin_promotional_cohorts (created_at DESC);

ALTER TABLE public.admin_promotional_cohorts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_promotional_cohorts FROM anon, authenticated;
GRANT ALL ON TABLE public.admin_promotional_cohorts TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_promotional_cohort_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid REFERENCES public.admin_promotional_cohorts(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  grant_id uuid REFERENCES public.beat_grants(id) ON DELETE SET NULL,
  snapshot_json jsonb NOT NULL,
  coins_granted numeric(14,2) NOT NULL CHECK (coins_granted > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cohort_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_promotional_cohort_members_user
  ON public.admin_promotional_cohort_members (user_id, created_at DESC);

ALTER TABLE public.admin_promotional_cohort_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_promotional_cohort_members FROM anon, authenticated;
GRANT ALL ON TABLE public.admin_promotional_cohort_members TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  avatar_url text,
  auth_provider text,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  last_product_activity_at timestamptz,
  account_status text,
  suspended_until timestamptz,
  moderation_reason text,
  current_plan_key text,
  available_beats numeric,
  lifetime_granted_beats numeric,
  lifetime_consumed_beats numeric,
  month_consumed_beats numeric,
  expiring_beats_30d numeric,
  in_progress_story_count bigint,
  finished_story_count bigint,
  published_story_count bigint,
  published_path_count bigint,
  reel_count bigint,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      directory.*,
      CASE
        WHEN moderation.status = 'suspended'
          AND moderation.suspended_until <= now()
          THEN 'active'
        ELSE COALESCE(moderation.status, 'active')
      END AS effective_status,
      CASE
        WHEN moderation.status = 'suspended'
          AND moderation.suspended_until <= now()
          THEN NULL
        ELSE moderation.suspended_until
      END AS effective_suspended_until,
      moderation.reason AS moderation_reason
    FROM public.admin_user_directory directory
    LEFT JOIN public.user_account_moderation moderation
      ON moderation.user_id = directory.user_id
    WHERE
      (p_user_id IS NULL OR directory.user_id = p_user_id)
      AND (
        NULLIF(trim(COALESCE(p_search, '')), '') IS NULL
        OR position(lower(trim(p_search)) IN lower(COALESCE(directory.email, ''))) > 0
        OR position(lower(trim(p_search)) IN lower(COALESCE(directory.display_name, ''))) > 0
      )
  ),
  status_filtered AS (
    SELECT *
    FROM filtered
    WHERE COALESCE(NULLIF(p_status, ''), 'all') = 'all'
      OR effective_status = p_status
  ),
  page_users AS (
    SELECT *
    FROM status_filtered
    ORDER BY created_at DESC, user_id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_page_size, 25), 1), 100)
    OFFSET (
      (GREATEST(COALESCE(p_page, 1), 1) - 1)
      * LEAST(GREATEST(COALESCE(p_page_size, 25), 1), 100)
    )
  ),
  month_window AS (
    SELECT (
      date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ) AS starts_at
  )
  SELECT
    page_user.user_id,
    page_user.email,
    page_user.display_name,
    page_user.avatar_url,
    page_user.auth_provider,
    page_user.created_at AS joined_at,
    page_user.last_sign_in_at,
    activity.last_product_activity_at,
    page_user.effective_status AS account_status,
    page_user.effective_suspended_until AS suspended_until,
    page_user.moderation_reason,
    COALESCE(plan.plan_key, 'free') AS current_plan_key,
    GREATEST(
      COALESCE(wallet.spendable_beats, 0) - COALESCE(wallet.pending_beats, 0),
      0
    ) AS available_beats,
    COALESCE(wallet.lifetime_granted_beats, 0) AS lifetime_granted_beats,
    COALESCE(usage.lifetime_consumed_beats, 0) AS lifetime_consumed_beats,
    COALESCE(usage.month_consumed_beats, 0) AS month_consumed_beats,
    COALESCE(wallet.expiring_beats_30d, 0) AS expiring_beats_30d,
    COALESCE(story_stats.in_progress_story_count, 0) AS in_progress_story_count,
    COALESCE(story_stats.finished_story_count, 0) AS finished_story_count,
    COALESCE(publish_stats.published_story_count, 0) AS published_story_count,
    COALESCE(publish_stats.published_path_count, 0) AS published_path_count,
    COALESCE(story_stats.reel_count, 0) AS reel_count,
    (SELECT count(*) FROM status_filtered) AS total_count
  FROM page_users page_user
  CROSS JOIN month_window
  LEFT JOIN LATERAL (
    SELECT pricing_plan.plan_key
    FROM public.billing_subscriptions subscription
    JOIN public.pricing_plan_versions plan_version
      ON plan_version.id = subscription.plan_version_id
    JOIN public.pricing_plans pricing_plan
      ON pricing_plan.id = plan_version.plan_id
    WHERE subscription.user_id = page_user.user_id
      AND (
        (
          lower(subscription.status) IN ('active', 'trialing', 'authenticated')
          AND (
            subscription.current_period_end IS NULL
            OR subscription.current_period_end > now()
          )
        )
        OR (
          lower(subscription.status) IN ('pending', 'halted')
          AND subscription.grace_period_ends_at > now()
        )
      )
    ORDER BY
      subscription.current_period_end DESC NULLS LAST,
      subscription.updated_at DESC
    LIMIT 1
  ) plan ON true
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(grant_row.beats_total), 0) AS lifetime_granted_beats,
      COALESCE(sum(grant_row.beats_remaining) FILTER (
        WHERE grant_row.beats_remaining > 0
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
      ), 0) AS spendable_beats,
      COALESCE(sum(grant_row.beats_remaining) FILTER (
        WHERE grant_row.beats_remaining > 0
          AND grant_row.expires_at > now()
          AND grant_row.expires_at <= now() + interval '30 days'
      ), 0) AS expiring_beats_30d,
      (
        SELECT COALESCE(sum(reservation.requested_beat_cost), 0)
        FROM public.beat_spend_reservations reservation
        WHERE reservation.user_id = page_user.user_id
          AND reservation.status = 'pending'
          AND reservation.expires_at > now()
      ) AS pending_beats
    FROM public.beat_grants grant_row
    WHERE grant_row.user_id = page_user.user_id
  ) wallet ON true
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(usage_event.beat_cost), 0) AS lifetime_consumed_beats,
      COALESCE(sum(usage_event.beat_cost) FILTER (
        WHERE usage_event.created_at >= month_window.starts_at
      ), 0) AS month_consumed_beats
    FROM public.beat_usage_events usage_event
    WHERE usage_event.user_id = page_user.user_id
  ) usage ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE story.story_kind = 'story'
          AND story.status = 'active'
          AND story.is_archived = false
      ) AS in_progress_story_count,
      count(*) FILTER (
        WHERE story.story_kind = 'story'
          AND story.status = 'completed'
          AND story.is_archived = false
      ) AS finished_story_count,
      count(*) FILTER (
        WHERE story.story_kind = 'reel'
          AND story.is_archived = false
      ) AS reel_count
    FROM public.stories story
    WHERE story.user_id = page_user.user_id
  ) story_stats ON true
  LEFT JOIN LATERAL (
    SELECT
      count(DISTINCT storyline.story_id) FILTER (
        WHERE story.story_kind = 'story'
      ) AS published_story_count,
      count(*) FILTER (
        WHERE story.story_kind = 'story'
      ) AS published_path_count
    FROM public.storylines storyline
    JOIN public.stories story ON story.id = storyline.story_id
    WHERE storyline.user_id = page_user.user_id
      AND storyline.visibility IN ('public', 'unlisted')
      AND storyline.moderation_status <> 'rejected'
  ) publish_stats ON true
  LEFT JOIN LATERAL (
    SELECT max(candidate.occurred_at) AS last_product_activity_at
    FROM (
      SELECT max(story.updated_at) AS occurred_at
      FROM public.stories story
      WHERE story.user_id = page_user.user_id
      UNION ALL
      SELECT max(storyline.created_at) AS occurred_at
      FROM public.storylines storyline
      WHERE storyline.user_id = page_user.user_id
      UNION ALL
      SELECT max(usage_event.created_at) AS occurred_at
      FROM public.beat_usage_events usage_event
      WHERE usage_event.user_id = page_user.user_id
    ) candidate
  ) activity ON true;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users(text, text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, text, integer, integer, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_user_management_summary()
RETURNS TABLE (
  total_users bigint,
  active_users bigint,
  suspended_users bigint,
  blocked_users bigint,
  available_beats numeric,
  month_consumed_beats numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH statuses AS (
    SELECT
      directory.user_id,
      CASE
        WHEN moderation.status = 'suspended'
          AND moderation.suspended_until <= now()
          THEN 'active'
        ELSE COALESCE(moderation.status, 'active')
      END AS effective_status
    FROM public.admin_user_directory directory
    LEFT JOIN public.user_account_moderation moderation
      ON moderation.user_id = directory.user_id
  ),
  user_balances AS (
    SELECT
      directory.user_id,
      GREATEST(
        COALESCE((
          SELECT sum(grant_row.beats_remaining)
          FROM public.beat_grants grant_row
          WHERE grant_row.user_id = directory.user_id
            AND grant_row.beats_remaining > 0
            AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
        ), 0)
        -
        COALESCE((
          SELECT sum(reservation.requested_beat_cost)
          FROM public.beat_spend_reservations reservation
          WHERE reservation.user_id = directory.user_id
            AND reservation.status = 'pending'
            AND reservation.expires_at > now()
        ), 0),
        0
      ) AS available
    FROM public.admin_user_directory directory
  )
  SELECT
    count(*) AS total_users,
    count(*) FILTER (WHERE statuses.effective_status = 'active') AS active_users,
    count(*) FILTER (WHERE statuses.effective_status = 'suspended') AS suspended_users,
    count(*) FILTER (WHERE statuses.effective_status = 'blocked') AS blocked_users,
    COALESCE((SELECT sum(user_balances.available) FROM user_balances), 0) AS available_beats,
    COALESCE((
      SELECT sum(usage_event.beat_cost)
      FROM public.beat_usage_events usage_event
      WHERE usage_event.created_at >= (
        date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      )
    ), 0) AS month_consumed_beats
  FROM statuses;
$$;

REVOKE ALL ON FUNCTION public.admin_user_management_summary()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_management_summary()
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_promotional_cohort_candidates(
  p_active_within_days integer,
  p_min_finished_stories integer,
  p_min_published_stories integer,
  p_min_lifetime_consumed_beats numeric,
  p_plan_key text,
  p_excluded_user_id uuid,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  avatar_url text,
  current_plan_key text,
  last_product_activity_at timestamptz,
  finished_story_count bigint,
  published_story_count bigint,
  lifetime_consumed_beats numeric,
  eligible_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH candidate_metrics AS (
    SELECT
      directory.user_id,
      directory.email,
      directory.display_name,
      directory.avatar_url,
      COALESCE(plan.plan_key, 'free') AS current_plan_key,
      activity.last_product_activity_at,
      COALESCE(stories.finished_story_count, 0) AS finished_story_count,
      COALESCE(published.published_story_count, 0) AS published_story_count,
      COALESCE(usage.lifetime_consumed_beats, 0) AS lifetime_consumed_beats,
      CASE
        WHEN moderation.status = 'suspended'
          AND moderation.suspended_until <= now()
          THEN 'active'
        ELSE COALESCE(moderation.status, 'active')
      END AS effective_status
    FROM public.admin_user_directory directory
    LEFT JOIN public.user_account_moderation moderation
      ON moderation.user_id = directory.user_id
    LEFT JOIN LATERAL (
      SELECT pricing_plan.plan_key
      FROM public.billing_subscriptions subscription
      JOIN public.pricing_plan_versions plan_version
        ON plan_version.id = subscription.plan_version_id
      JOIN public.pricing_plans pricing_plan
        ON pricing_plan.id = plan_version.plan_id
      WHERE subscription.user_id = directory.user_id
        AND (
          (
            lower(subscription.status) IN ('active', 'trialing', 'authenticated')
            AND (
              subscription.current_period_end IS NULL
              OR subscription.current_period_end > now()
            )
          )
          OR (
            lower(subscription.status) IN ('pending', 'halted')
            AND subscription.grace_period_ends_at > now()
          )
        )
      ORDER BY
        subscription.current_period_end DESC NULLS LAST,
        subscription.updated_at DESC
      LIMIT 1
    ) plan ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS finished_story_count
      FROM public.stories story
      WHERE story.user_id = directory.user_id
        AND story.story_kind = 'story'
        AND story.status = 'completed'
        AND story.is_archived = false
    ) stories ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT storyline.story_id) AS published_story_count
      FROM public.storylines storyline
      JOIN public.stories story ON story.id = storyline.story_id
      WHERE storyline.user_id = directory.user_id
        AND story.story_kind = 'story'
        AND storyline.visibility IN ('public', 'unlisted')
        AND storyline.moderation_status <> 'rejected'
    ) published ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(usage_event.beat_cost), 0) AS lifetime_consumed_beats
      FROM public.beat_usage_events usage_event
      WHERE usage_event.user_id = directory.user_id
    ) usage ON true
    LEFT JOIN LATERAL (
      SELECT max(candidate.occurred_at) AS last_product_activity_at
      FROM (
        SELECT max(story.updated_at) AS occurred_at
        FROM public.stories story
        WHERE story.user_id = directory.user_id
        UNION ALL
        SELECT max(storyline.created_at) AS occurred_at
        FROM public.storylines storyline
        WHERE storyline.user_id = directory.user_id
        UNION ALL
        SELECT max(usage_event.created_at) AS occurred_at
        FROM public.beat_usage_events usage_event
        WHERE usage_event.user_id = directory.user_id
      ) candidate
    ) activity ON true
  ),
  eligible AS (
    SELECT *
    FROM candidate_metrics
    WHERE effective_status = 'active'
      AND (p_excluded_user_id IS NULL OR user_id <> p_excluded_user_id)
      AND last_product_activity_at >= now() - make_interval(
        days => LEAST(GREATEST(COALESCE(p_active_within_days, 30), 1), 3650)
      )
      AND finished_story_count >= GREATEST(COALESCE(p_min_finished_stories, 0), 0)
      AND published_story_count >= GREATEST(COALESCE(p_min_published_stories, 0), 0)
      AND lifetime_consumed_beats >= GREATEST(COALESCE(p_min_lifetime_consumed_beats, 0), 0)
      AND (
        COALESCE(NULLIF(trim(p_plan_key), ''), 'all') = 'all'
        OR current_plan_key = p_plan_key
      )
  )
  SELECT
    eligible.user_id,
    eligible.email,
    eligible.display_name,
    eligible.avatar_url,
    eligible.current_plan_key,
    eligible.last_product_activity_at,
    eligible.finished_story_count,
    eligible.published_story_count,
    eligible.lifetime_consumed_beats,
    count(*) OVER () AS eligible_count
  FROM eligible
  ORDER BY
    eligible.lifetime_consumed_beats DESC,
    eligible.finished_story_count DESC,
    eligible.user_id
  LIMIT CASE
    WHEN COALESCE(p_limit, 25) <= 0 THEN NULL
    ELSE LEAST(p_limit, 100)
  END;
$$;

REVOKE ALL ON FUNCTION public.admin_promotional_cohort_candidates(
  integer, integer, integer, numeric, text, uuid, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_promotional_cohort_candidates(
  integer, integer, integer, numeric, text, uuid, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_execute_promotional_cohort(
  p_name text,
  p_active_within_days integer,
  p_min_finished_stories integer,
  p_min_published_stories integer,
  p_min_lifetime_consumed_beats numeric,
  p_plan_key text,
  p_actor_user_id uuid,
  p_beat_amount numeric,
  p_coin_amount numeric,
  p_grant_expires_at timestamptz,
  p_max_recipients integer,
  p_request_key text
)
RETURNS TABLE (
  cohort_id uuid,
  eligible_count integer,
  granted_count integer,
  already_applied boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  normalized_name text := trim(COALESCE(p_name, ''));
  normalized_request_key text := trim(COALESCE(p_request_key, ''));
  normalized_plan_key text := COALESCE(NULLIF(trim(p_plan_key), ''), 'all');
  existing_cohort public.admin_promotional_cohorts%ROWTYPE;
  created_cohort public.admin_promotional_cohorts%ROWTYPE;
  candidate record;
  created_grant public.beat_grants%ROWTYPE;
  total_eligible integer := 0;
  total_granted integer := 0;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Actor is required';
  END IF;
  IF length(normalized_name) < 3 OR length(normalized_name) > 120 THEN
    RAISE EXCEPTION 'Cohort name must be between 3 and 120 characters';
  END IF;
  IF length(normalized_request_key) < 8 THEN
    RAISE EXCEPTION 'A stable request key is required';
  END IF;
  IF p_beat_amount IS NULL OR p_beat_amount <= 0 OR p_beat_amount > 1000000 THEN
    RAISE EXCEPTION 'Per-user grant is outside the safety limit';
  END IF;
  IF p_coin_amount IS NULL OR p_coin_amount <= 0 THEN
    RAISE EXCEPTION 'Per-user coin amount must be greater than zero';
  END IF;
  IF p_grant_expires_at IS NOT NULL AND p_grant_expires_at <= now() THEN
    RAISE EXCEPTION 'Grant expiry must be in the future';
  END IF;
  IF COALESCE(p_max_recipients, 0) < 1 OR p_max_recipients > 1000 THEN
    RAISE EXCEPTION 'Maximum recipients must be between 1 and 1000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_request_key, 84));

  SELECT *
  INTO existing_cohort
  FROM public.admin_promotional_cohorts cohort
  WHERE cohort.request_key = normalized_request_key;

  IF existing_cohort.id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      existing_cohort.id,
      existing_cohort.eligible_count,
      existing_cohort.granted_count,
      true;
    RETURN;
  END IF;

  SELECT COALESCE(max(candidate_row.eligible_count), 0)::integer
  INTO total_eligible
  FROM public.admin_promotional_cohort_candidates(
    p_active_within_days,
    p_min_finished_stories,
    p_min_published_stories,
    p_min_lifetime_consumed_beats,
    normalized_plan_key,
    p_actor_user_id,
    1
  ) candidate_row;

  IF total_eligible > p_max_recipients THEN
    RAISE EXCEPTION 'Eligible audience (%) exceeds the approved maximum (%)',
      total_eligible, p_max_recipients;
  END IF;

  INSERT INTO public.admin_promotional_cohorts (
    request_key,
    name,
    rules_json,
    coins_per_user,
    beats_per_user,
    grant_expires_at,
    eligible_count,
    granted_count,
    created_by
  )
  VALUES (
    normalized_request_key,
    normalized_name,
    jsonb_build_object(
      'activeWithinDays', p_active_within_days,
      'minFinishedStories', p_min_finished_stories,
      'minPublishedStories', p_min_published_stories,
      'minLifetimeConsumedBeats', p_min_lifetime_consumed_beats,
      'planKey', normalized_plan_key
    ),
    p_coin_amount,
    p_beat_amount,
    p_grant_expires_at,
    total_eligible,
    0,
    p_actor_user_id
  )
  RETURNING * INTO created_cohort;

  FOR candidate IN
    SELECT *
    FROM public.admin_promotional_cohort_candidates(
      p_active_within_days,
      p_min_finished_stories,
      p_min_published_stories,
      p_min_lifetime_consumed_beats,
      normalized_plan_key,
      p_actor_user_id,
      0
    )
  LOOP
    INSERT INTO public.beat_grants (
      user_id,
      source_type,
      source_ref_id,
      currency_code,
      beats_total,
      beats_remaining,
      expires_at,
      granted_at,
      metadata_json
    )
    VALUES (
      candidate.user_id,
      'promotion',
      'admin_cohort:' || created_cohort.id::text,
      NULL,
      p_beat_amount,
      p_beat_amount,
      p_grant_expires_at,
      now(),
      jsonb_build_object(
        'cohortId', created_cohort.id,
        'cohortName', normalized_name,
        'coinAmount', p_coin_amount,
        'requestKey', normalized_request_key
      )
    )
    RETURNING * INTO created_grant;

    INSERT INTO public.admin_promotional_cohort_members (
      cohort_id,
      user_id,
      grant_id,
      snapshot_json,
      coins_granted
    )
    VALUES (
      created_cohort.id,
      candidate.user_id,
      created_grant.id,
      to_jsonb(candidate) - 'eligible_count',
      p_coin_amount
    );

    INSERT INTO public.admin_user_audit_events (
      target_user_id,
      actor_user_id,
      action_type,
      reason,
      request_key,
      after_json,
      metadata_json
    )
    VALUES (
      candidate.user_id,
      p_actor_user_id,
      'coins_granted',
      'Promotional cohort: ' || normalized_name,
      'cohort:' || created_cohort.id::text || ':' || candidate.user_id::text,
      jsonb_build_object(
        'grant_id', created_grant.id,
        'beats_granted', p_beat_amount,
        'coins_granted', p_coin_amount,
        'expires_at', p_grant_expires_at
      ),
      jsonb_build_object(
        'sourceType', 'promotion',
        'cohortId', created_cohort.id
      )
    );

    total_granted := total_granted + 1;
  END LOOP;

  UPDATE public.admin_promotional_cohorts
  SET granted_count = total_granted
  WHERE id = created_cohort.id;

  INSERT INTO public.admin_user_audit_events (
    target_user_id,
    actor_user_id,
    action_type,
    reason,
    request_key,
    after_json
  )
  VALUES (
    NULL,
    p_actor_user_id,
    'cohort_executed',
    'Promotional cohort executed: ' || normalized_name,
    normalized_request_key,
    jsonb_build_object(
      'cohort_id', created_cohort.id,
      'eligible_count', total_eligible,
      'granted_count', total_granted,
      'coins_per_user', p_coin_amount
    )
  );

  RETURN QUERY
  SELECT created_cohort.id, total_eligible, total_granted, false;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_execute_promotional_cohort(
  text, integer, integer, integer, numeric, text, uuid, numeric, numeric,
  timestamptz, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_execute_promotional_cohort(
  text, integer, integer, integer, numeric, text, uuid, numeric, numeric,
  timestamptz, integer, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_user_moderation(
  p_target_user_id uuid,
  p_status text,
  p_suspended_until timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS TABLE (
  user_id uuid,
  status text,
  suspended_until timestamptz,
  reason text,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  previous_row public.user_account_moderation%ROWTYPE;
  next_row public.user_account_moderation%ROWTYPE;
  action_key text;
  normalized_reason text := trim(COALESCE(p_reason, ''));
BEGIN
  IF p_target_user_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user and actor are required';
  END IF;
  IF p_target_user_id = p_actor_user_id THEN
    RAISE EXCEPTION 'An administrator cannot moderate their own account';
  END IF;
  IF p_status NOT IN ('active', 'suspended', 'blocked') THEN
    RAISE EXCEPTION 'Unsupported moderation status';
  END IF;
  IF length(normalized_reason) < 3 THEN
    RAISE EXCEPTION 'A moderation reason of at least 3 characters is required';
  END IF;
  IF p_status = 'suspended' AND (p_suspended_until IS NULL OR p_suspended_until <= now()) THEN
    RAISE EXCEPTION 'A future suspension end time is required';
  END IF;
  IF p_status <> 'suspended' AND p_suspended_until IS NOT NULL THEN
    RAISE EXCEPTION 'Only suspended accounts may have an end time';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_user_directory directory
    WHERE directory.user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Target user does not exist';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_target_user_id::text, 83));

  SELECT *
  INTO previous_row
  FROM public.user_account_moderation moderation
  WHERE moderation.user_id = p_target_user_id;

  INSERT INTO public.user_account_moderation (
    user_id,
    status,
    suspended_until,
    reason,
    updated_by,
    created_at,
    updated_at
  )
  VALUES (
    p_target_user_id,
    p_status,
    CASE WHEN p_status = 'suspended' THEN p_suspended_until ELSE NULL END,
    normalized_reason,
    p_actor_user_id,
    now(),
    now()
  )
  ON CONFLICT ON CONSTRAINT user_account_moderation_pkey DO UPDATE
  SET
    status = EXCLUDED.status,
    suspended_until = EXCLUDED.suspended_until,
    reason = EXCLUDED.reason,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING * INTO next_row;

  action_key := CASE p_status
    WHEN 'suspended' THEN 'account_suspended'
    WHEN 'blocked' THEN 'account_blocked'
    ELSE 'account_reactivated'
  END;

  INSERT INTO public.admin_user_audit_events (
    target_user_id,
    actor_user_id,
    action_type,
    reason,
    before_json,
    after_json
  )
  VALUES (
    p_target_user_id,
    p_actor_user_id,
    action_key,
    normalized_reason,
    CASE WHEN previous_row.user_id IS NULL THEN NULL ELSE to_jsonb(previous_row) END,
    to_jsonb(next_row)
  );

  RETURN QUERY
  SELECT
    next_row.user_id,
    next_row.status,
    next_row.suspended_until,
    next_row.reason,
    next_row.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_moderation(uuid, text, timestamptz, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_moderation(uuid, text, timestamptz, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_grant_user_coins(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_beat_amount numeric,
  p_coin_amount numeric,
  p_reason text,
  p_expires_at timestamptz,
  p_request_key text
)
RETURNS TABLE (
  grant_id uuid,
  beats_granted numeric,
  already_applied boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  normalized_reason text := trim(COALESCE(p_reason, ''));
  normalized_request_key text := trim(COALESCE(p_request_key, ''));
  existing_event public.admin_user_audit_events%ROWTYPE;
  created_grant public.beat_grants%ROWTYPE;
BEGIN
  IF p_target_user_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user and actor are required';
  END IF;
  IF p_beat_amount IS NULL OR p_beat_amount <= 0 OR p_beat_amount > 1000000 THEN
    RAISE EXCEPTION 'Beat grant amount must be greater than zero and within the safety limit';
  END IF;
  IF p_coin_amount IS NULL OR p_coin_amount <= 0 THEN
    RAISE EXCEPTION 'Coin grant amount must be greater than zero';
  END IF;
  IF length(normalized_reason) < 3 THEN
    RAISE EXCEPTION 'A grant reason of at least 3 characters is required';
  END IF;
  IF length(normalized_request_key) < 8 THEN
    RAISE EXCEPTION 'A stable request key is required';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'Coin expiry must be in the future';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_user_directory directory
    WHERE directory.user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Target user does not exist';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_request_key, 83));

  SELECT *
  INTO existing_event
  FROM public.admin_user_audit_events audit_event
  WHERE audit_event.request_key = normalized_request_key;

  IF existing_event.id IS NOT NULL THEN
    IF existing_event.target_user_id IS DISTINCT FROM p_target_user_id
      OR existing_event.action_type <> 'coins_granted' THEN
      RAISE EXCEPTION 'Request key has already been used for another operation';
    END IF;

    RETURN QUERY
    SELECT
      (existing_event.after_json->>'grant_id')::uuid,
      COALESCE((existing_event.after_json->>'beats_granted')::numeric, p_beat_amount),
      true;
    RETURN;
  END IF;

  INSERT INTO public.beat_grants (
    user_id,
    source_type,
    source_ref_id,
    currency_code,
    beats_total,
    beats_remaining,
    expires_at,
    granted_at,
    metadata_json
  )
  VALUES (
    p_target_user_id,
    'admin_adjustment',
    'admin_user_grant:' || normalized_request_key,
    NULL,
    p_beat_amount,
    p_beat_amount,
    p_expires_at,
    now(),
    jsonb_build_object(
      'coinAmount', p_coin_amount,
      'reason', normalized_reason,
      'actorUserId', p_actor_user_id,
      'requestKey', normalized_request_key
    )
  )
  RETURNING * INTO created_grant;

  INSERT INTO public.admin_user_audit_events (
    target_user_id,
    actor_user_id,
    action_type,
    reason,
    request_key,
    after_json,
    metadata_json
  )
  VALUES (
    p_target_user_id,
    p_actor_user_id,
    'coins_granted',
    normalized_reason,
    normalized_request_key,
    jsonb_build_object(
      'grant_id', created_grant.id,
      'beats_granted', p_beat_amount,
      'coins_granted', p_coin_amount,
      'expires_at', p_expires_at
    ),
    jsonb_build_object('sourceType', 'admin_adjustment')
  );

  RETURN QUERY
  SELECT created_grant.id, p_beat_amount, false;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_user_coins(
  uuid, uuid, numeric, numeric, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_user_coins(
  uuid, uuid, numeric, numeric, text, timestamptz, text
) TO service_role;
