-- 079_reference_direct_input_rollback.sql
-- Reverse 079. Safe only while the References feature is disabled or running in
-- v1 'adoption' mode (no story_config depends on the description column value).
-- Dropping the description column discards any user-typed v2 reference text.

ALTER TABLE public.reference_sources
  DROP COLUMN IF EXISTS description;

DELETE FROM public.feature_flags
WHERE flag_key = 'reference_input_mode';

DELETE FROM public.pricing_action_costs
WHERE action_key = 'analyze_direct_reference';
