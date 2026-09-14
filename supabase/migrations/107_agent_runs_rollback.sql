-- 107_agent_runs_rollback.sql
--
-- Reverses 107_agent_runs.sql.
--
-- ORDER MATTERS, reasoned through the same way 103's and 106's rollbacks were.
-- `agent_run_events.run_id REFERENCES agent_runs(id)` -- so `agent_run_events` is the
-- table pointing AT `agent_runs`, and `agent_runs` is the referenced side of that foreign
-- key. Postgres refuses to drop a table another table still points at ("cannot drop
-- table ... because other objects depend on it"), so `DROP TABLE IF EXISTS
-- public.agent_run_events` MUST run BEFORE `DROP TABLE IF EXISTS public.agent_runs`
-- below, or this file fails on its first DROP TABLE.
--
-- `agent_schedules` references only `agent_personas` (migration 103, not touched by this
-- rollback), so it carries no ordering dependency relative to `agent_runs` or
-- `agent_run_events` and can be dropped at any point below.
--
-- Unlike 103's and 106's rollbacks, there is no `ALTER TABLE public.stories DROP COLUMN`
-- step here: 107_agent_runs.sql never added a column to `stories` in the first place
-- (agent_runs.story_id is a new column ON agent_runs referencing stories, not the other
-- way around), so that class of ordering hazard does not apply to this migration at all.
--
-- Application code reads this schema through lib/agentic/orchestrator.ts, which fails
-- closed (empty list / null on read, a clear "not applied yet" error on write) whenever
-- agent_runs is absent, so rolling this back is safe at any time -- it returns the app to
-- that same fail-closed state rather than breaking it.

DROP INDEX IF EXISTS public.idx_agent_run_events_run;
DROP TABLE IF EXISTS public.agent_run_events;

DROP INDEX IF EXISTS public.idx_agent_runs_active_task;
DROP INDEX IF EXISTS public.idx_agent_runs_queue;
DROP TABLE IF EXISTS public.agent_runs;

DROP TABLE IF EXISTS public.agent_schedules;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 107;
