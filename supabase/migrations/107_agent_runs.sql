-- 107_agent_runs.sql
--
-- Agentic Creator System: the execution orchestrator's recoverable run state machine.
--
-- `agent_tasks` (106) is a commission -- what should get written and by whom.
-- `agent_runs` is one attempt at actually executing that commission: it advances through
-- an ordered `stage` (queued -> ... -> complete/failed/cancelled, see lib/agentic/
-- orchestrator.shared.ts's STAGE_SEQUENCE, which must match the CHECK constraint below
-- exactly) while a coarser `status` (pending/processing/succeeded/failed/cancelled) tracks
-- whether a worker currently owns the row, mirroring image_generation_jobs (071) and
-- narration_batch_jobs (068) exactly -- claim is an optimistic conditional UPDATE
-- (`SET status='processing' WHERE id=? AND status='pending'`), never `FOR UPDATE SKIP
-- LOCKED` (there is none anywhere in this repo; see lib/media/image-job-runner.ts).
--
-- `checkpoint` is the load-bearing column in this whole migration: every expensive step
-- (a paid model call, a write that must not repeat) writes its result into `checkpoint`
-- before the run advances to the next stage, and a retry checks `checkpoint` first and
-- skips re-executing any stage already present there. That is the entire contract that
-- stops a retried run from paying twice for a model call -- see
-- lib/agentic/orchestrator.shared.ts's isCheckpointed/recordCheckpoint, which is
-- unit-tested precisely because this column has no other enforcement.
--
-- `idempotency_key` is a separate, optional belt-and-suspenders unique key a caller may
-- set (e.g. to fold a duplicate re-kick into a no-op insert); it is not required for the
-- checkpoint contract above, which works entirely off `checkpoint` regardless of whether
-- a key was supplied.
--
-- `idx_agent_runs_active_task` is a UNIQUE partial index on `(task_id) WHERE status IN
-- ('pending','processing')` -- the same shape as idx_image_generation_jobs_active_node
-- (071): a task can have at most one live run at a time, enforced by the database rather
-- than application code, so createRunForTask()'s unique-violation handling (code 23505)
-- is a normal, expected outcome ("already running"), not an error path.
--
-- `agent_run_events` is the per-run timeline: one append-only row per stage transition or
-- notable event, with a `level` for operators scanning for problems. `message` is always a
-- short, concise string -- never chain-of-thought, never a full prompt, never a secret;
-- see docs/agentic-creator-decisions.md and CLAUDE.md.
--
-- `agent_schedules` is a per-persona cadence row the future admin scheduler surface reads
-- (Phase 5b) -- it carries no FK to agent_runs or agent_run_events, only to
-- agent_personas, so it has no drop-order relationship to the other two tables below.
--
-- Both new run tables and the schedule table are RLS-enabled with zero policies and
-- REVOKE ALL from anon/authenticated, matching every other admin/system-only table in
-- this schema (agent_personas, agent_story_memory, agent_tasks -- see 103, 105, 106).
-- Service-role access only, via lib/supabase/admin.ts createAdminClient(). Application
-- code (lib/agentic/orchestrator.ts) fails closed while this migration is unapplied:
-- reads degrade to empty/null, writes throw a clear "not applied yet" message rather than
-- a raw Postgres error -- its own dedicated latch (isMissingRunSchemaError), never reusing
-- the 106 latch (isMissingTaskSchemaError) or any other group's, per GOTCHAS.md.
--
-- NO COLUMN IS ADDED TO `stories` BY THIS MIGRATION -- unlike 103 (`agent_persona_id`) and
-- 106 (`agent_task_id`). Checked directly against the DDL below: agent_runs.story_id is a
-- new column ON agent_runs referencing stories, not a new column ON stories, so the class
-- of rollback-ordering bug 103's and 106's rollbacks had to reason about (a table dropped
-- while `stories` still pointed at it) simply does not arise here -- `stories` itself is
-- never touched by this migration in either direction.
--
-- ROLLBACK ORDERING -- reasoned through explicitly, per the same discipline 103 and 106
-- applied. Within the three tables this migration creates, exactly one internal reference
-- exists: `agent_run_events.run_id REFERENCES agent_runs(id)`, making agent_run_events the
-- referencing side and agent_runs the referenced side of that foreign key. Postgres
-- refuses to drop a table another table still points at, so the rollback must
-- `DROP TABLE agent_run_events` BEFORE `DROP TABLE agent_runs`. `agent_schedules`
-- references only `agent_personas` (an external table from migration 103, untouched by
-- this migration's rollback), so it carries no ordering dependency relative to the other
-- two and can be dropped at any point. `agent_runs.task_id`, `agent_runs.persona_id` and
-- `agent_runs.story_id` all reference OTHER migrations' tables (agent_tasks, agent_personas,
-- stories) as the referencing side -- dropping agent_runs never requires touching any of
-- those, and none of them are dropped by this rollback. See
-- 107_agent_runs_rollback.sql, which drops agent_run_events first and explains this again
-- at the point it matters.
--
-- Apply to development first. Then confirm:
--   select * from public.schema_migration_ledger where migration_number = 107;
--   select count(*) from public.agent_runs;         -- expect 0
--   select count(*) from public.agent_run_events;    -- expect 0
--   select count(*) from public.agent_schedules;      -- expect 0
-- and that ordinary story creation/save and the existing image/narration job queues are
-- unaffected (this migration touches no existing table).

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  persona_id       UUID REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  stage            TEXT NOT NULL DEFAULT 'queued'
                     CHECK (stage IN ('queued','brief_ready','novelty_checked','story_generated',
                                      'draft_created','narration_pending','narration_complete',
                                      'evaluated','awaiting_review','media_pending','complete',
                                      'failed','cancelled')),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','succeeded','failed','cancelled')),
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  claimed_at       TIMESTAMPTZ,
  idempotency_key  TEXT UNIQUE,
  checkpoint       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- completed expensive steps, so a retry never repeats one
  story_id         UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  error_category   TEXT,
  error_detail     TEXT,
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Same dedup shape as idx_image_generation_jobs_active_node (migration 071):
-- one live run per task, enforced by the database rather than by application code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_active_task
  ON public.agent_runs (task_id) WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_agent_runs_queue ON public.agent_runs (status, created_at);

CREATE TABLE IF NOT EXISTS public.agent_run_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  message     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_run ON public.agent_run_events (run_id, created_at);

CREATE TABLE IF NOT EXISTS public.agent_schedules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id   UUID REFERENCES public.agent_personas(id) ON DELETE CASCADE,
  enabled      BOOLEAN NOT NULL DEFAULT false,
  cadence      TEXT NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily','weekly','manual')),
  max_per_tick INTEGER NOT NULL DEFAULT 1,
  last_run_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.agent_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_schedules  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_runs, public.agent_run_events, public.agent_schedules FROM anon, authenticated;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (107, '107_agent_runs.sql') ON CONFLICT (migration_number) DO NOTHING;
