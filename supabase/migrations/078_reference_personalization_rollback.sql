-- 078_reference_personalization_rollback.sql
-- Reverse 078. Safe only while the feature is disabled
-- (reference_personalization_enabled = false) so no adoption jobs are running.
-- Forward-fix is preferred over rollback in an emergency; dropping these tables
-- destroys canonical adopted assets' bookkeeping, so only run this before any
-- story has depended on an adoption.

DROP TRIGGER IF EXISTS reference_adoptions_touch_updated_at ON public.reference_adoptions;
DROP TRIGGER IF EXISTS reference_sources_touch_updated_at ON public.reference_sources;
DROP FUNCTION IF EXISTS public.touch_reference_personalization_updated_at();

DROP TABLE IF EXISTS public.reference_adoptions;
DROP TABLE IF EXISTS public.reference_sources;

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'reference_personalization_enabled',
  'reference_personalization_settings',
  'reference_custom_option_attachment_enabled'
);

DELETE FROM public.model_config
WHERE task_key IN ('reference_character_analysis', 'reference_world_analysis');

DELETE FROM public.pricing_action_costs
WHERE action_key IN (
  'adopt_character_reference',
  'adopt_world_reference',
  'visualize_world_reference'
);
