-- Admin-editable ElevenLabs forced-alignment cost for story text overlays.

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES (
  'elevenlabs_cost_per_1k_chars_usd',
  TRUE,
  '{
    "forcedAlignmentUsdPerHour":0.22,
    "models":[
      {"modelId":"eleven_multilingual_v2","displayName":"Eleven Multilingual v2","usdPer1kChars":0.22},
      {"modelId":"eleven_flash_v2_5","displayName":"Eleven Flash v2.5","usdPer1kChars":0.11},
      {"modelId":"eleven_v3","displayName":"Eleven v3","usdPer1kChars":0.22}
    ]
  }'::TEXT
)
ON CONFLICT (flag_key) DO UPDATE
SET
  enabled = TRUE,
  value = CASE
    WHEN COALESCE(NULLIF(public.feature_flags.value, ''), '{}')::JSONB ? 'forcedAlignmentUsdPerHour' THEN
      public.feature_flags.value
    ELSE
      (
        COALESCE(NULLIF(public.feature_flags.value, ''), '{}')::JSONB
        || '{"forcedAlignmentUsdPerHour":0.22}'::JSONB
      )::TEXT
  END;
