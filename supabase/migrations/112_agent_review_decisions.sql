-- 112_agent_review_decisions.sql
--
-- Agentic Creator System: reviewer decisions (Unit 9e-i -- approve / reject / request
-- rewrite). Publish is Unit 9e-ii, a separate commit per D15 in
-- docs/agentic-creator-decisions.md, and is NOT built here.
--
-- A decision is an EVENT, not columns on agent_runs: a run can be reviewed more than once
-- (rewrite-requested, redrafted under a fresh commission, and later approved), and columns
-- on the run would keep only the latest verdict and silently lose the rest -- the same
-- reasoning that made agent_run_events (107) a table instead of fields on agent_runs.
-- agent_review_decisions is APPEND-ONLY and deliberately carries no unique constraint on
-- run_id: re-recording a decision on the same run is the intended shape, not an error.
--
-- REVIEWER ATTRIBUTION. `reviewer_id` is nullable on purpose (ON DELETE SET NULL) and is
-- paired with `reviewer_label`, a plain-text snapshot of the reviewer's display name AT THE
-- MOMENT OF DECISION. An audit trail that forgets who acted is worth little, and
-- `reviewer_id` alone is not durable enough to serve that: a live foreign key silently
-- follows a later rename, and ON DELETE SET NULL erases it outright if the account is later
-- removed. `reviewer_label` survives both.
--
-- SCOPE HONESTY. `decision` includes 'published' in its CHECK constraint now, even though
-- nothing writes it yet -- Unit 9e-ii (publish) is what will, so it needs no migration of
-- its own when it ships. IT IS CURRENTLY UNWRITTEN; do not assume a 'published' row exists
-- on any environment from this migration alone. `storyline_id` is the same story: nullable,
-- referencing a row 9e-ii will create, unused until then.
--
-- THE STATE MACHINE THIS TABLE RECORDS DECISIONS FOR (Unit 9e-i,
-- lib/agentic/review-decisions.shared.ts's decideReviewTransition):
--   approved          -> agent_runs unchanged (stays 'awaiting_review'); agent_tasks.status = 'approved'
--   rewrite_requested -> agent_runs unchanged; agent_tasks.status unchanged (a recorded
--                        opinion only -- retryRun cannot re-brief per PROJECT_STATE, so the
--                        redo is a separate commission, never an automatic consequence)
--   rejected          -> agent_runs.stage/status = 'cancelled' + finished_at; agent_tasks.status = 'rejected'
-- 'approved' deliberately does NOT advance the run's stage -- publishing (9e-ii) is what
-- completes it. Nothing in this unit ever writes stage 'media_pending': verified to have no
-- consumer anywhere in the codebase (no worker, no cron drains it), so advancing a run into
-- it would look like progress and be a dead end.
--
-- `run_id` -> agent_runs(id) ON DELETE CASCADE: a decision has no meaning once its run is
-- gone. `story_id` -> stories(id) ON DELETE SET NULL: a denormalized convenience for
-- querying decisions by story without a join through agent_runs, but a deleted story must
-- not take the decision history down with it.
--
-- RLS: enabled with zero policies and REVOKE ALL from anon/authenticated, exactly like
-- agent_runs (107) and agent_reviewers (111) -- service-role only, via
-- lib/agentic/review-decisions.ts's createAdminClient(). Application code fails closed
-- while this migration is unapplied: reads degrade to [], writes throw a clear "not applied
-- yet" message rather than a raw Postgres error, via its own dedicated latch
-- (isMissingReviewDecisionSchemaError) -- never 107's or 111's latch, per GOTCHAS.md:
-- latches (and their classifiers) are one per migration group, never reused across groups.
--
-- ROLLBACK ORDERING. agent_review_decisions is a pure leaf: it references agent_runs,
-- stories, auth.users and storylines, but nothing anywhere in this schema references
-- agent_review_decisions back. Dropping it therefore carries no ordering dependency on any
-- other table, unlike 103/106/107's rollbacks, which had to sequence around tables that
-- pointed at the one being dropped.
--
-- Apply to development first. Then confirm:
--   select * from public.schema_migration_ledger where migration_number = 112;
--   select count(*) from public.agent_review_decisions;   -- expect 0
-- and that agent_runs/agent_tasks writes elsewhere are unaffected (this migration touches
-- no existing table).

CREATE TABLE IF NOT EXISTS public.agent_review_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  story_id        UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  reviewer_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_label  TEXT,
  decision        TEXT NOT NULL CHECK (decision IN ('approved','rejected','rewrite_requested','published')),
  storyline_id    UUID REFERENCES public.storylines(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_review_decisions_run
  ON public.agent_review_decisions (run_id, created_at DESC);

ALTER TABLE public.agent_review_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_review_decisions FROM anon, authenticated;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (112, '112_agent_review_decisions.sql') ON CONFLICT (migration_number) DO NOTHING;
