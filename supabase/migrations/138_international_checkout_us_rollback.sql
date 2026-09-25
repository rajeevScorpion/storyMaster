-- 138_international_checkout_us_rollback.sql
--
-- Trap: dropping billing_profiles.region deletes foreign customers' state or province. Past payments
-- keep theirs in customer_snapshot_json. Roll back only while there are no ROW payments.

DELETE FROM public.billing_tax_rules WHERE tax_regime = 'in_export_lut';
ALTER TABLE public.billing_tax_rules DROP CONSTRAINT IF EXISTS billing_tax_rules_tax_regime_check;
ALTER TABLE public.billing_tax_rules
  ADD CONSTRAINT billing_tax_rules_tax_regime_check CHECK (tax_regime IN ('in_gst', 'none'));

ALTER TABLE public.billing_profiles DROP COLUMN IF EXISTS region;

DELETE FROM public.feature_flags WHERE flag_key = 'billing_international_countries';
DELETE FROM public.schema_migration_ledger WHERE migration_number = 138;
