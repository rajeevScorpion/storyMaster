-- Verification walk for migration 129's consume_watch_slot.
--
-- Why this is a file and not something a session runs: the Supabase MCP connection is read-only and
-- consume_watch_slot writes rows, so an agent cannot execute it. Paste the whole thing into the
-- Supabase SQL editor on DEV. It is wrapped in BEGIN/ROLLBACK, so it leaves nothing behind -- no
-- slot rows, no cleanup step to forget.
--
-- What it proves (owner decisions 3 and 11, and the migration's own header):
--   1. a first watch is allowed and counts one slot
--   2. re-watching the same story the same day is free, counts nothing, and reports is_replay
--   3. the limit is enforced on the (limit+1)th DISTINCT story
--   4. a refused watch gives its slot back -- `used` does not creep past the limit
--   5. a replay is still free once the day is already full
--   6. the next IST day starts clean
--
-- What it CANNOT prove: the cross-device race. Every call below runs in one transaction, so they
-- all share one advisory lock and one snapshot. Racing needs two concurrent sessions -- see the note
-- at the bottom.

BEGIN;

CREATE TEMP TABLE wq_probe (
  step int,
  note text,
  allowed boolean,
  used int,
  is_replay boolean,
  expected text
) ON COMMIT DROP;

DO $$
DECLARE
  v_user uuid;
  v_story uuid[];
  v_limit constant integer := 3;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No users on this database -- nothing to test with.';
  END IF;

  SELECT array_agg(id) INTO v_story FROM (
    SELECT id FROM public.storylines ORDER BY created_at LIMIT 4
  ) t;
  IF array_length(v_story, 1) < 4 THEN
    RAISE EXCEPTION 'Need at least 4 storylines; found %.', coalesce(array_length(v_story, 1), 0);
  END IF;

  -- A date far enough out that it cannot collide with a real day's counting. The whole thing is
  -- rolled back anyway; this just means a crash mid-script still cannot touch today.
  INSERT INTO wq_probe
    SELECT 1, 'story A, first watch', *, 'allowed=t used=1 replay=f'
    FROM public.consume_watch_slot(v_user, DATE '2099-01-01', v_story[1], v_limit);

  INSERT INTO wq_probe
    SELECT 2, 'story A again, same day', *, 'allowed=t used=1 replay=t'
    FROM public.consume_watch_slot(v_user, DATE '2099-01-01', v_story[1], v_limit);

  INSERT INTO wq_probe
    SELECT 3, 'story B', *, 'allowed=t used=2 replay=f'
    FROM public.consume_watch_slot(v_user, DATE '2099-01-01', v_story[2], v_limit);

  INSERT INTO wq_probe
    SELECT 4, 'story C, the last slot', *, 'allowed=t used=3 replay=f'
    FROM public.consume_watch_slot(v_user, DATE '2099-01-01', v_story[3], v_limit);

  -- used must come back 3, not 4: the refused slot is given back.
  INSERT INTO wq_probe
    SELECT 5, 'story D, over the limit', *, 'allowed=f used=3 replay=f'
    FROM public.consume_watch_slot(v_user, DATE '2099-01-01', v_story[4], v_limit);

  INSERT INTO wq_probe
    SELECT 6, 'story A replay, day already full', *, 'allowed=t used=3 replay=t'
    FROM public.consume_watch_slot(v_user, DATE '2099-01-01', v_story[1], v_limit);

  INSERT INTO wq_probe
    SELECT 7, 'story D, next IST day', *, 'allowed=t used=1 replay=f'
    FROM public.consume_watch_slot(v_user, DATE '2099-01-02', v_story[4], v_limit);
END $$;

SELECT
  step,
  note,
  allowed,
  used,
  is_replay,
  expected,
  CASE WHEN format('allowed=%s used=%s replay=%s',
                   CASE WHEN allowed THEN 't' ELSE 'f' END,
                   used,
                   CASE WHEN is_replay THEN 't' ELSE 'f' END) = expected
       THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM wq_probe
ORDER BY step;

-- Rows actually written for the synthetic day: must be 3, never 4.
SELECT count(*) AS rows_for_day_1, 3 AS expected
FROM public.user_daily_watch_slots
WHERE local_day = DATE '2099-01-01';

ROLLBACK;

-- The race, if you want it. Two SQL editor tabs, both on dev, at limit-minus-one for the same user
-- and the same day, each opening a DIFFERENT storyline. Run BEGIN + the call in tab 1, then the same
-- in tab 2 before committing tab 1. Exactly one must come back allowed=true. This is what the
-- pg_advisory_xact_lock in the function is for: the unique index alone does not stop it, because two
-- different storylines are two different rows. Remember to ROLLBACK both tabs.
