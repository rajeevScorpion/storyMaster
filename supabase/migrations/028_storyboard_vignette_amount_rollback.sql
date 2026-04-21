-- 028_storyboard_vignette_amount_rollback.sql

DELETE FROM public.feature_flags
WHERE flag_key = 'storyboard_vignette_amount_percent';
