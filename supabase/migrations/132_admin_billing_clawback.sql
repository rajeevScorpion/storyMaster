-- 132_admin_billing_clawback.sql
--
-- Payments Phase 4 Unit C (docs/payments/phase-4-plan.md decision 12): claws back a purchase's
-- unspent beat_grants balance so an admin refund can debit coins before Razorpay is ever called.
-- Modeled on admin_grant_user_coins (083_admin_user_management.sql:1071) -- same advisory-lock +
-- request-key idempotency shape. New salt 85: 83 is coin grants and the target-user moderation
-- lock, 84 is cohorts -- both taken, verified by reading 083's function bodies.
--
-- One function serves both directions (p_direction 'clawback' | 'restore'): a Razorpay call that
-- fails after a successful clawback must put the coins back, and reusing this same idempotent
-- primitive for that compensating write is safer than a second hand-rolled UPDATE. Both directions
-- audit as 'coins_clawed_back' -- 131's fixed vocabulary has no separate "restored" verb, so
-- metadata_json.direction carries the distinction rather than widening a frozen CHECK for one
-- internal case.
--
-- Verify: select proname from pg_proc where proname = 'admin_adjust_purchase_grant_beats';

CREATE OR REPLACE FUNCTION public.admin_adjust_purchase_grant_beats(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_grant_id uuid,
  p_delta_beats numeric,
  p_direction text,
  p_reason text,
  p_request_key text
)
RETURNS TABLE (
  grant_id uuid,
  beats_remaining numeric,
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
  target_grant public.beat_grants%ROWTYPE;
  new_remaining numeric;
BEGIN
  IF p_target_user_id IS NULL OR p_actor_user_id IS NULL OR p_grant_id IS NULL THEN
    RAISE EXCEPTION 'Target user, actor and grant are required';
  END IF;
  IF p_direction NOT IN ('clawback', 'restore') THEN
    RAISE EXCEPTION 'Unsupported adjustment direction';
  END IF;
  IF p_delta_beats IS NULL OR p_delta_beats = 0 THEN
    RAISE EXCEPTION 'Adjustment amount must be non-zero';
  END IF;
  IF p_direction = 'clawback' AND p_delta_beats > 0 THEN
    RAISE EXCEPTION 'A clawback must reduce the grant';
  END IF;
  IF p_direction = 'restore' AND p_delta_beats < 0 THEN
    RAISE EXCEPTION 'A restore must increase the grant';
  END IF;
  IF length(normalized_reason) < 3 THEN
    RAISE EXCEPTION 'A reason of at least 3 characters is required';
  END IF;
  IF length(normalized_request_key) < 8 THEN
    RAISE EXCEPTION 'A stable request key is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_request_key, 85));

  SELECT *
  INTO existing_event
  FROM public.admin_user_audit_events audit_event
  WHERE audit_event.request_key = normalized_request_key;

  IF existing_event.id IS NOT NULL THEN
    IF existing_event.target_user_id IS DISTINCT FROM p_target_user_id
      OR existing_event.action_type <> 'coins_clawed_back' THEN
      RAISE EXCEPTION 'Request key has already been used for another operation';
    END IF;

    RETURN QUERY
    SELECT
      (existing_event.after_json->>'grantId')::uuid,
      (existing_event.after_json->>'beatsRemainingAfter')::numeric,
      true;
    RETURN;
  END IF;

  SELECT *
  INTO target_grant
  FROM public.beat_grants
  WHERE id = p_grant_id AND user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grant not found for this user';
  END IF;

  new_remaining := target_grant.beats_remaining + p_delta_beats;
  IF new_remaining < 0 OR new_remaining > target_grant.beats_total THEN
    RAISE EXCEPTION 'Adjustment would move the grant outside its valid range';
  END IF;

  UPDATE public.beat_grants
  SET beats_remaining = new_remaining
  WHERE id = p_grant_id;

  INSERT INTO public.admin_user_audit_events (
    target_user_id, actor_user_id, action_type, reason, request_key, before_json, after_json, metadata_json
  ) VALUES (
    p_target_user_id,
    p_actor_user_id,
    'coins_clawed_back',
    normalized_reason,
    normalized_request_key,
    jsonb_build_object(
      'grantId', target_grant.id,
      'beatsRemainingBefore', target_grant.beats_remaining,
      'beatsTotal', target_grant.beats_total
    ),
    jsonb_build_object(
      'grantId', target_grant.id,
      'beatsRemainingAfter', new_remaining,
      'deltaBeats', p_delta_beats
    ),
    jsonb_build_object('direction', p_direction)
  );

  RETURN QUERY SELECT target_grant.id, new_remaining, false;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_purchase_grant_beats(
  uuid, uuid, uuid, numeric, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_purchase_grant_beats(
  uuid, uuid, uuid, numeric, text, text, text
) TO service_role;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (132, '132_admin_billing_clawback.sql')
ON CONFLICT (migration_number) DO NOTHING;
