-- 025_seed_script_model_config_rollback.sql

DELETE FROM public.model_config
WHERE task_key IN (
  'seed_plan_generation',
  'seeded_beat_materialization'
);
