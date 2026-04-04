-- 014_storyboard_vignette_flag.sql
-- Add a global toggle for storyboard vignette rendering

INSERT INTO feature_flags (flag_key, enabled, value)
VALUES ('storyboard_vignette_enabled', true, null)
ON CONFLICT (flag_key) DO NOTHING;
