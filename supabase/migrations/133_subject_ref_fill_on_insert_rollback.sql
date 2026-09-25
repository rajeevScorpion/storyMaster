-- 133_subject_ref_fill_on_insert_rollback.sql
-- Drops the triggers and function. The subject_ref values 133 backfilled are left in place: they
-- are correct, and nulling them would re-open the gap 133 closed.

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
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.fill_subject_ref_from_user_id();

DELETE FROM public.schema_migration_ledger WHERE migration_number = 133;
