-- 111_agent_reviewers_rollback.sql
drop index if exists public.agent_reviewers_status_idx;
drop table if exists public.agent_reviewers;
delete from public.schema_migration_ledger where migration_number = 111;
