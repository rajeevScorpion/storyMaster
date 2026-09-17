-- 124_billing_money_correctness_rollback.sql
-- Trap: after live payments, prefer turning checkout off over rolling back — the added columns hold snapshots and
-- modes that later phases rely on. Dropping the index re-opens double grants.

DROP FUNCTION IF EXISTS public.billing_begin_subscription_checkout(uuid, uuid, text, jsonb);
DROP INDEX IF EXISTS public.idx_billing_orders_reconcile;
DROP INDEX IF EXISTS public.uq_beat_grants_purchase_source;
ALTER TABLE public.billing_webhook_events DROP COLUMN IF EXISTS outcome, DROP COLUMN IF EXISTS last_attempt_at, DROP COLUMN IF EXISTS attempt_count;
ALTER TABLE public.pricing_plan_versions DROP COLUMN IF EXISTS provider_price_ref_mode;
ALTER TABLE public.billing_subscriptions DROP COLUMN IF EXISTS first_charge_confirmed_at, DROP COLUMN IF EXISTS provider_mode;
ALTER TABLE public.billing_orders DROP COLUMN IF EXISTS purchase_snapshot_json, DROP COLUMN IF EXISTS provider_mode;
DELETE FROM public.feature_flags WHERE flag_key = 'billing_reconcile_enabled';
DELETE FROM public.schema_migration_ledger WHERE migration_number = 124;
