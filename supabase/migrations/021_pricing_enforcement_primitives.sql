-- 021_pricing_enforcement_primitives.sql
-- Add free monthly allowance grants, admin bypass runtime control,
-- and atomic reservation helpers for spend enforcement.

ALTER TABLE public.beat_grants
  DROP CONSTRAINT IF EXISTS beat_grants_source_type_check;

ALTER TABLE public.beat_grants
  ADD CONSTRAINT beat_grants_source_type_check
  CHECK (
    source_type IN (
      'subscription',
      'carry_forward',
      'topup',
      'promotion',
      'admin_adjustment',
      'migration_grant',
      'free_allowance'
    )
  );

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('pricing_admin_bypass_enabled', false, null)
ON CONFLICT (flag_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.pricing_authorize_spend(
  p_user_id uuid,
  p_action_key text,
  p_requested_beat_cost integer,
  p_idempotency_key text,
  p_related_story_id uuid DEFAULT NULL,
  p_related_node_id text DEFAULT NULL,
  p_related_storyline_id uuid DEFAULT NULL,
  p_expires_at timestamptz DEFAULT (now() + interval '30 minutes'),
  p_metadata_json jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  reservation_id uuid,
  reservation_status text,
  available_beats integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  existing_reservation public.beat_spend_reservations%ROWTYPE;
  grant_row public.beat_grants%ROWTYPE;
  pending_row public.beat_spend_reservations%ROWTYPE;
  spendable_total integer := 0;
  pending_total integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'pricing_authorize_spend requires p_user_id';
  END IF;

  IF p_requested_beat_cost <= 0 THEN
    RAISE EXCEPTION 'pricing_authorize_spend requires a positive beat cost';
  END IF;

  SELECT *
  INTO existing_reservation
  FROM public.beat_spend_reservations
  WHERE user_id = p_user_id
    AND idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    reservation_id := existing_reservation.id;
    reservation_status := existing_reservation.status;
    available_beats := GREATEST(existing_reservation.requested_beat_cost, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  FOR grant_row IN
    SELECT *
    FROM public.beat_grants
    WHERE user_id = p_user_id
      AND beats_remaining > 0
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY
      CASE
        WHEN source_type = 'promotion' THEN 1
        WHEN source_type IN ('subscription', 'carry_forward', 'admin_adjustment', 'migration_grant', 'free_allowance') THEN 2
        WHEN source_type = 'topup' THEN 3
        ELSE 4
      END,
      COALESCE(expires_at, '9999-12-31T00:00:00Z'::timestamptz),
      granted_at,
      id
    FOR UPDATE
  LOOP
    spendable_total := spendable_total + grant_row.beats_remaining;
  END LOOP;

  FOR pending_row IN
    SELECT *
    FROM public.beat_spend_reservations
    WHERE user_id = p_user_id
      AND status = 'pending'
      AND expires_at > now()
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    pending_total := pending_total + pending_row.requested_beat_cost;
  END LOOP;

  available_beats := GREATEST(0, spendable_total - pending_total);

  IF available_beats < p_requested_beat_cost THEN
    reservation_id := NULL;
    reservation_status := 'insufficient_balance';
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.beat_spend_reservations (
    user_id,
    action_key,
    requested_beat_cost,
    status,
    idempotency_key,
    related_story_id,
    related_node_id,
    related_storyline_id,
    expires_at,
    metadata_json
  )
  VALUES (
    p_user_id,
    p_action_key,
    p_requested_beat_cost,
    'pending',
    p_idempotency_key,
    p_related_story_id,
    p_related_node_id,
    p_related_storyline_id,
    p_expires_at,
    COALESCE(p_metadata_json, '{}'::jsonb)
  )
  RETURNING id INTO reservation_id;

  reservation_status := 'pending';
  available_beats := available_beats - p_requested_beat_cost;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.pricing_finalize_reservation(
  p_reservation_id uuid,
  p_user_id uuid,
  p_story_id uuid DEFAULT NULL,
  p_storyline_id uuid DEFAULT NULL,
  p_related_entity_id text DEFAULT NULL,
  p_metadata_json jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  usage_event_id uuid,
  finalized_beat_cost integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  reservation_row public.beat_spend_reservations%ROWTYPE;
  grant_row public.beat_grants%ROWTYPE;
  remaining_needed integer := 0;
  beats_to_consume integer := 0;
BEGIN
  IF p_reservation_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'pricing_finalize_reservation requires reservation and user ids';
  END IF;

  SELECT *
  INTO reservation_row
  FROM public.beat_spend_reservations
  WHERE id = p_reservation_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found';
  END IF;

  IF reservation_row.status = 'finalized' AND reservation_row.usage_event_id IS NOT NULL THEN
    usage_event_id := reservation_row.usage_event_id;
    finalized_beat_cost := reservation_row.requested_beat_cost;
    RETURN NEXT;
    RETURN;
  END IF;

  IF reservation_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Reservation is not pending';
  END IF;

  IF reservation_row.expires_at <= now() THEN
    UPDATE public.beat_spend_reservations
    SET
      status = 'expired',
      updated_at = now(),
      metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object('expiredAt', now())
    WHERE id = reservation_row.id;

    RAISE EXCEPTION 'Reservation expired';
  END IF;

  INSERT INTO public.beat_usage_events (
    user_id,
    action_key,
    beat_cost,
    story_id,
    storyline_id,
    related_entity_id,
    metadata_json
  )
  VALUES (
    p_user_id,
    reservation_row.action_key,
    reservation_row.requested_beat_cost,
    COALESCE(p_story_id, reservation_row.related_story_id),
    COALESCE(p_storyline_id, reservation_row.related_storyline_id),
    COALESCE(p_related_entity_id, reservation_row.related_node_id),
    COALESCE(reservation_row.metadata_json, '{}'::jsonb) || COALESCE(p_metadata_json, '{}'::jsonb)
  )
  RETURNING id INTO usage_event_id;

  remaining_needed := reservation_row.requested_beat_cost;

  FOR grant_row IN
    SELECT *
    FROM public.beat_grants
    WHERE user_id = p_user_id
      AND beats_remaining > 0
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY
      CASE
        WHEN source_type = 'promotion' THEN 1
        WHEN source_type IN ('subscription', 'carry_forward', 'admin_adjustment', 'migration_grant', 'free_allowance') THEN 2
        WHEN source_type = 'topup' THEN 3
        ELSE 4
      END,
      COALESCE(expires_at, '9999-12-31T00:00:00Z'::timestamptz),
      granted_at,
      id
    FOR UPDATE
  LOOP
    EXIT WHEN remaining_needed <= 0;

    beats_to_consume := LEAST(grant_row.beats_remaining, remaining_needed);
    IF beats_to_consume <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.beat_grants
    SET beats_remaining = beats_remaining - beats_to_consume
    WHERE id = grant_row.id;

    INSERT INTO public.beat_usage_allocations (
      usage_event_id,
      beat_grant_id,
      beats_consumed
    )
    VALUES (
      usage_event_id,
      grant_row.id,
      beats_to_consume
    );

    remaining_needed := remaining_needed - beats_to_consume;
  END LOOP;

  IF remaining_needed > 0 THEN
    RAISE EXCEPTION 'Not enough spendable beats remain to finalize this reservation';
  END IF;

  UPDATE public.beat_spend_reservations
  SET
    status = 'finalized',
    usage_event_id = usage_event_id,
    related_story_id = COALESCE(p_story_id, related_story_id),
    related_storyline_id = COALESCE(p_storyline_id, related_storyline_id),
    related_node_id = COALESCE(p_related_entity_id, related_node_id),
    metadata_json = COALESCE(metadata_json, '{}'::jsonb) || COALESCE(p_metadata_json, '{}'::jsonb),
    updated_at = now()
  WHERE id = reservation_row.id;

  finalized_beat_cost := reservation_row.requested_beat_cost;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.pricing_release_reservation(
  p_reservation_id uuid,
  p_user_id uuid,
  p_release_status text DEFAULT 'released',
  p_reason text DEFAULT NULL,
  p_metadata_json jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  released boolean,
  final_status text
)
LANGUAGE plpgsql
AS $$
DECLARE
  reservation_row public.beat_spend_reservations%ROWTYPE;
BEGIN
  IF p_release_status NOT IN ('released', 'failed', 'expired') THEN
    RAISE EXCEPTION 'Invalid reservation release status: %', p_release_status;
  END IF;

  SELECT *
  INTO reservation_row
  FROM public.beat_spend_reservations
  WHERE id = p_reservation_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    released := false;
    final_status := 'missing';
    RETURN NEXT;
    RETURN;
  END IF;

  IF reservation_row.status <> 'pending' THEN
    released := false;
    final_status := reservation_row.status;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.beat_spend_reservations
  SET
    status = p_release_status,
    updated_at = now(),
    metadata_json =
      COALESCE(metadata_json, '{}'::jsonb)
      || COALESCE(p_metadata_json, '{}'::jsonb)
      || CASE
        WHEN p_reason IS NOT NULL THEN jsonb_build_object('releaseReason', p_reason)
        ELSE '{}'::jsonb
      END
  WHERE id = reservation_row.id;

  released := true;
  final_status := p_release_status;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.pricing_expire_stale_reservations()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  expired_count integer := 0;
BEGIN
  UPDATE public.beat_spend_reservations
  SET
    status = 'expired',
    updated_at = now(),
    metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object('expiredAt', now())
  WHERE status = 'pending'
    AND expires_at <= now();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;
