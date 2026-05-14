-- 052_r2_media_backfill_ledger_rollback.sql
-- Removes the operational ledger for the R2 media backfill.
-- This does not roll back migrated media references. Use the CLI rollback mode
-- before dropping these tables if DB references need to be restored.

DROP TRIGGER IF EXISTS media_backfill_items_touch_updated_at ON public.media_backfill_items;
DROP FUNCTION IF EXISTS public.touch_media_backfill_items_updated_at();
DROP TABLE IF EXISTS public.media_backfill_items;
DROP TABLE IF EXISTS public.media_backfill_runs;
