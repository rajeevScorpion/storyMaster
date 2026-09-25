-- 126_razorpay_plan_gross_ref.sql
--
-- Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): "one Razorpay plan per gross
-- amount" (plan §2 decision 7). provider_price_ref was only ever keyed on provider_mode, so a GST
-- rate change reused the old plan's amount silently. A new column instead of overloading
-- provider_price_ref_mode, so a database without 126 can still read the row (select('*') simply
-- omits an unknown column) and app code falls back to reuse-on-mode-alone, exactly as before.
--
-- Precheck (expect 0 rows):
--   select column_name from information_schema.columns
--     where table_name = 'pricing_plan_versions' and column_name = 'provider_price_ref_gross_minor';
--
-- Trap: this column is NULL for every plan version created before 126 runs, including ones with an
-- existing provider_price_ref -- app code must treat "column present but NULL" the same as "no
-- gross recorded yet" (always recreate the plan), not assume NULL means "gross matches".
--
-- Verify: select column_name from information_schema.columns
--   where table_name = 'pricing_plan_versions' and column_name = 'provider_price_ref_gross_minor';

ALTER TABLE public.pricing_plan_versions
  ADD COLUMN IF NOT EXISTS provider_price_ref_gross_minor bigint;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (126, '126_razorpay_plan_gross_ref.sql')
ON CONFLICT (migration_number) DO NOTHING;
