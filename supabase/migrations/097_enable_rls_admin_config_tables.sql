-- 097_enable_rls_admin_config_tables.sql
-- Close an anon-key exposure on six admin configuration tables.
--
-- These tables were created without Row Level Security, which leaves them fully
-- readable AND writable by the `anon` and `authenticated` roles. The anon key is
-- published in the browser bundle by design, so in practice anyone who opens
-- devtools can rewrite them. That is not merely a data leak:
--
--   * model_config  drives per-task model selection and cost, so an attacker
--     could repoint generation at an expensive model.
--   * prompt_configs holds the admin-published generation prompts, so an
--     attacker could rewrite the prompts every user's story is built from.
--
-- The fix is to enable RLS and deliberately define NO policies. With RLS on and
-- no policy, anon and authenticated match nothing: zero rows, no writes. The
-- service role bypasses RLS entirely, so server code is unaffected.
--
-- Verified before writing this migration:
--   * Every reference to these six tables in the repo lives in exactly two
--     modules, lib/ai/model-config.ts and lib/ai/prompt-config.ts.
--   * Both begin with `import 'server-only'` and construct their client with
--     createAdminClient() (service role) — no anon or user-session client
--     touches them anywhere.
--   * No view, materialized view, or database function references them, so
--     there is no indirect read path.
--
-- This is the pattern already used by this database for admin-only tables:
-- feature_flags, pricing_action_costs, operational_policies and
-- image_model_registry all run RLS-enabled with zero policies.
--
-- Apply to development first, confirm /admin/settings/* and /admin/playground
-- still load, then apply to production.

ALTER TABLE public.model_config          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_config_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_configs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_drafts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_test_runs      ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.model_config IS
  'Admin-only. RLS enabled with no policies: service-role access only (lib/ai/model-config.ts).';
COMMENT ON TABLE public.prompt_configs IS
  'Admin-only. RLS enabled with no policies: service-role access only (lib/ai/prompt-config.ts).';

-- Verify after applying — every row should read rls_enabled = true, policies = 0:
--
--   select c.relname,
--          c.relrowsecurity as rls_enabled,
--          (select count(*) from pg_policies p
--             where p.schemaname = 'public' and p.tablename = c.relname) as policies
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public'
--     and c.relname in ('model_config','model_config_history','prompt_configs',
--                       'prompt_drafts','prompt_history','prompt_test_runs')
--   order by c.relname;
