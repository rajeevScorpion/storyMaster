-- 106_agent_tasks.sql
--
-- Agentic Creator System: the task pool.
--
-- `agent_tasks` is the unit of work the Editorial Supervisor (lib/agentic/supervisor.ts)
-- commissions and the future agent worker (Phase 5, migration 107's agent_runs) claims and
-- executes. A task starts life `commissioned` (written by the supervisor, an admin, a
-- schedule tick, or the persona test lab -- see the `origin` check), moves to `assigned`
-- once a persona is attached, `running` while a worker is producing it, `awaiting_review`
-- once a story exists, and finally `approved`/`published`/`rejected` through the human
-- review workflow (Phase 9), or `failed`/`cancelled` off that path entirely.
--
-- `persona_id` is nullable with ON DELETE SET NULL -- exactly the pattern 103 used for
-- stories.agent_persona_id -- so archiving a persona never blocks deleting it or orphans
-- a task's history; the task keeps its brief/rationale/language/ageGroup either way.
-- `story_id` is likewise nullable with ON DELETE SET NULL: a task exists before a story
-- does (it is commissioned first, materialized later), and deleting the eventual story
-- must not cascade into deleting the record of why it was commissioned.
--
-- `constraints` is an open JSONB bag for anything a caller wants to pin down beyond the
-- typed columns (e.g. a specific setting, a restricted theme list, a forced beat count
-- override) without needing a migration for every new knob. `is_test` mirrors the
-- persona test lab's need to run a task end-to-end without it ever appearing in the real
-- queue -- idx_agent_tasks_queue is filtered WHERE is_test = false for exactly that reason.
--
-- `stories.agent_task_id` closes the loop the other direction: once a task produces a
-- story, the story can be traced back to the task (and, transitively, the persona and the
-- rationale) that commissioned it.
--
-- Both new surfaces are RLS-enabled with zero policies and REVOKE ALL from
-- anon/authenticated, matching every other admin/system-only table in this schema
-- (model_config, prompt_configs, feature_flags, agent_personas, agent_story_memory --
-- see 097, 103, 105). Service-role access only, via lib/supabase/admin.ts
-- createAdminClient(). Application code (lib/agentic/supervisor.ts) fails closed while
-- this migration is unapplied: reads degrade to an empty list/null, writes throw a clear
-- "not applied yet" message rather than a raw Postgres error -- the same shape as
-- lib/agentic/personas.shared.ts's isMissingPersonaSchemaError latch for 103 and
-- lib/agentic/memory.shared.ts's isMissingMemorySchemaError latch for 105, kept as its
-- own dedicated latch (isMissingTaskSchemaError) per GOTCHAS.md: latches are one per
-- migration group, never reused across groups.
--
-- ROLLBACK ORDERING -- reasoned through explicitly, because 103's rollback shipped a real
-- bug (a table dropped while another table still referenced it) that was only caught in
-- review: `stories.agent_task_id` carries a REFERENCES constraint pointing AT
-- agent_tasks, so agent_tasks is the referenced side of that foreign key, exactly the
-- position agent_personas was in under 103. Postgres refuses to drop a table another
-- table still points at ("cannot drop table ... because other objects depend on it"), so
-- the rollback must drop `stories.agent_task_id` BEFORE `DROP TABLE agent_tasks` -- see
-- 106_agent_tasks_rollback.sql, which does exactly that and explains it again at the
-- point it matters.
--
-- Apply to development first. Then confirm:
--   select * from public.schema_migration_ledger where migration_number = 106;
--   select count(*) from public.agent_tasks;   -- expect 0
-- and that ordinary story creation/save is unaffected (stories.agent_task_id is nullable
-- and untouched by every existing code path).

CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id        UUID REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  origin            TEXT NOT NULL DEFAULT 'supervisor'
                      CHECK (origin IN ('supervisor','admin','schedule','test_lab')),
  status            TEXT NOT NULL DEFAULT 'commissioned'
                      CHECK (status IN ('commissioned','assigned','running','awaiting_review',
                                        'approved','published','rejected','failed','cancelled')),
  brief             TEXT NOT NULL,
  rationale         TEXT,
  language          TEXT NOT NULL,
  age_group         TEXT NOT NULL,
  genre             TEXT,
  target_beat_count INTEGER,
  series_id         UUID,
  constraints       JSONB NOT NULL DEFAULT '{}'::jsonb,
  story_id          UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  is_test           BOOLEAN NOT NULL DEFAULT false,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_queue
  ON public.agent_tasks (status, created_at) WHERE is_test = false;
CREATE INDEX IF NOT EXISTS idx_agent_tasks_persona ON public.agent_tasks (persona_id, status);

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_tasks FROM anon, authenticated;

ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS agent_task_id UUID
  REFERENCES public.agent_tasks(id) ON DELETE SET NULL;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (106, '106_agent_tasks.sql') ON CONFLICT (migration_number) DO NOTHING;
