-- 096_user_entitlement_tier_overrides.sql
-- Per-user entitlement tier promotions, so an admin can unlock tier-gated
-- features (storyboard images, HD export, tier-gated image models) for an
-- account that has no subscription.
--
-- Deliberately separate from billing: this table grants NO coins, changes no
-- wallet balance, and creates no subscription. Promoted users pay the same
-- coins per action and are still denied when their wallet runs dry. Billing
-- truth stays in billing_subscriptions / pricing_plan_versions.
--
-- Resolution is promote-only in the app layer: effective tier is the higher of
-- the billing plan and this override, so a paying Plus user set to 'free' keeps
-- Plus and simply loses the promotion.

CREATE TABLE IF NOT EXISTS public.user_entitlement_overrides (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  entitlement_plan_key text NOT NULL
    CHECK (entitlement_plan_key IN ('free', 'plus', 'studio')),
  reason text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_entitlement_overrides IS
  'Admin-granted feature entitlement tier. Access only — never coins, wallet, or billing state.';

-- 'free' rows carry no promotion; the app clears them instead of storing them,
-- so this index keeps lookups of actual promotions small.
CREATE INDEX IF NOT EXISTS idx_user_entitlement_overrides_tier
  ON public.user_entitlement_overrides (entitlement_plan_key)
  WHERE entitlement_plan_key <> 'free';

ALTER TABLE public.user_entitlement_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_entitlement_overrides FROM anon, authenticated;
GRANT ALL ON TABLE public.user_entitlement_overrides TO service_role;

-- Intentionally no end-user policies: reads happen through the service-role
-- pricing loader, writes only after verifyAdmin() in the application.

-- Record tier changes in the same immutable history as suspensions and grants.
-- The 083 constraint was declared inline, so drop it by what it checks rather
-- than by a name Postgres happened to generate.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'admin_user_audit_events'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%cohort_executed%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.admin_user_audit_events DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.admin_user_audit_events
  ADD CONSTRAINT admin_user_audit_events_action_type_check CHECK (
    action_type IN (
      'account_suspended',
      'account_blocked',
      'account_reactivated',
      'coins_granted',
      'cohort_executed',
      'entitlement_tier_changed'
    )
  );
