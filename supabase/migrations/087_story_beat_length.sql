-- Standard-story Beat length baseline. Reels retain their existing independent
-- short/medium/long text-length configuration.
INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('story_beat_length_default_level', true, '3')
ON CONFLICT (flag_key) DO NOTHING;
