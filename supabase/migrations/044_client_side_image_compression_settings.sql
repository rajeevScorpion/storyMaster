-- 044_client_side_image_compression_settings.sql
-- Runtime controls for browser-side upload optimization before media reaches
-- the storage layer. These flags are storage-provider agnostic and prepare the
-- upload path for future R2/hybrid providers.

ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('image_upload_client_compression_enabled', true, NULL),
  ('image_upload_compress_beat_images', true, NULL),
  ('image_upload_compress_storyboard_images', true, NULL),
  ('image_upload_compress_cover_images', true, NULL),
  ('image_upload_compress_social_cover_images', true, NULL),
  ('image_upload_compress_character_refs', true, NULL),
  ('image_upload_output_format', true, 'webp'),
  ('image_upload_default_webp_quality', true, '0.85'),
  ('image_upload_character_ref_webp_quality', true, '0.9'),
  ('image_upload_max_landscape_width', true, '1920'),
  ('image_upload_max_landscape_height', true, '1080'),
  ('image_upload_max_vertical_width', true, '1080'),
  ('image_upload_max_vertical_height', true, '1920'),
  ('image_upload_max_character_ref_dimension', true, '2048'),
  ('image_upload_raw_selected_file_limit_mb', true, '20'),
  ('image_upload_final_upload_limit_mb', true, '5'),
  ('image_upload_show_compression_stats', true, NULL),
  ('image_upload_allow_original_on_compression_failure', true, NULL)
ON CONFLICT (flag_key) DO NOTHING;
