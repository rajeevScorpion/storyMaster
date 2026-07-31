-- 084_operational_policies_and_welcome_grant_rollback.sql

DROP TRIGGER IF EXISTS auth_users_apply_free_welcome_grant ON auth.users;
DROP FUNCTION IF EXISTS public.apply_free_welcome_grant_on_signup();
DROP FUNCTION IF EXISTS public.apply_free_welcome_grant(uuid);
DROP FUNCTION IF EXISTS public.admin_update_operational_policy(text, boolean, jsonb, text, uuid);

UPDATE public.pricing_plan_versions version
SET
  monthly_included_beats =
    (version.extensions_json->>'preWelcomePolicyMonthlyIncludedBeats')::numeric,
  extensions_json =
    (version.extensions_json - 'preWelcomePolicyMonthlyIncludedBeats' - 'freeCreditPolicyKey')
FROM public.pricing_plans plan
WHERE version.plan_id = plan.id
  AND plan.plan_key = 'free'
  AND COALESCE(version.extensions_json, '{}'::jsonb) ? 'preWelcomePolicyMonthlyIncludedBeats';

DROP TABLE IF EXISTS public.operational_policy_audit_events;
DROP TABLE IF EXISTS public.operational_policies;
