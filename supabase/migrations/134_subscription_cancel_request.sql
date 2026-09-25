-- Records who asked for a subscription to end at its period end, and when, so "Cancels on <date>"
-- survives a re-sync. Razorpay keeps a cycle-end cancellation `active` until the cycle ends; the sync
-- derived cancel_at_period_end from status alone, so it cleared a scheduled cancel on the next webhook.
-- cancel_at_period_end now means "still running, will not renew": terminal rows are reset to false.
-- Trap: the sync must never set these columns -- only a cancel action does. The sync may only clear
-- cancel_at_period_end once the subscription is terminal.
-- Verify: cancel a test subscription at cycle end, run reconcile, and the row still reads
-- cancel_at_period_end = true with cancel_requested_at set.

ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested_by text
    CHECK (cancel_requested_by IS NULL OR cancel_requested_by IN ('user', 'admin'));

UPDATE public.billing_subscriptions
SET cancel_at_period_end = false
WHERE status IN ('cancelled', 'completed', 'expired') AND cancel_at_period_end;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (134, '134_subscription_cancel_request.sql')
ON CONFLICT (migration_number) DO NOTHING;
