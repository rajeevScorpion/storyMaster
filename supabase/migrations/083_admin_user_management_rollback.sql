-- 083_admin_user_management_rollback.sql

DROP FUNCTION IF EXISTS public.admin_execute_promotional_cohort(
  text, integer, integer, integer, numeric, text, uuid, numeric, numeric,
  timestamptz, integer, text
);
DROP FUNCTION IF EXISTS public.admin_promotional_cohort_candidates(
  integer, integer, integer, numeric, text, uuid, integer
);
DROP FUNCTION IF EXISTS public.admin_grant_user_coins(
  uuid, uuid, numeric, numeric, text, timestamptz, text
);
DROP FUNCTION IF EXISTS public.admin_set_user_moderation(
  uuid, text, timestamptz, text, uuid
);
DROP FUNCTION IF EXISTS public.admin_user_management_summary();
DROP FUNCTION IF EXISTS public.admin_list_users(text, text, integer, integer, uuid);

DROP TABLE IF EXISTS public.admin_promotional_cohort_members;
DROP TABLE IF EXISTS public.admin_promotional_cohorts;
DROP TABLE IF EXISTS public.admin_user_audit_events;
DROP TABLE IF EXISTS public.user_account_moderation;

DROP TRIGGER IF EXISTS auth_users_sync_admin_directory ON auth.users;
DROP FUNCTION IF EXISTS public.sync_admin_user_directory();
DROP TABLE IF EXISTS public.admin_user_directory;
