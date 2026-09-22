-- 133_subject_ref_fill_on_insert.sql
--
-- Fixes: 125/127 backfilled subject_ref once, but no writer sets it -- not the top-up/subscription
-- grants in razorpay-sync.ts, not the welcome/admin grant functions, not the billing-profile upsert.
-- Found by the money walk: the first real top-up's grant and the buyer's billing profile both landed
-- with subject_ref null, so an account deletion would have orphaned them.
--
-- The trap: fixing each writer instead. There are at least five, two of them SQL functions, and the
-- next one written will forget too. A BEFORE INSERT trigger covers every writer, present and future.
-- COALESCE keeps an explicit subject_ref untouched; UPDATEs are left alone, so anonymisation (which
-- nulls user_id) never disturbs it.
--
-- Verify: select count(*) from beat_grants where subject_ref is null and user_id is not null; -- 0,
-- and the same for billing_profiles.

CREATE OR REPLACE FUNCTION public.fill_subject_ref_from_user_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.subject_ref := COALESCE(NEW.subject_ref, NEW.user_id);
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'billing_customers', 'billing_orders', 'billing_subscriptions', 'billing_profiles',
    'beat_grants', 'beat_usage_events', 'legal_acceptances'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_subject_ref ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_fill_subject_ref BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.fill_subject_ref_from_user_id()',
      t
    );
    EXECUTE format('UPDATE public.%I SET subject_ref = user_id WHERE subject_ref IS NULL AND user_id IS NOT NULL', t);
  END LOOP;
END;
$$;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (133, '133_subject_ref_fill_on_insert.sql')
ON CONFLICT (migration_number) DO NOTHING;
