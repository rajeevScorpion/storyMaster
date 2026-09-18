-- Rollback for 128_pricing_audit_tax_rule_entity.sql
--
-- Fails if any pricing_publish_audit row already carries entity_type 'tax_rule'. Delete or
-- reclassify those rows first, deliberately -- they are the audit trail of a tax-rate change.

ALTER TABLE public.pricing_publish_audit
  DROP CONSTRAINT IF EXISTS pricing_publish_audit_entity_type_check;

ALTER TABLE public.pricing_publish_audit
  ADD CONSTRAINT pricing_publish_audit_entity_type_check
  CHECK (entity_type IN ('plan_version', 'topup_pack', 'action_cost', 'promotion', 'runtime_setting'));

DELETE FROM public.schema_migration_ledger WHERE migration_number = 128;
