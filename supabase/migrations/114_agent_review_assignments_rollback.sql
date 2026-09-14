-- Reverses 114. No other table references agent_review_assignments, so unlike 106's
-- rollback there is no column elsewhere to drop first.
DROP INDEX IF EXISTS public.agent_review_assignments_reviewer_idx;
DROP INDEX IF EXISTS public.agent_review_assignments_one_active_idx;
DROP TABLE IF EXISTS public.agent_review_assignments;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 114;
