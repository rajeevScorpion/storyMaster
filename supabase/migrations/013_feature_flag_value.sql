-- 013_feature_flag_value.sql
-- Add value column to feature_flags for numeric/string settings

ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

INSERT INTO feature_flags (flag_key, enabled, value)
VALUES ('storyboard_cycle_override', false, null)
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO feature_flags (flag_key, enabled, value)
VALUES ('storyboard_cycle_ms', false, '5000')
ON CONFLICT (flag_key) DO NOTHING;
