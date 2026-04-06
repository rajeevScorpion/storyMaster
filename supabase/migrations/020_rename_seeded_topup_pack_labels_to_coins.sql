-- 020_rename_seeded_topup_pack_labels_to_coins.sql
-- Rename the original seeded top-up pack labels from beat wording to coin wording.
--
-- This migration is intentionally narrow:
-- - it only updates the known seeded pack keys
-- - it only touches rows that still use the legacy beat-based labels
-- - custom admin-edited labels are left unchanged

UPDATE public.pricing_topup_packs
SET
  name = CASE pack_key
    WHEN 'beats_25' THEN '250 Coins'
    WHEN 'beats_80' THEN '800 Coins'
    WHEN 'beats_200' THEN '2,000 Coins'
    ELSE name
  END,
  updated_at = now()
WHERE
  (pack_key = 'beats_25' AND name = '25 Beats')
  OR (pack_key = 'beats_80' AND name = '80 Beats')
  OR (pack_key = 'beats_200' AND name = '200 Beats');
