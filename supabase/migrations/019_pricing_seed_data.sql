-- 019_pricing_seed_data.sql
-- Seed launch-safe pricing catalog data.
--
-- Intentional safety choice:
-- - free plan variants are seeded as published for both markets
-- - ROW paid variants are seeded as published using the current USD strategy baseline
-- - IN paid variants and IN top-up packs are seeded as drafts with zero-value placeholders
--   so India pricing can be tuned in admin before any checkout flow is enabled

WITH upsert_plans AS (
  INSERT INTO public.pricing_plans (plan_key, name, tier_rank, is_active, is_public, description, feature_flags_json)
  VALUES
    (
      'free',
      'Free',
      1,
      true,
      true,
      'Discovery plan for short shared story creation.',
      jsonb_build_object(
        'canAccessDownloads', false,
        'canAccessUnbrandedExports', false,
        'creatorControls', false
      )
    ),
    (
      'plus',
      'Plus',
      2,
      true,
      true,
      'Core family plan for recurring story creation.',
      jsonb_build_object(
        'canAccessDownloads', false,
        'canAccessUnbrandedExports', false,
        'creatorControls', false
      )
    ),
    (
      'studio',
      'Studio',
      3,
      true,
      true,
      'Creator-facing plan with export-oriented entitlements.',
      jsonb_build_object(
        'canAccessDownloads', true,
        'canAccessUnbrandedExports', true,
        'creatorControls', true
      )
    )
  ON CONFLICT (plan_key) DO UPDATE
  SET
    name = EXCLUDED.name,
    tier_rank = EXCLUDED.tier_rank,
    is_active = EXCLUDED.is_active,
    is_public = EXCLUDED.is_public,
    description = EXCLUDED.description,
    feature_flags_json = EXCLUDED.feature_flags_json,
    updated_at = now()
  RETURNING id, plan_key
)
INSERT INTO public.pricing_plan_versions (
  plan_id,
  status,
  provider,
  billing_interval,
  currency_code,
  pricing_market_key,
  price_minor,
  monthly_included_beats,
  carry_forward_cap_multiplier,
  story_length_cap,
  grace_period_days,
  extensions_json,
  published_at
)
SELECT
  p.id,
  v.status,
  v.provider,
  v.billing_interval,
  v.currency_code,
  v.pricing_market_key,
  v.price_minor,
  v.monthly_included_beats,
  v.carry_forward_cap_multiplier,
  v.story_length_cap,
  v.grace_period_days,
  v.extensions_json,
  CASE WHEN v.status = 'published' THEN now() ELSE null END
FROM upsert_plans p
JOIN (
  VALUES
    ('free',   'published', null::text, 'monthly', 'USD', 'ROW',     0,  12, 2.00::numeric, 4, 5, jsonb_build_object('seedNote', 'launch free plan')),
    ('free',   'published', null::text, 'monthly', 'INR', 'IN',      0,  12, 2.00::numeric, 4, 5, jsonb_build_object('seedNote', 'launch free plan')),
    ('plus',   'published', 'stripe',   'monthly', 'USD', 'ROW',  1200, 100, 2.00::numeric, 8, 5, jsonb_build_object('seedNote', 'strategy baseline USD monthly')),
    ('plus',   'published', 'stripe',   'annual',  'USD', 'ROW', 10800, 100, 2.00::numeric, 8, 5, jsonb_build_object('seedNote', 'strategy baseline USD annual')),
    ('studio', 'published', 'stripe',   'monthly', 'USD', 'ROW',  2900, 300, 2.00::numeric, 8, 5, jsonb_build_object('seedNote', 'strategy baseline USD monthly')),
    ('studio', 'published', 'stripe',   'annual',  'USD', 'ROW', 29000, 300, 2.00::numeric, 8, 5, jsonb_build_object('seedNote', 'strategy baseline USD annual')),
    ('plus',   'draft',     'razorpay', 'monthly', 'INR', 'IN',      0, 100, 2.00::numeric, 8, 5, jsonb_build_object('seedNote', 'IN pricing pending finalization')),
    ('plus',   'draft',     'razorpay', 'annual',  'INR', 'IN',      0, 100, 2.00::numeric, 8, 5, jsonb_build_object('seedNote', 'IN pricing pending finalization')),
    ('studio', 'draft',     'razorpay', 'monthly', 'INR', 'IN',      0, 300, 2.00::numeric, 8, 5, jsonb_build_object('seedNote', 'IN pricing pending finalization')),
    ('studio', 'draft',     'razorpay', 'annual',  'INR', 'IN',      0, 300, 2.00::numeric, 8, 5, jsonb_build_object('seedNote', 'IN pricing pending finalization'))
) AS v(plan_key, status, provider, billing_interval, currency_code, pricing_market_key, price_minor, monthly_included_beats, carry_forward_cap_multiplier, story_length_cap, grace_period_days, extensions_json)
  ON v.plan_key = p.plan_key
WHERE NOT EXISTS (
  SELECT 1
  FROM public.pricing_plan_versions existing
  WHERE existing.plan_id = p.id
    AND existing.status = v.status
    AND existing.billing_interval = v.billing_interval
    AND existing.currency_code = v.currency_code
    AND existing.pricing_market_key = v.pricing_market_key
);

INSERT INTO public.pricing_topup_packs (
  pack_key,
  status,
  provider,
  name,
  currency_code,
  pricing_market_key,
  price_minor,
  beat_amount,
  extensions_json,
  published_at
)
SELECT *
FROM (
  VALUES
    ('beats_25',  'published', 'stripe',   '250 Coins',   'USD', 'ROW',  400,  25, jsonb_build_object('seedNote', 'strategy baseline USD top-up'), now()),
    ('beats_80',  'published', 'stripe',   '800 Coins',   'USD', 'ROW', 1000,  80, jsonb_build_object('seedNote', 'strategy baseline USD top-up'), now()),
    ('beats_200', 'published', 'stripe',   '2,000 Coins', 'USD', 'ROW', 2000, 200, jsonb_build_object('seedNote', 'strategy baseline USD top-up'), now()),
    ('beats_25',  'draft',     'razorpay', '250 Coins',   'INR', 'IN',     0,  25, jsonb_build_object('seedNote', 'IN pricing pending finalization'), null),
    ('beats_80',  'draft',     'razorpay', '800 Coins',   'INR', 'IN',     0,  80, jsonb_build_object('seedNote', 'IN pricing pending finalization'), null),
    ('beats_200', 'draft',     'razorpay', '2,000 Coins', 'INR', 'IN',     0, 200, jsonb_build_object('seedNote', 'IN pricing pending finalization'), null)
) AS seed(pack_key, status, provider, name, currency_code, pricing_market_key, price_minor, beat_amount, extensions_json, published_at)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.pricing_topup_packs existing
  WHERE existing.pack_key = seed.pack_key
    AND existing.status = seed.status
    AND existing.currency_code = seed.currency_code
    AND existing.pricing_market_key = seed.pricing_market_key
);

INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active)
VALUES
  ('start_story_initial_beat', 1, true),
  ('continue_story_new_beat', 1, true),
  ('regenerate_image', 1, true),
  ('regenerate_narration', 1, true),
  ('export_video_future', 5, true)
ON CONFLICT (action_key) DO UPDATE
SET
  beat_cost = EXCLUDED.beat_cost,
  is_active = EXCLUDED.is_active,
  updated_at = now();
