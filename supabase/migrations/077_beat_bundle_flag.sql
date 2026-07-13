-- 077_beat_bundle_flag.sql
-- Beat bundle rollout flag (perf pack: beat-generation round-trip collapse).
--
-- Seeds the `beat_bundle_enabled` feature flag, disabled by default. When
-- enabled AND the effective image processing mode is 'server_pipeline', story
-- beat generation uses the two-call bundle flow (generateBeatCore +
-- processBeatVisuals) instead of the legacy multi-round-trip client
-- orchestration. Rollback / kill switch = disable the flag; no redeploy needed.

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('beat_bundle_enabled', false, NULL)
ON CONFLICT (flag_key) DO NOTHING;
