-- 132_admin_billing_clawback_rollback.sql
--
-- Drops the clawback/restore function. Audit rows it already wrote (action_type
-- 'coins_clawed_back') are financial history and are not touched, matching 131's rollback stance on
-- rows written under its own new vocabulary.

DROP FUNCTION IF EXISTS public.admin_adjust_purchase_grant_beats(uuid, uuid, uuid, numeric, text, text, text);

DELETE FROM public.schema_migration_ledger WHERE migration_number = 132;
