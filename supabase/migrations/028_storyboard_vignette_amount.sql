-- 028_storyboard_vignette_amount.sql
-- Add admin-controlled storyboard vignette amount.

ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('storyboard_vignette_amount_percent', true, '100')
ON CONFLICT (flag_key) DO NOTHING;
