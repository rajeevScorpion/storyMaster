-- 136_billing_job_audit_types_rollback.sql
--
-- Deliberately does not narrow the CHECK back, for the same reason as 131's rollback: narrowing would
-- require deleting the audit rows written under the two new types. A CHECK that permits values nothing
-- writes is inert; to revert, revert the code.

DELETE FROM public.schema_migration_ledger WHERE migration_number = 136;
