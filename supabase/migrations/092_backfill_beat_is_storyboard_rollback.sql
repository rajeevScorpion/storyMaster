-- 092_backfill_beat_is_storyboard_rollback.sql
--
-- Reverts only the rows 092 flagged, using the ledger it wrote. Beats that were
-- already is_storyboard = true before the backfill are never touched.

UPDATE public.beats
SET is_storyboard = false
WHERE id IN (SELECT beat_id FROM public.beats_is_storyboard_backfill_092);

DROP TABLE IF EXISTS public.beats_is_storyboard_backfill_092;
