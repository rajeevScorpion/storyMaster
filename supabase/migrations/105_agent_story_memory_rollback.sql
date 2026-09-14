-- 105_agent_story_memory_rollback.sql
--
-- Reverses 105_agent_story_memory.sql.
--
-- DROP ORDER, reasoned through explicitly (see the header of the forward
-- migration for the full argument): `agent_story_memory` and
-- `agent_novelty_checks` are each the DEPENDENT side of every foreign key
-- they carry (into stories, storylines, agent_personas) — nothing in this
-- schema references either of these two tables, and they do not reference
-- each other. So unlike 103's rollback (which had to drop
-- stories.agent_persona_id before agent_personas, because stories pointed AT
-- agent_personas), there is no table anywhere that must be altered or
-- dropped first to make these DROP TABLEs succeed. Both DROP TABLE
-- statements below are safe in either order; novelty_checks is dropped
-- first purely for readability (audit trail before the memory it audits).
--
-- Application code reads this schema through lib/agentic/memory.ts, which
-- fails closed (degrades every novelty check to a `clear` verdict with an
-- explanatory reason, never throws) whenever these tables are absent, so
-- rolling this back is safe at any time — it returns the app to that same
-- fail-closed state rather than breaking it. pg_trgm itself is NOT dropped
-- here: it was enabled by migration 094 for storyline search and other
-- indexes still depend on it.

DROP TABLE IF EXISTS public.agent_novelty_checks;
DROP TABLE IF EXISTS public.agent_story_memory;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 105;
