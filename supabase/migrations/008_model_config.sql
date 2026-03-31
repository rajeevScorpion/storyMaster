-- Model configuration table for admin playground
-- Allows runtime model changes without code deploys

create table public.model_config (
  task_key text primary key,
  model_id text not null,
  temperature numeric,
  updated_at timestamptz default now()
);

-- No RLS — accessed only via service-role admin client server-side
alter table public.model_config enable row level security;

-- Seed with current hardcoded defaults
insert into public.model_config (task_key, model_id, temperature) values
  ('story_generation', 'gemini-3.1-pro-preview', 0.7),
  ('visual_prompt', 'gemini-3.1-pro-preview', 0.7),
  ('image_generation', 'gemini-3.1-flash-image-preview', null),
  ('tts', 'gemini-2.5-flash-preview-tts', null),
  ('voice_selection', 'gemini-3.1-pro-preview', 0.3);
