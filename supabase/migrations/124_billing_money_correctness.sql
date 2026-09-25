-- 124_billing_money_correctness.sql
--
-- Payments Phase 1 (docs/payments/phase-1-plan.md): one grant per purchase, retryable webhooks, test/live-safe
-- provider references, purchase snapshots, and one in-progress subscription checkout per user.
--
-- Precheck (must return no rows, or the unique index fails):
--   select source_type, source_ref_id, count(*) from public.beat_grants
--   where source_type in ('subscription','topup') and source_ref_id is not null group by 1,2 having count(*) > 1;
--
-- Trap: existing billing rows and plan refs are backfilled as 'test'. That is only true while no live Razorpay key
-- has ever been configured in this environment — confirm before applying on prod.
--
-- Verify: select indexname from pg_indexes where indexname = 'uq_beat_grants_purchase_source';

CREATE UNIQUE INDEX IF NOT EXISTS uq_beat_grants_purchase_source
  ON public.beat_grants (source_type, source_ref_id)
  WHERE source_type IN ('subscription', 'topup') AND source_ref_id IS NOT NULL;

ALTER TABLE public.billing_orders
  ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL DEFAULT 'test' CHECK (provider_mode IN ('test', 'live')),
  ADD COLUMN IF NOT EXISTS purchase_snapshot_json jsonb;
ALTER TABLE public.billing_orders ALTER COLUMN provider_mode DROP DEFAULT;

ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL DEFAULT 'test' CHECK (provider_mode IN ('test', 'live')),
  ADD COLUMN IF NOT EXISTS first_charge_confirmed_at timestamptz;
ALTER TABLE public.billing_subscriptions ALTER COLUMN provider_mode DROP DEFAULT;

ALTER TABLE public.pricing_plan_versions
  ADD COLUMN IF NOT EXISTS provider_price_ref_mode text CHECK (provider_price_ref_mode IN ('test', 'live'));
UPDATE public.pricing_plan_versions
SET provider_price_ref_mode = 'test'
WHERE provider_price_ref IS NOT NULL AND provider_price_ref_mode IS NULL;

ALTER TABLE public.billing_webhook_events
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome text;

CREATE INDEX IF NOT EXISTS idx_billing_orders_reconcile
  ON public.billing_orders (provider, provider_mode, order_type, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.billing_begin_subscription_checkout(
  p_user_id uuid,
  p_plan_version_id uuid,
  p_provider_mode text,
  p_snapshot jsonb
)
RETURNS TABLE (
  order_id uuid,
  reused boolean,
  provider_checkout_session_id text,
  superseded_session_ids text[],
  blocked_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Razorpay's expire_by is 30 minutes, so an older checkout can't be paid; reuse stops at 20 so the payer has time.
  v_stale_after constant interval := interval '30 minutes';
  v_reuse_within constant interval := interval '20 minutes';
  v_preparing_timeout constant interval := interval '2 minutes';
  v_version public.pricing_plan_versions%ROWTYPE;
  v_open public.billing_orders%ROWTYPE;
  v_superseded text[] := ARRAY[]::text[];
  v_order_id uuid;
BEGIN
  IF p_provider_mode NOT IN ('test', 'live') THEN
    RAISE EXCEPTION 'Invalid provider mode %', p_provider_mode;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('billing_subscription_checkout:' || p_user_id::text, 0));

  IF EXISTS (
    SELECT 1 FROM public.billing_subscriptions
    WHERE user_id = p_user_id
      AND provider = 'razorpay'
      AND status IN ('authenticated', 'active', 'pending', 'halted')
  ) THEN
    RETURN QUERY SELECT NULL::uuid, false, NULL::text, v_superseded, 'subscription_exists'::text;
    RETURN;
  END IF;

  UPDATE public.billing_orders
  SET status = 'abandoned', updated_at = now()
  WHERE user_id = p_user_id
    AND provider = 'razorpay'
    AND order_type = 'subscription_checkout'
    AND (
      (status = 'created' AND created_at <= now() - v_stale_after)
      OR (status = 'preparing' AND created_at <= now() - v_preparing_timeout)
    );

  SELECT * INTO v_open
  FROM public.billing_orders
  WHERE user_id = p_user_id
    AND provider = 'razorpay'
    AND order_type = 'subscription_checkout'
    AND status IN ('preparing', 'created')
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_open.provider_checkout_session_id IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, false, NULL::text, v_superseded, 'checkout_in_progress'::text;
      RETURN;
    END IF;

    IF v_open.plan_version_id = p_plan_version_id
      AND v_open.provider_mode = p_provider_mode
      AND v_open.created_at > now() - v_reuse_within THEN
      RETURN QUERY SELECT v_open.id, true, v_open.provider_checkout_session_id, v_superseded, NULL::text;
      RETURN;
    END IF;

    WITH superseded AS (
      UPDATE public.billing_orders
      SET status = 'superseded', updated_at = now()
      WHERE user_id = p_user_id
        AND provider = 'razorpay'
        AND order_type = 'subscription_checkout'
        AND status = 'created'
      RETURNING provider_checkout_session_id
    )
    SELECT coalesce(array_agg(provider_checkout_session_id) FILTER (WHERE provider_checkout_session_id IS NOT NULL), ARRAY[]::text[])
    INTO v_superseded
    FROM superseded;
  END IF;

  SELECT * INTO v_version FROM public.pricing_plan_versions WHERE id = p_plan_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan version % not found', p_plan_version_id;
  END IF;

  INSERT INTO public.billing_orders (
    user_id, provider, provider_mode, order_type, currency_code, amount_minor, status,
    plan_version_id, purchase_snapshot_json
  )
  VALUES (
    p_user_id, 'razorpay', p_provider_mode, 'subscription_checkout', v_version.currency_code, v_version.price_minor,
    'preparing', v_version.id, p_snapshot
  )
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_order_id, false, NULL::text, v_superseded, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_begin_subscription_checkout(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_begin_subscription_checkout(uuid, uuid, text, jsonb) TO service_role;

INSERT INTO public.feature_flags (flag_key, enabled)
VALUES ('billing_reconcile_enabled', false)
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (124, '124_billing_money_correctness.sql')
ON CONFLICT (migration_number) DO NOTHING;
