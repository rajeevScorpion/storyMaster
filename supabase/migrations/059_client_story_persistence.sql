-- Add the staged rollout flag for client-side story persistence.
INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('client_story_persistence_enabled', false, NULL)
ON CONFLICT (flag_key) DO NOTHING;
