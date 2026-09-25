-- Rollback for 126_razorpay_plan_gross_ref.sql
--
-- Drops the gross-amount column app code uses to decide whether a cached Razorpay plan ref can be
-- reused. Safe at any time -- app code already tolerates the column being absent.

ALTER TABLE public.pricing_plan_versions
  DROP COLUMN IF EXISTS provider_price_ref_gross_minor;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 126;
