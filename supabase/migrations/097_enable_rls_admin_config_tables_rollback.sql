-- 097_enable_rls_admin_config_tables_rollback.sql
-- Reverts 097 by disabling Row Level Security again on the six admin
-- configuration tables.
--
-- WARNING: this restores the exposure 097 was written to close. Once RLS is off,
-- these tables are readable and writable by anyone holding the anon key, which
-- ships in the browser bundle. Only run this if enabling RLS actually broke a
-- surface, and treat it as temporary.
--
-- If something did break, the likely cause is a code path reaching these tables
-- with the anon or user-session client instead of createAdminClient(). Fixing
-- that call site is the better remedy than leaving the tables open.
--
-- 097 created no policies, so there are none to drop.

ALTER TABLE public.model_config          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_config_history  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_configs        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_drafts         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_history        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_test_runs      DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.model_config IS NULL;
COMMENT ON TABLE public.prompt_configs IS NULL;
