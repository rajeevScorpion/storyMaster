-- 052_r2_media_backfill_ledger.sql
-- Operational ledger for the one-time Supabase Storage to R2 media backfill.
-- This migration creates tracking tables only. It does not move files or mutate
-- existing media references by itself.

CREATE TABLE IF NOT EXISTS public.media_backfill_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('audit', 'migrate', 'verify', 'cleanup', 'rollback')),
  environment TEXT NOT NULL,
  dry_run BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NULL
);

CREATE TABLE IF NOT EXISTS public.media_backfill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NULL REFERENCES public.media_backfill_runs(id) ON DELETE SET NULL,
  source_fingerprint TEXT NOT NULL UNIQUE,
  source_provider TEXT NOT NULL CHECK (source_provider IN ('supabase', 'r2')),
  source_bucket TEXT NOT NULL,
  source_object_key TEXT NOT NULL,
  source_url TEXT NULL,
  source_mime_type TEXT NULL,
  source_size_bytes BIGINT NULL,
  source_width INTEGER NULL,
  source_height INTEGER NULL,
  source_duration_seconds NUMERIC NULL,
  target_provider TEXT NOT NULL DEFAULT 'r2' CHECK (target_provider = 'r2'),
  target_bucket TEXT NULL,
  target_object_key TEXT NULL,
  target_url TEXT NULL,
  target_mime_type TEXT NULL,
  target_size_bytes BIGINT NULL,
  target_width INTEGER NULL,
  target_height INTEGER NULL,
  target_duration_seconds NUMERIC NULL,
  asset_type TEXT NOT NULL,
  story_id UUID NULL,
  beat_id UUID NULL,
  node_id TEXT NULL,
  storyline_id UUID NULL,
  user_id UUID NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  action TEXT NOT NULL DEFAULT 'pending'
    CHECK (action IN ('pending', 'copy_as_is', 'compress_to_webp', 'verify_only', 'cleanup_source', 'rollback_db', 'skip')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'skipped', 'uploaded', 'migrated', 'verified', 'cleaned', 'rolled_back', 'failed')),
  db_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NULL,
  verified_at TIMESTAMPTZ NULL,
  cleanup_eligible_after TIMESTAMPTZ NULL,
  cleaned_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_backfill_items_run
  ON public.media_backfill_items (run_id, status);

CREATE INDEX IF NOT EXISTS idx_media_backfill_items_source
  ON public.media_backfill_items (source_provider, source_bucket, source_object_key);

CREATE INDEX IF NOT EXISTS idx_media_backfill_items_target
  ON public.media_backfill_items (target_bucket, target_object_key)
  WHERE target_bucket IS NOT NULL AND target_object_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_backfill_items_cleanup
  ON public.media_backfill_items (verified_at, cleanup_eligible_after, cleaned_at)
  WHERE status = 'verified';

CREATE OR REPLACE FUNCTION public.touch_media_backfill_items_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS media_backfill_items_touch_updated_at ON public.media_backfill_items;
CREATE TRIGGER media_backfill_items_touch_updated_at
  BEFORE UPDATE ON public.media_backfill_items
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_media_backfill_items_updated_at();

ALTER TABLE public.media_backfill_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_backfill_items ENABLE ROW LEVEL SECURITY;

-- Service-role clients bypass RLS. No browser/client policies are granted for
-- these operational tables because they contain legacy object references.
