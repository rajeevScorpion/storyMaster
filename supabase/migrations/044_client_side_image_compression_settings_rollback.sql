-- 044_client_side_image_compression_settings_rollback.sql

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'image_upload_client_compression_enabled',
  'image_upload_compress_beat_images',
  'image_upload_compress_storyboard_images',
  'image_upload_compress_cover_images',
  'image_upload_compress_social_cover_images',
  'image_upload_compress_character_refs',
  'image_upload_output_format',
  'image_upload_default_webp_quality',
  'image_upload_character_ref_webp_quality',
  'image_upload_max_landscape_width',
  'image_upload_max_landscape_height',
  'image_upload_max_vertical_width',
  'image_upload_max_vertical_height',
  'image_upload_max_character_ref_dimension',
  'image_upload_raw_selected_file_limit_mb',
  'image_upload_final_upload_limit_mb',
  'image_upload_show_compression_stats',
  'image_upload_allow_original_on_compression_failure'
);
