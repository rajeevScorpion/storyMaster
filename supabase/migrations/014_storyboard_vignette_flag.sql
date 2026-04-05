-- 014_storyboard_vignette_flag.sql
-- Add a global toggle for storyboard vignette rendering

-- Guard: ensure the value column exists (added in 013; safe to run if already present)
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

INSERT INTO feature_flags (flag_key, enabled, value)
VALUES ('storyboard_vignette_enabled', true, null)
ON CONFLICT (flag_key) DO NOTHING;
