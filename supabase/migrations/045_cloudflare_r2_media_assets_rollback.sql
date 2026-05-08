-- 045_cloudflare_r2_media_assets_rollback.sql

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'media_storage_provider',
  'media_r2_enabled',
  'media_r2_use_for_images',
  'media_r2_use_for_covers',
  'media_r2_use_for_narration_audio',
  'media_r2_public_delivery_for_published_stories',
  'media_r2_generate_thumbnails',
  'media_r2_fallback_to_supabase',
  'media_published_asset_cache_duration'
);

DROP TABLE IF EXISTS public.media_assets;
DROP FUNCTION IF EXISTS public.touch_media_assets_updated_at();
