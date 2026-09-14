-- 102_agentic_creator_flags_rollback.sql
--
-- Removes the six agentic feature flags. Application code reads every one of
-- them with fallback = false, so deleting the rows returns the app to
-- feature-off behaviour rather than breaking it.

DELETE FROM public.feature_flags WHERE flag_key IN (
  'agentic_creator_enabled',
  'agentic_scheduler_enabled',
  'agentic_supervisor_enabled',
  'agentic_reviewer_workflow_enabled',
  'agentic_billing_bypass_enabled',
  'agentic_image_generation_enabled'
);

DELETE FROM public.schema_migration_ledger WHERE migration_number = 102;
