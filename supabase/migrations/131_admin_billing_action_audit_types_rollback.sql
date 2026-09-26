-- 131_admin_billing_action_audit_types_rollback.sql
--
-- Deliberately does not narrow the CHECK back. Narrowing it would require deleting every audit row
-- written under a Phase 4 action type -- refunds, cancellations, clawbacks -- which is financial
-- history kept eight years (owner decision 6). 096's rollback did exactly that, acceptably, for a
-- tier change; it is not acceptable here.
--
-- So this file only un-records the migration. A CHECK that permits values nothing writes is inert;
-- to genuinely revert Phase 4, revert its code.

DELETE FROM public.schema_migration_ledger WHERE migration_number = 131;
