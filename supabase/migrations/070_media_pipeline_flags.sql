-- 070_media_pipeline_flags.sql
-- Seed admin-configurable flags for the durable server-side media pipeline rollout.
-- No behavior change: media_processing_mode defaults to 'client_legacy' (current flow)
-- and nothing consumes these flags until later phases ship.

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  -- client_legacy | server_pipeline | hybrid_canary
  ('media_processing_mode', TRUE, 'client_legacy'),
  -- JSON array of user UUIDs routed to server_pipeline while mode = hybrid_canary
  ('media_canary_user_ids', TRUE, '[]'),
  -- Grouped pipeline settings (retention, variant sizes/qualities, cleanup, publishing)
  ('media_pipeline_settings', TRUE, '{
    "freeRetentionHours": 24,
    "plusRetentionDays": 10,
    "studioRetentionDays": 30,
    "displayMaxWidth": 1440,
    "thumbnailMaxWidth": 512,
    "displayWebpQuality": 82,
    "thumbnailWebpQuality": 75,
    "shareLowMaxWidth": 1440,
    "shareHighMaxWidth": 2048,
    "shareHighQuality": 92,
    "cleanupEnabled": true,
    "cleanupBatchSize": 100,
    "maxAttempts": 3,
    "signedUrlTtlSeconds": 300,
    "variantsForBulkJobs": false,
    "serverPersistInlineImages": false,
    "publicPublishingEnabled": true,
    "unlistedSharingEnabled": true,
    "moderationRequiredForPublic": false
  }')
ON CONFLICT (flag_key) DO NOTHING;
