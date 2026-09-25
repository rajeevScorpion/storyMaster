-- 138_international_checkout_us.sql
--
-- Payments Phase 8 (docs/payments/phase-8-plan.md, unit M): the US on Razorpay International.
-- - tax regime 'in_export_lut': export of services, zero-rated under an LUT;
-- - a DRAFT ROW tax rule. ROW checkout refuses ("tax rules unavailable") until the owner publishes it
--   after the CA's answer;
-- - billing_profiles.region: a foreign customer's state or province. A foreign profile stores
--   state_code '96' (GST's "Foreign Country");
-- - flag billing_international_countries: off = no international checkout for anyone. value = the
--   allowed ISO country codes.
--
-- Nothing here opens checkout. pricing_india_only_beta_enabled stays the master lock.
--
-- Verify: select tax_regime, status from public.billing_tax_rules where market_key = 'ROW';
--         -> one row, in_export_lut, draft.

ALTER TABLE public.billing_tax_rules DROP CONSTRAINT IF EXISTS billing_tax_rules_tax_regime_check;
ALTER TABLE public.billing_tax_rules
  ADD CONSTRAINT billing_tax_rules_tax_regime_check CHECK (tax_regime IN ('in_gst', 'none', 'in_export_lut'));

INSERT INTO public.billing_tax_rules (market_key, applies_to, tax_regime, rate_percent, sac_code, supplier_state_code, status, notes)
SELECT 'ROW', 'all', 'in_export_lut', 0, '998439', '24', 'draft',
       'Export of services under LUT. Publish only after the CA confirms (phase-8-plan.md section 6).'
WHERE NOT EXISTS (SELECT 1 FROM public.billing_tax_rules WHERE market_key = 'ROW');

ALTER TABLE public.billing_profiles ADD COLUMN IF NOT EXISTS region text;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('billing_international_countries', false, 'US')
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (138, '138_international_checkout_us.sql')
ON CONFLICT (migration_number) DO NOTHING;
