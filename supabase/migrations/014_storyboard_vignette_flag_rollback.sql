-- 014_storyboard_vignette_flag_rollback.sql

DELETE FROM feature_flags
WHERE flag_key = 'storyboard_vignette_enabled';
