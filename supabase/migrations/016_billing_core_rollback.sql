-- 016_billing_core_rollback.sql

DROP TABLE IF EXISTS public.billing_webhook_events;
DROP TABLE IF EXISTS public.billing_orders;
DROP TABLE IF EXISTS public.billing_subscriptions;
DROP TABLE IF EXISTS public.billing_customers;
