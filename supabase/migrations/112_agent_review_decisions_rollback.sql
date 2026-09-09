-- 112_agent_review_decisions_rollback.sql
--
-- Reverses 112_agent_review_decisions.sql.
--
-- No ordering hazard: agent_review_decisions is a pure leaf table (see the forward
-- migration's header) -- nothing else in the schema references it, so it can be dropped
-- with no other table to sequence around, unlike 103/106/107's rollbacks.
--
-- Application code (lib/agentic/review-decisions.ts) fails closed whenever
-- agent_review_decisions is absent (empty list on read, a clear "not applied yet" error on
-- write), so rolling this back is safe at any time -- it returns the app to that same
-- fail-closed state rather than breaking it. Note this does NOT revert any agent_runs or
-- agent_tasks rows a decision write already touched (e.g. a run cancelled by a 'rejected'
-- decision stays cancelled) -- those are separate tables with their own rollback files.

DROP INDEX IF EXISTS public.idx_agent_review_decisions_run;
DROP TABLE IF EXISTS public.agent_review_decisions;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 112;
