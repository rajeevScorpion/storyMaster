-- The cancel_at_period_end reset is not reversed: the pre-134 sync re-derives it on the next webhook.
ALTER TABLE public.billing_subscriptions
  DROP COLUMN IF EXISTS cancel_requested_by,
  DROP COLUMN IF EXISTS cancel_requested_at;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 134;
