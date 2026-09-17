-- 125_billing_ledger_and_retention_rollback.sql
-- Trap: cannot bring back rows a deletion has already anonymised (user_id was set NULL and is not
-- recoverable) -- restoring CASCADE afterwards only changes future deletes. Must not be run once
-- real billing_documents rows have been issued: uq_billing_documents_number and the FKs from
-- billing_payments/billing_refunds are gone, so re-applying 125 would restart numbering at 1.

DROP FUNCTION IF EXISTS public.billing_next_document_number(text, text);

DO $$ BEGIN
  ALTER TABLE public.episode_branches DROP CONSTRAINT IF EXISTS episode_branches_user_id_fkey;
  ALTER TABLE public.episode_branches ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.episode_branches ADD CONSTRAINT episode_branches_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

DO $$ BEGIN
  ALTER TABLE public.story_bibles DROP CONSTRAINT IF EXISTS story_bibles_user_id_fkey;
  ALTER TABLE public.story_bibles ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.story_bibles ADD CONSTRAINT story_bibles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

DO $$ BEGIN
  ALTER TABLE public.character_masters DROP CONSTRAINT IF EXISTS character_masters_user_id_fkey;
  ALTER TABLE public.character_masters ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.character_masters ADD CONSTRAINT character_masters_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

DO $$ BEGIN
  ALTER TABLE public.beats DROP CONSTRAINT IF EXISTS beats_generated_by_fkey;
  ALTER TABLE public.beats ADD CONSTRAINT beats_generated_by_fkey
    FOREIGN KEY (generated_by) REFERENCES auth.users(id);
END $$;

DO $$ BEGIN
  ALTER TABLE public.storylines DROP CONSTRAINT IF EXISTS storylines_user_id_fkey;
  ALTER TABLE public.storylines ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.storylines ADD CONSTRAINT storylines_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

DO $$ BEGIN
  ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_user_id_fkey;
  ALTER TABLE public.stories ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.stories ADD CONSTRAINT stories_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

DO $$ BEGIN
  ALTER TABLE public.legal_acceptances DROP CONSTRAINT IF EXISTS legal_acceptances_user_id_fkey;
  ALTER TABLE public.legal_acceptances ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.legal_acceptances ADD CONSTRAINT legal_acceptances_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  DROP INDEX IF EXISTS public.idx_legal_acceptances_subject_ref;
  ALTER TABLE public.legal_acceptances DROP COLUMN IF EXISTS subject_ref;
END $$;

DO $$ BEGIN
  ALTER TABLE public.beat_usage_events DROP CONSTRAINT IF EXISTS beat_usage_events_user_id_fkey;
  ALTER TABLE public.beat_usage_events ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.beat_usage_events ADD CONSTRAINT beat_usage_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  DROP INDEX IF EXISTS public.idx_beat_usage_events_subject_ref;
  ALTER TABLE public.beat_usage_events DROP COLUMN IF EXISTS subject_ref;
END $$;

DO $$ BEGIN
  ALTER TABLE public.beat_grants DROP CONSTRAINT IF EXISTS beat_grants_user_id_fkey;
  ALTER TABLE public.beat_grants ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.beat_grants ADD CONSTRAINT beat_grants_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  DROP INDEX IF EXISTS public.idx_beat_grants_subject_ref;
  ALTER TABLE public.beat_grants DROP COLUMN IF EXISTS subject_ref;
END $$;

DO $$ BEGIN
  ALTER TABLE public.billing_subscriptions DROP CONSTRAINT IF EXISTS billing_subscriptions_user_id_fkey;
  ALTER TABLE public.billing_subscriptions ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.billing_subscriptions ADD CONSTRAINT billing_subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  DROP INDEX IF EXISTS public.idx_billing_subscriptions_subject_ref;
  ALTER TABLE public.billing_subscriptions DROP COLUMN IF EXISTS subject_ref;
END $$;

DO $$ BEGIN
  ALTER TABLE public.billing_orders DROP CONSTRAINT IF EXISTS billing_orders_user_id_fkey;
  ALTER TABLE public.billing_orders ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.billing_orders ADD CONSTRAINT billing_orders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  DROP INDEX IF EXISTS public.idx_billing_orders_subject_ref;
  ALTER TABLE public.billing_orders DROP COLUMN IF EXISTS subject_ref;
END $$;

DO $$ BEGIN
  ALTER TABLE public.billing_customers DROP CONSTRAINT IF EXISTS billing_customers_user_id_fkey;
  ALTER TABLE public.billing_customers ALTER COLUMN user_id SET NOT NULL;
  ALTER TABLE public.billing_customers ADD CONSTRAINT billing_customers_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  DROP INDEX IF EXISTS public.idx_billing_customers_subject_ref;
  ALTER TABLE public.billing_customers DROP COLUMN IF EXISTS subject_ref;
END $$;

DROP TABLE IF EXISTS public.account_deletion_events;
DROP TABLE IF EXISTS public.billing_document_sequences;
DROP TABLE IF EXISTS public.billing_documents;
DROP TABLE IF EXISTS public.billing_refunds;
DROP TABLE IF EXISTS public.billing_payments;
DROP TABLE IF EXISTS public.billing_tax_rules;
DROP TABLE IF EXISTS public.billing_profiles;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 125;
