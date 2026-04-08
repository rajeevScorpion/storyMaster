-- 022_fix_pricing_finalize_reservation_ambiguity_rollback.sql
-- Restore the pre-022 pricing_finalize_reservation definition.

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
