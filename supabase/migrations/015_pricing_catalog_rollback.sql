-- 015_pricing_catalog_rollback.sql

DROP TABLE IF EXISTS public.pricing_publish_audit;
DROP TABLE IF EXISTS public.pricing_promotions;
DROP TABLE IF EXISTS public.pricing_action_costs;
DROP TABLE IF EXISTS public.pricing_topup_packs;
DROP TABLE IF EXISTS public.pricing_plan_versions;
DROP TABLE IF EXISTS public.pricing_plans;
