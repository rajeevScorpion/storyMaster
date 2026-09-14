-- 117_agent_review_decisions_reviewer_index_rollback.sql
--
-- Drops the per-reviewer index added in 117. No data loss; safe to run anytime.

DROP INDEX IF EXISTS public.idx_agent_review_decisions_reviewer;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 117;
