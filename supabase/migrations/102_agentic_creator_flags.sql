-- 102_agentic_creator_flags.sql
--
-- Agentic Creator System: master feature flags.
--
-- Every flag defaults to false, and every read in application code passes
-- fallback = false through lib/agentic/flags.ts. A database that has not had
-- this migration applied therefore behaves exactly like one where the whole
-- feature is switched off — which is the normal state of production while dev
-- runs ahead. Nothing here changes existing behaviour.

INSERT INTO public.feature_flags (flag_key, enabled) VALUES
  -- Master kill switch. Off means: no /admin/agents render, no worker drain,
  -- no supervisor tick, no agent generation of any kind.
  ('agentic_creator_enabled',           false),
  -- Lets the existing daily /api/batch/reconcile cron drain the agent queue.
  ('agentic_scheduler_enabled',         false),
  -- Lets the Editorial Supervisor commission tasks into the pool.
  ('agentic_supervisor_enabled',        false),
  -- Turns on /admin/authors and the human review queue.
  ('agentic_reviewer_workflow_enabled', false),
  -- Lets the AGENTIC_SYSTEM_USER_ID account skip the coin reservation.
  -- Cost telemetry is written to ai_cost_events either way.
  ('agentic_billing_bypass_enabled',    false),
  -- Global gate that sits above each persona's own allow_image_generation.
  -- Both must be true before a persona's StoryConfig leaves 'prompt_only'.
  ('agentic_image_generation_enabled',  false)
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (102, '102_agentic_creator_flags.sql')
ON CONFLICT (migration_number) DO NOTHING;
