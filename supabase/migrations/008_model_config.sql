-- Model configuration table for admin playground
-- Allows runtime model changes without code deploys

create table if not exists public.model_config (
  task_key text primary key,
  model_id text not null,
  temperature numeric,
  updated_at timestamptz default now()
);

-- Change history for audit trail
create table if not exists public.model_config_history (
  id uuid default gen_random_uuid() primary key,
  task_key text not null,
  old_model_id text,
  old_temperature numeric,
  new_model_id text not null,
  new_temperature numeric,
  changed_by uuid,
  experiment_id text,
  change_reason text,
  created_at timestamptz default now()
);

create index if not exists model_config_history_task_key_idx
  on public.model_config_history (task_key, created_at desc);

-- Seed with current hardcoded defaults (skip if already seeded)
insert into public.model_config (task_key, model_id, temperature) values
  ('story_generation', 'gemini-3.1-pro-preview', 0.7),
  ('visual_prompt', 'gemini-3.1-pro-preview', 0.7),
  ('image_generation', 'gemini-3.1-flash-image-preview', null),
  ('tts', 'gemini-2.5-flash-preview-tts', null),
  ('voice_selection', 'gemini-3.1-pro-preview', 0.3)
on conflict (task_key) do nothing;
