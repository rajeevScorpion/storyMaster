-- 106_agent_tasks_rollback.sql
--
-- Reverses 106_agent_tasks.sql.
--
-- ORDER MATTERS, and it repeats the exact hazard 103's rollback documented and initially
-- got wrong. `stories.agent_task_id` carries `REFERENCES public.agent_tasks(id)` -- so
-- `stories` is the table pointing AT `agent_tasks`, and `agent_tasks` is the referenced
-- side of that foreign key. Postgres refuses to drop a table another table still points
-- at ("cannot drop table ... because other objects depend on it"), so
-- `ALTER TABLE public.stories DROP COLUMN IF EXISTS agent_task_id` MUST run BEFORE
-- `DROP TABLE IF EXISTS public.agent_tasks` below, or this file fails on its first
-- DROP TABLE -- exactly the bug 103_agent_personas_rollback.sql's header describes for
-- `stories.agent_persona_id` / `agent_personas`, and the reason this header spells the
-- reasoning out again rather than assuming it's obvious: a rollback only ever runs when
-- something has already gone wrong, which is the worst possible time to discover a
-- drop-order mistake.
--
-- Application code reads this schema through lib/agentic/supervisor.ts, which fails
-- closed (empty list / null on read, a clear "not applied yet" error on write) whenever
-- agent_tasks is absent, so rolling this back is safe at any time -- it returns the app
-- to that same fail-closed state rather than breaking it.

ALTER TABLE public.stories DROP COLUMN IF EXISTS agent_task_id;

DROP INDEX IF EXISTS public.idx_agent_tasks_persona;
DROP INDEX IF EXISTS public.idx_agent_tasks_queue;
DROP TABLE IF EXISTS public.agent_tasks;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 106;
