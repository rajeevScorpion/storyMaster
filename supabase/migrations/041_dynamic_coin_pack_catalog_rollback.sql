-- 041_dynamic_coin_pack_catalog_rollback.sql

DELETE FROM public.pricing_topup_packs
WHERE status = 'draft'
  AND pack_key IN ('coins_120', 'coins_240', 'coins_480', 'coins_960')
  AND (extensions_json ->> 'seedNote') = 'dynamic coin pack catalog v1';
