-- 114_agent_review_assignments.sql
--
-- Phase 9b (D18): who is looking at which draft. TASK-level, not run-level: a task
-- can produce several runs via retry (retryRun resumes the same run, and a re-brief
-- makes a new one), and an assignment must survive that. agent_tasks is the durable
-- commission; agent_runs is one attempt at it.
--
-- ADVISORY, not a gate. Nothing in the decision path consults this table -- any
-- active reviewer may still act on any draft. It drives the default filter on
-- /review and the workload view (Unit 9k). Enforced routing was rejected because a
-- taxonomy typo would lock a draft with no error.
--
-- DEPENDS ON 106 (agent_tasks). Service-role only: RLS enabled with zero policies,
-- matching agent_runs / agent_reviewers / agent_review_decisions.

CREATE TABLE IF NOT EXISTS public.agent_review_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  reviewer_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source       text NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('manual', 'auto')),
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'released', 'superseded')),
  match_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ON DELETE CASCADE on task_id (the assignment is meaningless without its task) but
-- SET NULL on both user columns, exactly as 112 does: deleting an account must not
-- erase the record that the work was assigned. A row with reviewer_id IS NULL and
-- status 'active' therefore exists as a real state, and application code MUST read
-- it as unassigned -- see listAssignmentsForTasks in lib/agentic/review-routing.ts.

-- The load-bearing constraint: at most ONE active assignment per task. This is what
-- makes auto-assignment idempotent (a second attempt conflicts instead of
-- duplicating) and what stops two concurrent reassignments both landing.
CREATE UNIQUE INDEX IF NOT EXISTS agent_review_assignments_one_active_idx
  ON public.agent_review_assignments (task_id) WHERE status = 'active';

-- Serves both "my queue" and the least-loaded count the matcher needs.
CREATE INDEX IF NOT EXISTS agent_review_assignments_reviewer_idx
  ON public.agent_review_assignments (reviewer_id) WHERE status = 'active';

ALTER TABLE public.agent_review_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_review_assignments FROM anon, authenticated;
GRANT ALL ON TABLE public.agent_review_assignments TO service_role;

COMMENT ON COLUMN public.agent_review_assignments.match_reason IS
  'Why the matcher chose this reviewer (axes matched, candidate count, load at the '
  'time). Debugging aid for routing; empty for manual assignments.';

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (114, '114_agent_review_assignments.sql')
ON CONFLICT (migration_number) DO NOTHING;
