-- 077_beat_bundle_flag_rollback.sql
-- Removes the beat bundle rollout flag. The application treats a missing flag
-- as disabled, so this fully reverts 077.

DELETE FROM public.feature_flags WHERE flag_key = 'beat_bundle_enabled';
