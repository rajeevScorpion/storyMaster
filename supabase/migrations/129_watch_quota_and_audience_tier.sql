-- 129_watch_quota_and_audience_tier.sql
--
-- Payments Phase 3. Two things the Audience tier and the Free daily watch quota cannot ship without.
--
-- The CHECKs: both hardcode free/plus/studio, so without widening them an admin cannot promote anyone
-- to Audience at all (23514 on the upsert in app/actions/admin-users.ts), and no reel style can be
-- gated to it. pricing_plans.plan_key has no CHECK, so the Audience row itself is catalogue data and
-- is deliberately not created here.
--
-- The quota: unique (user_id, local_day, storyline_id) is what makes "replays are free all day" a
-- constraint rather than application logic, and what makes two devices at the last slot safe.
-- local_day is an IST calendar day supplied by the caller (owner decision 11) -- deliberately not
-- computed from now() here, so the server's timezone can never silently redefine a user's day.
--
-- Trap: do not reuse storyline_views for this. It is UNIQUE(user_id, storyline_id) for a LIFETIME
-- view, so a replay on a later day writes no row and it can never count a day.
--
-- Verify: select public.consume_watch_slot('<user uuid>'::uuid, current_date, '<storyline uuid>'::uuid, 3);
--   twice -- the second call must return is_replay true and leave `used` unchanged.

ALTER TABLE public.user_entitlement_overrides
  DROP CONSTRAINT IF EXISTS user_entitlement_overrides_entitlement_plan_key_check;
ALTER TABLE public.user_entitlement_overrides
  ADD CONSTRAINT user_entitlement_overrides_entitlement_plan_key_check
  CHECK (entitlement_plan_key IN ('free', 'audience', 'plus', 'studio'));

ALTER TABLE public.reel_visual_styles
  DROP CONSTRAINT IF EXISTS reel_visual_styles_min_plan_check;
ALTER TABLE public.reel_visual_styles
  ADD CONSTRAINT reel_visual_styles_min_plan_check
  CHECK (min_plan IN ('free', 'audience', 'plus', 'studio'));

CREATE TABLE IF NOT EXISTS public.user_daily_watch_slots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  storyline_id uuid NOT NULL REFERENCES public.storylines(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_daily_watch_slots_unique UNIQUE (user_id, local_day, storyline_id)
);

CREATE INDEX IF NOT EXISTS user_daily_watch_slots_user_day_idx
  ON public.user_daily_watch_slots (user_id, local_day);

-- Service-role only, like every Phase 2 billing table: a client that could read its own rows could
-- also count them, which is not the same as being allowed to spend one.
ALTER TABLE public.user_daily_watch_slots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_watch_slot(
  p_user_id uuid,
  p_local_day date,
  p_storyline_id uuid,
  p_limit integer
)
RETURNS TABLE (allowed boolean, used integer, is_replay boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted uuid;
  v_used integer;
BEGIN
  INSERT INTO public.user_daily_watch_slots (user_id, local_day, storyline_id)
  VALUES (p_user_id, p_local_day, p_storyline_id)
  ON CONFLICT (user_id, local_day, storyline_id) DO NOTHING
  RETURNING id INTO v_inserted;

  SELECT count(*)::integer INTO v_used
  FROM public.user_daily_watch_slots
  WHERE user_id = p_user_id AND local_day = p_local_day;

  -- Already watched today: free, and never counted twice (owner decision 3).
  IF v_inserted IS NULL THEN
    RETURN QUERY SELECT true, v_used, true;
    RETURN;
  END IF;

  -- The slot was taken above, so v_used already includes it. Over the limit means this watch is the
  -- one that went too far: give the slot back and refuse. Two devices racing for the last slot both
  -- insert and both count, and exactly one sees a count within the limit.
  IF v_used > p_limit THEN
    DELETE FROM public.user_daily_watch_slots WHERE id = v_inserted;
    RETURN QUERY SELECT false, v_used - 1, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_used, false;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_watch_slot(uuid, date, uuid, integer) FROM public, anon, authenticated;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (129, '129_watch_quota_and_audience_tier.sql')
ON CONFLICT (migration_number) DO NOTHING;
