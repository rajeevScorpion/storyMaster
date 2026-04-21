-- 027_storyboard_image_quality_controls.sql
-- Seed admin-controlled storyboard image quality defaults.

ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('storyboard_image_size', true, '1K'),
  ('storyboard_webp_compression_enabled', false, null),
  ('storyboard_webp_quality_percent', true, '85'),
  ('storyboard_client_processing_enabled', false, null),
  ('storyboard_layout_mode', true, '2x2')
ON CONFLICT (flag_key) DO NOTHING;
