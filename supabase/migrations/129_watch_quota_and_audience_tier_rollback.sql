-- Rollback for 129_watch_quota_and_audience_tier.sql
--
-- Narrowing the CHECKs fails if any row already carries 'audience'. That is deliberate: reassign
-- those accounts and styles first, as a decision, rather than having a rollback silently strand them.

DROP FUNCTION IF EXISTS public.consume_watch_slot(uuid, date, uuid, integer);
DROP TABLE IF EXISTS public.user_daily_watch_slots;

ALTER TABLE public.reel_visual_styles
  DROP CONSTRAINT IF EXISTS reel_visual_styles_min_plan_check;
ALTER TABLE public.reel_visual_styles
  ADD CONSTRAINT reel_visual_styles_min_plan_check
  CHECK (min_plan IN ('free', 'plus', 'studio'));

ALTER TABLE public.user_entitlement_overrides
  DROP CONSTRAINT IF EXISTS user_entitlement_overrides_entitlement_plan_key_check;
ALTER TABLE public.user_entitlement_overrides
  ADD CONSTRAINT user_entitlement_overrides_entitlement_plan_key_check
  CHECK (entitlement_plan_key IN ('free', 'plus', 'studio'));

DELETE FROM public.schema_migration_ledger WHERE migration_number = 129;
