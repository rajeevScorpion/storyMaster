-- 025_seed_script_model_config.sql
-- Seed runtime model config rows for script-seeded story tasks.

INSERT INTO public.model_config (task_key, model_id, temperature)
VALUES
  ('seed_plan_generation', 'gemini-3.1-pro-preview', 0.3),
  ('seeded_beat_materialization', 'gemini-3.1-pro-preview', 0.4)
ON CONFLICT (task_key) DO NOTHING;
