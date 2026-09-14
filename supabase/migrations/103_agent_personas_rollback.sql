-- 103_agent_personas_rollback.sql
--
-- Reverses 103_agent_personas.sql in dependency order: trigger, then function,
-- then the foreign key held by stories, then the dependent memory table, then
-- the personas table itself, then the ledger row. Application code reads this
-- schema through app/actions/agentic-personas.ts, which fails closed (empty
-- list / null) whenever the tables are absent, so rolling this back is safe at
-- any time -- it returns the app to that same fail-closed state rather than
-- breaking it.
--
-- ORDER MATTERS. stories.agent_persona_id carries a REFERENCES constraint to
-- agent_personas, and Postgres refuses to drop a table another table still
-- points at ("cannot drop table ... because other objects depend on it").
-- The column must go before the table, or this whole file fails on the first
-- DROP TABLE -- discovered during review, and a rollback only ever runs when
-- something has already gone wrong, which is the worst time to find out.

DROP TRIGGER IF EXISTS trg_agent_persona_memory ON public.agent_personas;
DROP FUNCTION IF EXISTS public.ensure_agent_persona_memory();

ALTER TABLE public.stories DROP COLUMN IF EXISTS agent_persona_id;

DROP TABLE IF EXISTS public.agent_persona_memory;
DROP TABLE IF EXISTS public.agent_personas;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 103;
