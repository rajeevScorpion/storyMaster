-- 096_user_entitlement_tier_overrides_rollback.sql
-- Reverts 096. Every promoted account falls back to its billing plan, so any
-- free user who was promoted loses storyboard images again. No coin, wallet, or
-- subscription state is touched — 096 never wrote any.

DROP TABLE IF EXISTS public.user_entitlement_overrides;

-- The restored CHECK cannot coexist with rows written under the new action
-- type, so drop that slice of history before narrowing the constraint.
DELETE FROM public.admin_user_audit_events
WHERE action_type = 'entitlement_tier_changed';

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
      'cohort_executed'
    )
  );
