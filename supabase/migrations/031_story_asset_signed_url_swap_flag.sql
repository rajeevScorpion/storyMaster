-- 031_story_asset_signed_url_swap_flag.sql
-- Feature flag for reversible optimized story asset saves.

ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('story_asset_signed_url_swap_enabled', false, NULL)
ON CONFLICT (flag_key) DO NOTHING;
