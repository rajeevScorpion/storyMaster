-- 105_agent_story_memory.sql
--
-- Agentic Creator System: global story memory and auditable novelty checks.
--
-- `agent_story_memory` is the catalogue-wide record novelty checks compare a
-- new brief against: one row per story the agent (or a human, via backfill)
-- has already produced, carrying title/premise text plus structured cast,
-- setting and theme fields. `agent_novelty_checks` is the audit trail of every
-- verdict a novelty check ever reached, `clear` included, so a reviewer can
-- see why a run was blocked (or why it wasn't) after the fact.
--
-- DECISION D3 (docs/agentic-creator-decisions.md): there is no pgvector in
-- this database and none is added here. Similarity is `pg_trgm` GIN indexes
-- on title and premise, scored with Postgres's trigram similarity() at query
-- time, plus the deterministic helpers already proven in
-- lib/ai/character-novelty.shared.ts for cast-name and appearance reuse. An
-- Economy-tier model call (TaskKey `agent_novelty_assessment`, see
-- lib/ai/model-config.shared.ts) adjudicates only the ambiguous middle band
-- computed by lib/agentic/memory.shared.ts's scoreNovelty() — see that file
-- for the scoring rules, and note in particular that series continuity
-- (recurring cast/setting inside the same series_id) is expected and must
-- never by itself push a verdict toward block.
--
-- `pg_trgm` is already enabled by migration 094 (storyline search) — this
-- migration depends on that extension but deliberately does NOT re-run
-- CREATE EXTENSION, matching the instruction not to re-create it.
--
-- Both tables are RLS-enabled with zero policies and REVOKE ALL from
-- anon/authenticated, matching every other admin/system-only table in this
-- schema (model_config, prompt_configs, feature_flags, agent_personas —
-- see 097 and 103). Service-role access only, via
-- lib/supabase/admin.ts createAdminClient(). Application code
-- (lib/agentic/memory.ts) fails closed while this migration is unapplied:
-- runNoveltyCheck() degrades to a `clear` verdict with a reason explaining
-- memory is unavailable, and never throws or blocks generation — the same
-- shape as lib/agentic/personas.shared.ts's isMissingPersonaSchemaError latch
-- for migration 103, kept as its own dedicated latch
-- (isMissingMemorySchemaError) per GOTCHAS.md: latches are one per migration
-- group, never reused across groups.
--
-- `agent_story_memory.story_id` cascades on delete (deleting a story should
-- not leave an orphaned memory row pointing nowhere); `storyline_id` and
-- `persona_id` are SET NULL (a storyline can be unpublished, or a persona
-- archived/removed, without losing the memory row's title/premise/cast
-- value for future novelty checks). `agent_novelty_checks.persona_id` is
-- also SET NULL for the same reason. `task_id` and `run_id` are bare UUIDs
-- with no foreign key, because agent_tasks (106) and agent_runs (107) do not
-- exist yet — they are columns waiting for their migrations, exactly like
-- `stories.agent_persona_id` waited nowhere (103 shipped both sides
-- together); here the two sides ship in different migrations on purpose, so
-- 105 is fully independent of 106/107 and can be applied and used (memory
-- recording, novelty scoring) before either exists.
--
-- ROLLBACK ORDERING — reasoned through explicitly per the working brief,
-- because 103's rollback shipped a real bug (a table dropped while another
-- table still referenced it) that was only caught in review:
-- `agent_story_memory` and `agent_novelty_checks` both reference OTHER
-- tables (stories, storylines, agent_personas) — they are the dependent
-- side of every one of their foreign keys, never the referenced side. No
-- table created anywhere in this codebase references `agent_story_memory`
-- or `agent_novelty_checks`, and the two do not reference each other either.
-- That means dropping either table can never fail with "other objects
-- depend on it" — there is no drop-order hazard here, unlike 103 where
-- `stories.agent_persona_id` pointed AT the table being dropped. The
-- rollback below still drops in a fixed, deliberate order (novelty_checks
-- before story_memory) for readability, not because Postgres requires it.
--
-- Apply to development first. Then confirm:
--   select * from public.schema_migration_ledger where migration_number = 105;
--   select count(*) from public.agent_story_memory;   -- expect 0
--   select count(*) from public.agent_novelty_checks;  -- expect 0
--   select extname from pg_extension where extname = 'pg_trgm';  -- expect one row (from 094)
-- and that ordinary story creation/save and publishing are unaffected —
-- neither table is referenced by any existing code path outside lib/agentic.

CREATE TABLE IF NOT EXISTS public.agent_story_memory (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id         UUID REFERENCES public.stories(id) ON DELETE CASCADE,
  storyline_id     UUID REFERENCES public.storylines(id) ON DELETE SET NULL,
  persona_id       UUID REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  premise          TEXT NOT NULL DEFAULT '',
  summary          TEXT NOT NULL DEFAULT '',
  language         TEXT,
  age_group        TEXT,
  genre            TEXT,
  themes           TEXT[] NOT NULL DEFAULT '{}',
  character_names  TEXT[] NOT NULL DEFAULT '{}',
  setting_summary  TEXT,
  series_id        UUID,
  episode_number   INTEGER,
  origin           TEXT NOT NULL DEFAULT 'agent' CHECK (origin IN ('agent','human_backfill')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_story_memory_title_trgm
  ON public.agent_story_memory USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_agent_story_memory_premise_trgm
  ON public.agent_story_memory USING GIN (premise gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_agent_story_memory_scope
  ON public.agent_story_memory (language, age_group, genre, created_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_novelty_checks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID,
  run_id       UUID,
  persona_id   UUID REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  stage        TEXT NOT NULL CHECK (stage IN ('pre_generation','post_generation')),
  verdict      TEXT NOT NULL CHECK (verdict IN ('clear','warn','block')),
  top_score    NUMERIC(5,4),
  reasons      JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidates   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_novelty_checks_task
  ON public.agent_novelty_checks (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_novelty_checks_run
  ON public.agent_novelty_checks (run_id, created_at DESC);

ALTER TABLE public.agent_story_memory  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_novelty_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_story_memory   FROM anon, authenticated;
REVOKE ALL ON public.agent_novelty_checks FROM anon, authenticated;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (105, '105_agent_story_memory.sql') ON CONFLICT (migration_number) DO NOTHING;
