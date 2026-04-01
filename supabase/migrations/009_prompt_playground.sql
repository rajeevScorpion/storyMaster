-- Prompt iteration support for admin playground
-- Stores published prompts, per-admin drafts, publish history, and persisted test runs

create table if not exists public.prompt_configs (
  task_key text primary key,
  prompt_body text not null,
  updated_at timestamptz default now(),
  published_by uuid,
  published_note text
);

create table if not exists public.prompt_drafts (
  task_key text not null,
  admin_user_id uuid not null,
  prompt_body text not null,
  updated_at timestamptz default now(),
  primary key (task_key, admin_user_id)
);

create table if not exists public.prompt_history (
  id uuid default gen_random_uuid() primary key,
  task_key text not null,
  prompt_body text not null,
  published_at timestamptz default now(),
  published_by uuid,
  note text
);

create table if not exists public.prompt_test_runs (
  id uuid default gen_random_uuid() primary key,
  task_key text not null,
  created_by uuid not null,
  prompt_body text not null,
  model_id text not null,
  temperature numeric,
  inputs jsonb not null default '{}'::jsonb,
  output text not null,
  output_type text not null,
  latency_ms integer not null,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric,
  created_at timestamptz default now()
);

create index if not exists prompt_history_task_key_published_at_idx
  on public.prompt_history (task_key, published_at desc);

create index if not exists prompt_test_runs_task_key_created_at_idx
  on public.prompt_test_runs (task_key, created_at desc);

-- No RLS — all tables accessed only via service-role admin client server-side
