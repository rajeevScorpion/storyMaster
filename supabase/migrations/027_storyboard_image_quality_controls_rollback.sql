-- 027_storyboard_image_quality_controls_rollback.sql

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'storyboard_image_size',
  'storyboard_webp_compression_enabled',
  'storyboard_webp_quality_percent',
  'storyboard_client_processing_enabled',
  'storyboard_layout_mode'
);
