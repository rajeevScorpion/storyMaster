-- 111_agent_reviewers.sql
-- Phase 9 (D6): reviewers get their own additive table rather than a role column on
-- admin_user_directory, which is a trigger-synced mirror of auth.users and not a place
-- to put authorization state. ADMIN_USER_ID is implicitly a reviewer in code, not here.
create table if not exists public.agent_reviewers (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  status             text not null default 'active'
                       check (status in ('active', 'suspended')),
  can_publish        boolean not null default false,
  can_trigger_media  boolean not null default false,
  display_name       text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null
);

comment on table public.agent_reviewers is
  'Phase 9 reviewers for agent-generated drafts. Additive to the user model: no role column exists '
  'anywhere else. Read only through requireReviewer() on the service-role client -- RLS is enabled '
  'with no policies, matching agent_runs.';

create index if not exists agent_reviewers_status_idx
  on public.agent_reviewers (status) where status = 'active';

-- Service-role only, exactly like agent_runs: enabled, no policies, all access via admin client.
alter table public.agent_reviewers enable row level security;

insert into public.schema_migration_ledger (migration_number, file_name)
values (111, '111_agent_reviewers.sql')
on conflict (migration_number) do nothing;
