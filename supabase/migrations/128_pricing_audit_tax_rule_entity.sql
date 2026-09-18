-- 128_pricing_audit_tax_rule_entity.sql
--
-- Payments Phase 2, Unit B2b. billing_tax_rules is the one pricing entity whose publish and archive
-- write no pricing_publish_audit row: entity_type's CHECK (015_pricing_catalog.sql:88) predates it,
-- so inserting 'tax_rule' raises 23514. A rate change alters what every customer is charged, which
-- is the last thing that should go unrecorded.
--
-- action_type already allows create_draft/update_draft/publish/archive; only entity_type is widened.
--
-- Until this is applied, lib/billing/tax-rules-admin.ts deliberately writes no audit row rather than
-- reusing another entity's type. Applying it does not by itself start the auditing -- that call has
-- to be added back to publishTaxRule/archiveTaxRule.
--
-- Verify: select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'pricing_publish_audit_entity_type_check';  -- includes 'tax_rule'

ALTER TABLE public.pricing_publish_audit
  DROP CONSTRAINT IF EXISTS pricing_publish_audit_entity_type_check;

ALTER TABLE public.pricing_publish_audit
  ADD CONSTRAINT pricing_publish_audit_entity_type_check
  CHECK (entity_type IN ('plan_version', 'topup_pack', 'action_cost', 'promotion', 'runtime_setting', 'tax_rule'));

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (128, '128_pricing_audit_tax_rule_entity.sql')
ON CONFLICT (migration_number) DO NOTHING;
