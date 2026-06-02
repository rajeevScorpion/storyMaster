-- Seed model_config with portrait_generation task for character reference images
insert into public.model_config (task_key, model_id, temperature) values
  ('portrait_generation', 'gemini-3.1-flash-image', null)
on conflict (task_key) do nothing;
