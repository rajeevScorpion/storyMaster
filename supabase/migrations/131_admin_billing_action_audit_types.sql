-- 131_admin_billing_action_audit_types.sql
--
-- Payments Phase 4, Unit A (docs/payments/phase-4-plan.md §4). Widens
-- admin_user_audit_events.action_type so Phase 4's support actions can be audited at all -- the
-- CHECK is hardcoded, so every new action is a 23514 until it names them.
--
-- All six candidate values are added now, ahead of the actions themselves: owner decisions D1-D3
-- settle which actions ship, not what they are called, and a CHECK permitting a value nothing
-- writes is inert. This keeps Unit A off the decision gate.
--
-- Trap: do NOT copy 096's rollback. It narrows the CHECK back, which forces it to DELETE the rows
-- written under the new values first. Here those rows are refund and cancellation history, kept
-- eight years (owner decision 6). This migration's rollback therefore narrows nothing.
--
-- Verify: the constraint below lists twelve values on both dev and prod.

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
      'coins_clawed_back'
    )
  );

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (131, '131_admin_billing_action_audit_types.sql')
ON CONFLICT (migration_number) DO NOTHING;
