-- 013_feature_flag_value_rollback.sql
ALTER TABLE feature_flags DROP COLUMN IF EXISTS value;
DELETE FROM feature_flags WHERE flag_key IN ('storyboard_cycle_override', 'storyboard_cycle_ms');
