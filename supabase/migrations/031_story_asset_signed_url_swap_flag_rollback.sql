-- 031_story_asset_signed_url_swap_flag_rollback.sql

DELETE FROM public.feature_flags
WHERE flag_key = 'story_asset_signed_url_swap_enabled';
