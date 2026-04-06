-- 016_billing_core.sql
-- Add provider-mirror billing tables and webhook traceability.

CREATE TABLE IF NOT EXISTS public.billing_customers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider text NOT NULL CHECK (provider IN ('stripe', 'razorpay')),
  provider_customer_id text NOT NULL,
  pricing_market_key text NOT NULL CHECK (pricing_market_key IN ('IN', 'ROW')),
  country_code text,
  currency_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider),
  UNIQUE(provider, provider_customer_id)
);

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  plan_version_id uuid REFERENCES public.pricing_plan_versions(id) NOT NULL,
  provider text NOT NULL CHECK (provider IN ('stripe', 'razorpay')),
  provider_subscription_id text NOT NULL,
  provider_customer_id text NOT NULL,
  status text NOT NULL,
  billing_interval text NOT NULL CHECK (billing_interval IN ('monthly', 'annual')),
  currency_code text NOT NULL,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  grace_period_ends_at timestamptz,
  last_webhook_at timestamptz,
  raw_provider_state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_subscription_id)
);

CREATE TABLE IF NOT EXISTS public.billing_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider text NOT NULL CHECK (provider IN ('stripe', 'razorpay')),
  order_type text NOT NULL CHECK (order_type IN ('subscription_checkout', 'topup_checkout')),
  provider_checkout_session_id text,
  provider_order_id text,
  provider_payment_id text,
  currency_code text NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  status text NOT NULL DEFAULT 'created',
  plan_version_id uuid REFERENCES public.pricing_plan_versions(id),
  topup_pack_id uuid REFERENCES public.pricing_topup_packs(id),
  raw_provider_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('stripe', 'razorpay')),
  event_type text NOT NULL,
  provider_event_id text NOT NULL,
  provider_account_id text,
  status text NOT NULL CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  related_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  related_subscription_id uuid REFERENCES public.billing_subscriptions(id) ON DELETE SET NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_message text,
  UNIQUE(provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_customers_user
  ON public.billing_customers(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user_status
  ON public.billing_subscriptions(user_id, status, current_period_end DESC);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_plan
  ON public.billing_subscriptions(plan_version_id, provider, status);

CREATE INDEX IF NOT EXISTS idx_billing_orders_user_status
  ON public.billing_orders(user_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_orders_checkout_session
  ON public.billing_orders(provider, provider_checkout_session_id)
  WHERE provider_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_orders_provider_order
  ON public.billing_orders(provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_orders_provider_payment
  ON public.billing_orders(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_status
  ON public.billing_webhook_events(provider, status, received_at DESC);

ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
