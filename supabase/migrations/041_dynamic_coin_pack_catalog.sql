-- 041_dynamic_coin_pack_catalog.sql
-- Seed draft coin-pack families for the dynamic top-up catalog without
-- disturbing the currently published legacy packs.

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
    ('coins_120', 'draft', 'razorpay', '120 Coins', 'INR', 'IN', 0, 12, jsonb_build_object('seedNote', 'dynamic coin pack catalog v1'), null::timestamptz),
    ('coins_240', 'draft', 'razorpay', '240 Coins', 'INR', 'IN', 0, 24, jsonb_build_object('seedNote', 'dynamic coin pack catalog v1'), null::timestamptz),
    ('coins_480', 'draft', 'razorpay', '480 Coins', 'INR', 'IN', 0, 48, jsonb_build_object('seedNote', 'dynamic coin pack catalog v1'), null::timestamptz),
    ('coins_960', 'draft', 'razorpay', '960 Coins', 'INR', 'IN', 0, 96, jsonb_build_object('seedNote', 'dynamic coin pack catalog v1'), null::timestamptz),
    ('coins_120', 'draft', 'stripe', '120 Coins', 'USD', 'ROW', 0, 12, jsonb_build_object('seedNote', 'dynamic coin pack catalog v1'), null::timestamptz),
    ('coins_240', 'draft', 'stripe', '240 Coins', 'USD', 'ROW', 0, 24, jsonb_build_object('seedNote', 'dynamic coin pack catalog v1'), null::timestamptz),
    ('coins_480', 'draft', 'stripe', '480 Coins', 'USD', 'ROW', 0, 48, jsonb_build_object('seedNote', 'dynamic coin pack catalog v1'), null::timestamptz),
    ('coins_960', 'draft', 'stripe', '960 Coins', 'USD', 'ROW', 0, 96, jsonb_build_object('seedNote', 'dynamic coin pack catalog v1'), null::timestamptz)
) AS seed(pack_key, status, provider, name, currency_code, pricing_market_key, price_minor, beat_amount, extensions_json, published_at)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.pricing_topup_packs existing
  WHERE existing.pack_key = seed.pack_key
    AND existing.status = seed.status
    AND existing.currency_code = seed.currency_code
    AND existing.pricing_market_key = seed.pricing_market_key
);
