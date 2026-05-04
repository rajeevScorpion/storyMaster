-- 040_fractional_action_costs.sql
-- Allow action costs smaller than one internal beat, so whole-coin values like 5 coins
-- persist as 0.5 beats and can flow through reservations, usage, and wallet balances.

DROP FUNCTION IF EXISTS public.pricing_authorize_spend(
  uuid,
  text,
  integer,
  text,
  uuid,
  text,
  uuid,
  timestamptz,
  jsonb
);

DROP FUNCTION IF EXISTS public.pricing_finalize_reservation(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb
);

ALTER TABLE public.pricing_action_costs
  ALTER COLUMN beat_cost TYPE numeric(12,2) USING beat_cost::numeric(12,2);

ALTER TABLE public.beat_grants
  ALTER COLUMN beats_total TYPE numeric(12,2) USING beats_total::numeric(12,2),
  ALTER COLUMN beats_remaining TYPE numeric(12,2) USING beats_remaining::numeric(12,2);

ALTER TABLE public.beat_usage_events
  ALTER COLUMN beat_cost TYPE numeric(12,2) USING beat_cost::numeric(12,2);

ALTER TABLE public.beat_spend_reservations
  ALTER COLUMN requested_beat_cost TYPE numeric(12,2) USING requested_beat_cost::numeric(12,2);

ALTER TABLE public.beat_usage_allocations
  ALTER COLUMN beats_consumed TYPE numeric(12,2) USING beats_consumed::numeric(12,2);

UPDATE public.pricing_action_costs
SET
  beat_cost = 0.5,
  updated_at = now()
WHERE action_key IN (
    'start_story_initial_beat_prompt_only',
    'continue_story_new_beat_prompt_only'
  )
  AND beat_cost = 1
  AND updated_by IS NULL;

CREATE OR REPLACE FUNCTION public.pricing_authorize_spend(
  p_user_id uuid,
  p_action_key text,
  p_requested_beat_cost numeric,
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
  available_beats numeric
)
LANGUAGE plpgsql
AS $$
DECLARE
  existing_reservation public.beat_spend_reservations%ROWTYPE;
  grant_row public.beat_grants%ROWTYPE;
  pending_row public.beat_spend_reservations%ROWTYPE;
  spendable_total numeric := 0;
  pending_total numeric := 0;
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
  finalized_beat_cost numeric
)
LANGUAGE plpgsql
AS $$
DECLARE
  reservation_row public.beat_spend_reservations%ROWTYPE;
  grant_row public.beat_grants%ROWTYPE;
  remaining_needed numeric := 0;
  beats_to_consume numeric := 0;
  v_usage_event_id uuid;
  v_finalized_beat_cost numeric;
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
  RETURNING id INTO v_usage_event_id;

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
      v_usage_event_id,
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
    usage_event_id = v_usage_event_id,
    related_story_id = COALESCE(p_story_id, related_story_id),
    related_storyline_id = COALESCE(p_storyline_id, related_storyline_id),
    related_node_id = COALESCE(p_related_entity_id, related_node_id),
    metadata_json = COALESCE(metadata_json, '{}'::jsonb) || COALESCE(p_metadata_json, '{}'::jsonb),
    updated_at = now()
  WHERE id = reservation_row.id;

  v_finalized_beat_cost := reservation_row.requested_beat_cost;
  usage_event_id := v_usage_event_id;
  finalized_beat_cost := v_finalized_beat_cost;
  RETURN NEXT;
END;
$$;
