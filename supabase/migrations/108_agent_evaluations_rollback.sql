-- 108_agent_evaluations_rollback.sql
--
-- Reverses 108_agent_evaluations.sql.
--
-- DROP ORDER, reasoned through explicitly (see the header of the forward migration for
-- the full argument): `agent_evaluations` is the DEPENDENT side of every foreign key it
-- carries (into agent_runs, stories, agent_personas) and nothing anywhere in this schema
-- references it. So unlike 103's rollback (which had to drop stories.agent_persona_id
-- before agent_personas, because stories pointed AT agent_personas) and unlike 107's
-- (which had to drop agent_run_events before agent_runs, because events point AT runs),
-- there is no table that must be altered or dropped first. One statement, no ordering
-- constraint.
--
-- The three indexes are dropped with the table; naming them separately would be noise.
--
-- Application code reads this schema through lib/agentic/evaluation.ts, which fails
-- closed when the table is absent: the evaluation is still computed and still written
-- into agent_run_events, only the persist is skipped (with a warn), and the run still
-- advances to awaiting_review. Rolling this back therefore returns the app to that same
-- fail-closed state rather than breaking it -- an in-flight run loses its stored report,
-- not its progress.

DROP TABLE IF EXISTS public.agent_evaluations;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 108;
