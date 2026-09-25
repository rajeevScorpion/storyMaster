-- 137_billing_checkout_allowlist_rollback.sql
--
-- Removing the row lifts the restriction: an absent flag means checkout is open to everyone.

DELETE FROM public.feature_flags WHERE flag_key = 'billing_checkout_allowlist';
DELETE FROM public.schema_migration_ledger WHERE migration_number = 137;
