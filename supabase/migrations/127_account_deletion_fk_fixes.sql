-- 127_account_deletion_fk_fixes.sql
--
-- Payments Phase 2, Unit C (docs/payments/phase-2-plan.md): five admin-attribution
-- foreign keys onto auth.users were left with no delete rule (NO ACTION, the
-- Postgres default) -- the same trap 125 already fixed once for beats.generated_by.
-- Any admin who had ever published a price or a reel mood would block their own
-- self-serve deletion with a foreign key violation. All five become SET NULL.
-- billing_profiles moves from CASCADE to SET NULL + subject_ref, matching the six
-- billing/wallet tables 125 already converted: its GST fields (legal name, state,
-- GSTIN) are worth keeping on a retained ledger even though the row itself used
-- to be deleted outright with the account.
--
-- Left alone deliberately: beat_revisions, timeline_rewrite_events and
-- episode_journal_events still CASCADE from auth.users even though the story or
-- episode_branch they narrate can survive ownerless -- losing that edit/series
-- history on deletion is today's behaviour, not a bug this migration fixes, and
-- changing it is a product decision for the owner, not an executor's guess.
--
-- Verify: select conname, confdeltype from pg_constraint
--   where conname in ('pricing_plan_versions_published_by_fkey',
--     'pricing_topup_packs_published_by_fkey', 'pricing_action_costs_updated_by_fkey',
--     'pricing_publish_audit_performed_by_fkey', 'reel_moods_created_by_fkey',
--     'reel_moods_updated_by_fkey', 'billing_profiles_user_id_fkey'); -- all 'n' (set null)

DO $$ BEGIN
  ALTER TABLE public.pricing_plan_versions DROP CONSTRAINT IF EXISTS pricing_plan_versions_published_by_fkey;
  ALTER TABLE public.pricing_plan_versions ADD CONSTRAINT pricing_plan_versions_published_by_fkey
    FOREIGN KEY (published_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.pricing_topup_packs DROP CONSTRAINT IF EXISTS pricing_topup_packs_published_by_fkey;
  ALTER TABLE public.pricing_topup_packs ADD CONSTRAINT pricing_topup_packs_published_by_fkey
    FOREIGN KEY (published_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.pricing_action_costs DROP CONSTRAINT IF EXISTS pricing_action_costs_updated_by_fkey;
  ALTER TABLE public.pricing_action_costs ADD CONSTRAINT pricing_action_costs_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.pricing_publish_audit DROP CONSTRAINT IF EXISTS pricing_publish_audit_performed_by_fkey;
  ALTER TABLE public.pricing_publish_audit ADD CONSTRAINT pricing_publish_audit_performed_by_fkey
    FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.reel_moods DROP CONSTRAINT IF EXISTS reel_moods_created_by_fkey;
  ALTER TABLE public.reel_moods ADD CONSTRAINT reel_moods_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.reel_moods DROP CONSTRAINT IF EXISTS reel_moods_updated_by_fkey;
  ALTER TABLE public.reel_moods ADD CONSTRAINT reel_moods_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.billing_profiles ADD COLUMN IF NOT EXISTS subject_ref uuid;
  UPDATE public.billing_profiles SET subject_ref = user_id WHERE subject_ref IS NULL;
  CREATE INDEX IF NOT EXISTS idx_billing_profiles_subject_ref ON public.billing_profiles (subject_ref);
  ALTER TABLE public.billing_profiles DROP CONSTRAINT IF EXISTS billing_profiles_user_id_fkey;
  ALTER TABLE public.billing_profiles ALTER COLUMN user_id DROP NOT NULL;
  ALTER TABLE public.billing_profiles ADD CONSTRAINT billing_profiles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (127, '127_account_deletion_fk_fixes.sql')
ON CONFLICT (migration_number) DO NOTHING;
