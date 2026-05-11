-- 045_cloudflare_r2_media_assets.sql
-- Add provider-neutral media metadata and Cloudflare R2 staging rollout flags.

ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

CREATE TABLE IF NOT EXISTS public.media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  beat_id UUID NULL REFERENCES public.beats(id) ON DELETE SET NULL,
  node_id TEXT NULL,
  storyline_id UUID NULL REFERENCES public.storylines(id) ON DELETE CASCADE,
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  public_url TEXT NULL,
  mime_type TEXT NULL,
  size_bytes BIGINT NULL,
  width INTEGER NULL,
  height INTEGER NULL,
  duration_seconds NUMERIC NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  cache_control TEXT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  error_message TEXT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_storage_provider_check
    CHECK (storage_provider IN ('supabase', 'r2')),
  CONSTRAINT media_assets_status_check
    CHECK (status IN ('ready', 'failed')),
  CONSTRAINT media_assets_asset_type_check
    CHECK (asset_type IN (
      'beat_image',
      'storyboard_image',
      'character_reference',
      'storyline_cover',
      'share_cover',
      'youtube_thumbnail',
      'reel_thumbnail',
      'narration_audio',
      'portrait',
      'unknown'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_assets_provider_bucket_key
  ON public.media_assets (storage_provider, bucket, object_key);

CREATE INDEX IF NOT EXISTS idx_media_assets_story
  ON public.media_assets (story_id, asset_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_assets_storyline
  ON public.media_assets (storyline_id, asset_type, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_media_assets_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS media_assets_touch_updated_at ON public.media_assets;
CREATE TRIGGER media_assets_touch_updated_at
  BEFORE UPDATE ON public.media_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_media_assets_updated_at();

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own media assets" ON public.media_assets;
CREATE POLICY "Users can view own media assets"
  ON public.media_assets FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public media assets are viewable" ON public.media_assets;
CREATE POLICY "Public media assets are viewable"
  ON public.media_assets FOR SELECT
  USING (is_public = true);

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('media_storage_provider', true, 'hybrid'),
  ('media_r2_enabled', true, NULL),
  ('media_r2_use_for_images', true, NULL),
  ('media_r2_use_for_covers', true, NULL),
  ('media_r2_use_for_narration_audio', true, NULL),
  ('media_r2_public_delivery_for_published_stories', true, NULL),
  ('media_r2_generate_thumbnails', true, NULL),
  ('media_r2_fallback_to_supabase', true, NULL),
  ('media_published_asset_cache_duration', true, '31536000')
ON CONFLICT (flag_key) DO NOTHING;
