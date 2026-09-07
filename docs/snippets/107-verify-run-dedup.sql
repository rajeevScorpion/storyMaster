-- Verifies idx_agent_runs_active_task really does allow only one LIVE run per task.
--
-- Why this exists: the "a retry never pays twice" guarantee has two halves. The
-- checkpoint contract (lib/agentic/orchestrator.shared.ts) is unit-tested. The
-- database half -- this partial unique index -- cannot be reached by any unit
-- test, because it is a Postgres constraint, not TypeScript. This script is the
-- only thing that actually demonstrates it.
--
-- Run in the Supabase SQL editor. It rolls itself back; nothing persists.

BEGIN;

-- A throwaway task to hang runs off. agent_runs.task_id is NOT NULL REFERENCES
-- agent_tasks, so a real row is required.
CREATE TEMP TABLE probe AS
  SELECT id FROM (
    INSERT INTO public.agent_tasks (brief, language, age_group, origin, is_test)
    VALUES ('index probe - rolled back', 'english', 'teens', 'admin', true)
    RETURNING id
  ) AS t;

-- 1. One live run: must SUCCEED.
INSERT INTO public.agent_runs (task_id, status)
SELECT id, 'pending' FROM probe;

-- 2. A SECOND live run for the same task: must FAIL with 23505
--    (unique_violation). If this succeeds, the dedup guarantee is broken and a
--    task can be executed twice concurrently -- paying twice for the same work.
--    Run this statement on its own and confirm the error.
INSERT INTO public.agent_runs (task_id, status)
SELECT id, 'processing' FROM probe;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- Second, equally important half: the index is PARTIAL. A finished run must NOT
-- block a new one, or a task could never be retried after failing.
--
-- Run this separately; it must SUCCEED all the way through.

BEGIN;

CREATE TEMP TABLE probe2 AS
  SELECT id FROM (
    INSERT INTO public.agent_tasks (brief, language, age_group, origin, is_test)
    VALUES ('partial-index probe - rolled back', 'english', 'teens', 'admin', true)
    RETURNING id
  ) AS t;

INSERT INTO public.agent_runs (task_id, status) SELECT id, 'failed'    FROM probe2;
INSERT INTO public.agent_runs (task_id, status) SELECT id, 'succeeded' FROM probe2;
INSERT INTO public.agent_runs (task_id, status) SELECT id, 'pending'   FROM probe2;  -- allowed

SELECT status, count(*) FROM public.agent_runs
WHERE task_id IN (SELECT id FROM probe2) GROUP BY status;
-- expect: failed 1, succeeded 1, pending 1

ROLLBACK;
