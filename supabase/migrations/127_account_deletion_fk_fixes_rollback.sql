-- Rollback for 127_account_deletion_fk_fixes.sql. Restores NO ACTION on the five
-- admin-attribution FKs and CASCADE + NOT NULL on billing_profiles.user_id, and
-- drops subject_ref. Cannot restore a user_id already nulled by an anonymisation
-- that has already run -- those rows stay orphaned from their account, and the
-- SET NOT NULL below will fail loudly if any exist rather than silently corrupt data.

DO $$ BEGIN
  ALTER TABLE public.pricing_plan_versions DROP CONSTRAINT IF EXISTS pricing_plan_versions_published_by_fkey;
  ALTER TABLE public.pricing_plan_versions ADD CONSTRAINT pricing_plan_versions_published_by_fkey
    FOREIGN KEY (published_by) REFERENCES auth.users(id);
END $$;

DO $$ BEGIN
  ALTER TABLE public.pricing_topup_packs DROP CONSTRAINT IF EXISTS pricing_topup_packs_published_by_fkey;
  ALTER TABLE public.pricing_topup_packs ADD CONSTRAINT pricing_topup_packs_published_by_fkey
    FOREIGN KEY (published_by) REFERENCES auth.users(id);
END $$;

DO $$ BEGIN
  ALTER TABLE public.pricing_action_costs DROP CONSTRAINT IF EXISTS pricing_action_costs_updated_by_fkey;
  ALTER TABLE public.pricing_action_costs ADD CONSTRAINT pricing_action_costs_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id);
END $$;

DO $$ BEGIN
  ALTER TABLE public.pricing_publish_audit DROP CONSTRAINT IF EXISTS pricing_publish_audit_performed_by_fkey;
  ALTER TABLE public.pricing_publish_audit ADD CONSTRAINT pricing_publish_audit_performed_by_fkey
    FOREIGN KEY (performed_by) REFERENCES auth.users(id);
END $$;

DO $$ BEGIN
  ALTER TABLE public.reel_moods DROP CONSTRAINT IF EXISTS reel_moods_created_by_fkey;
  ALTER TABLE public.reel_moods ADD CONSTRAINT reel_moods_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id);
END $$;

DO $$ BEGIN
  ALTER TABLE public.reel_moods DROP CONSTRAINT IF EXISTS reel_moods_updated_by_fkey;
  ALTER TABLE public.reel_moods ADD CONSTRAINT reel_moods_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id);
END $$;

DO $$ BEGIN
  ALTER TABLE public.billing_profiles DROP CONSTRAINT IF EXISTS billing_profiles_user_id_fkey;
  ALTER TABLE public.billing_profiles ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.billing_profiles ADD CONSTRAINT billing_profiles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  DROP INDEX IF EXISTS idx_billing_profiles_subject_ref;
  ALTER TABLE public.billing_profiles DROP COLUMN IF EXISTS subject_ref;
END $$;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 127;
