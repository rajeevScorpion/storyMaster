-- 020_rename_seeded_topup_pack_labels_to_coins_rollback.sql
-- Revert the seeded top-up pack labels back to the original beat wording.
--
-- This rollback is also intentionally narrow and only affects the coin labels
-- introduced by the forward migration.

UPDATE public.pricing_topup_packs
SET
  name = CASE pack_key
    WHEN 'beats_25' THEN '25 Beats'
    WHEN 'beats_80' THEN '80 Beats'
    WHEN 'beats_200' THEN '200 Beats'
    ELSE name
  END,
  updated_at = now()
WHERE
  (pack_key = 'beats_25' AND name = '250 Coins')
  OR (pack_key = 'beats_80' AND name = '800 Coins')
  OR (pack_key = 'beats_200' AND name = '2,000 Coins');
