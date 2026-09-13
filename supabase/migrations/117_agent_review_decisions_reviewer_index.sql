-- 117_agent_review_decisions_reviewer_index.sql
--
-- agent_review_decisions (112) indexes run_id but not reviewer_id, so "this
-- reviewer's own decision history" has no index to use and falls back to a
-- full scan. Never edit 112 -- this is additive only.

CREATE INDEX IF NOT EXISTS idx_agent_review_decisions_reviewer
  ON public.agent_review_decisions (reviewer_id, created_at DESC);

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (117, '117_agent_review_decisions_reviewer_index.sql')
ON CONFLICT (migration_number) DO NOTHING;
