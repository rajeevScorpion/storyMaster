-- 015_pricing_catalog.sql
-- Add admin-authored pricing catalog tables for plans, top-ups, action costs, promotions, and audit history.

CREATE TABLE IF NOT EXISTS public.pricing_plans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_key text NOT NULL UNIQUE,
  name text NOT NULL,
  tier_rank integer NOT NULL CHECK (tier_rank > 0),
  is_active boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT true,
  description text,
  feature_flags_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pricing_plan_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id uuid REFERENCES public.pricing_plans(id) ON DELETE CASCADE NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  provider text CHECK (provider IS NULL OR provider IN ('stripe', 'razorpay')),
  billing_interval text NOT NULL CHECK (billing_interval IN ('monthly', 'annual')),
  currency_code text NOT NULL,
  pricing_market_key text NOT NULL CHECK (pricing_market_key IN ('IN', 'ROW')),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  monthly_included_beats integer NOT NULL CHECK (monthly_included_beats >= 0),
  carry_forward_cap_multiplier numeric(6,2) NOT NULL CHECK (carry_forward_cap_multiplier >= 0),
  story_length_cap integer NOT NULL CHECK (story_length_cap >= 1),
  grace_period_days integer NOT NULL CHECK (grace_period_days >= 0),
  provider_product_ref text,
  provider_price_ref text,
  extensions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pricing_topup_packs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pack_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  provider text CHECK (provider IS NULL OR provider IN ('stripe', 'razorpay')),
  name text NOT NULL,
  currency_code text NOT NULL,
  pricing_market_key text NOT NULL CHECK (pricing_market_key IN ('IN', 'ROW')),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  beat_amount integer NOT NULL CHECK (beat_amount > 0),
  provider_product_ref text,
  provider_price_ref text,
  extensions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pricing_action_costs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  action_key text NOT NULL UNIQUE,
  beat_cost integer NOT NULL CHECK (beat_cost >= 0),
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.pricing_promotions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  promo_key text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  pricing_market_scope text NOT NULL CHECK (pricing_market_scope IN ('ALL', 'IN', 'ROW')),
  target_plan_key text REFERENCES public.pricing_plans(plan_key),
  target_user_segment text,
  bonus_beats integer NOT NULL CHECK (bonus_beats >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  promo_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.pricing_publish_audit (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('plan_version', 'topup_pack', 'action_cost', 'promotion', 'runtime_setting')),
  entity_id uuid,
  action_type text NOT NULL CHECK (action_type IN ('create_draft', 'update_draft', 'publish', 'archive', 'immediate_update')),
  performed_by uuid REFERENCES auth.users(id),
  before_json jsonb,
  after_json jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_plans_tier_rank
  ON public.pricing_plans(tier_rank, is_public, is_active);

CREATE INDEX IF NOT EXISTS idx_pricing_plan_versions_variant_lookup
  ON public.pricing_plan_versions(pricing_market_key, currency_code, billing_interval, status);

CREATE INDEX IF NOT EXISTS idx_pricing_plan_versions_plan_lookup
  ON public.pricing_plan_versions(plan_id, billing_interval, pricing_market_key, currency_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_plan_versions_draft_variant
  ON public.pricing_plan_versions(plan_id, billing_interval, pricing_market_key, currency_code)
  WHERE status = 'draft';

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_plan_versions_published_variant
  ON public.pricing_plan_versions(plan_id, billing_interval, pricing_market_key, currency_code)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_pricing_topup_packs_market_status
  ON public.pricing_topup_packs(pricing_market_key, currency_code, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_topup_packs_draft_variant
  ON public.pricing_topup_packs(pack_key, pricing_market_key, currency_code)
  WHERE status = 'draft';

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_topup_packs_published_variant
  ON public.pricing_topup_packs(pack_key, pricing_market_key, currency_code)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_pricing_promotions_active_window
  ON public.pricing_promotions(pricing_market_scope, starts_at, ends_at)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_pricing_publish_audit_entity
  ON public.pricing_publish_audit(entity_type, entity_id, created_at DESC);

ALTER TABLE public.pricing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_topup_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_action_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_publish_audit ENABLE ROW LEVEL SECURITY;
