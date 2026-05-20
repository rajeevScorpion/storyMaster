-- Hide new reel publishing by default while preserving any existing storylines.
INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('reel_story_publish_enabled', false, NULL)
ON CONFLICT (flag_key) DO NOTHING;
