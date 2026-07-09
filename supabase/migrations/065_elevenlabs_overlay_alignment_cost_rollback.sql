-- Remove the ElevenLabs forced-alignment cost seed.

UPDATE public.feature_flags
SET value = (COALESCE(NULLIF(value, ''), '{}')::JSONB - 'forcedAlignmentUsdPerHour')::TEXT
WHERE flag_key = 'elevenlabs_cost_per_1k_chars_usd';
