-- Rollback for 130_subscription_checkout_provider_mode.sql
--
-- Restores 124's function verbatim, which means restoring the cross-mode block: a user holding a
-- test-mode subscription is refused a live one again. Only roll back with that in mind.

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

DELETE FROM public.schema_migration_ledger WHERE migration_number = 130;
