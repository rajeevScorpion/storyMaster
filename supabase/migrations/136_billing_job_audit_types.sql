-- 136_billing_job_audit_types.sql
--
-- Payments Phase 6, Unit D: adds 'billing_job_retried' and 'billing_document_resent' to
-- admin_user_audit_events.action_type. Until this runs, the admin Retry and Resend actions still work,
-- but their audit rows fail with 23514 and are only logged.
--
-- Trap: the list below must be 131's twelve values plus the two new ones. Rebuilding it from an older
-- migration silently drops Phase 4's refund and cancellation types.
--
-- Verify: the constraint lists fourteen values.

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'admin_user_audit_events'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%cohort_executed%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.admin_user_audit_events DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.admin_user_audit_events
  ADD CONSTRAINT admin_user_audit_events_action_type_check CHECK (
    action_type IN (
      'account_suspended',
      'account_blocked',
      'account_reactivated',
      'coins_granted',
      'cohort_executed',
      'entitlement_tier_changed',
      'subscription_cancelled_at_cycle_end',
      'subscription_cancelled_immediately',
      'payment_refunded',
      'subscription_resynced',
      'webhook_reprocessed',
      'coins_clawed_back',
      'billing_job_retried',
      'billing_document_resent'
    )
  );

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (136, '136_billing_job_audit_types.sql')
ON CONFLICT (migration_number) DO NOTHING;
