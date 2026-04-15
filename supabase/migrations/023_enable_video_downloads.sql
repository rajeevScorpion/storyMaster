-- Enable video download access for paid plans (plus and studio)
-- Free plan retains canAccessDownloads: false (the locked/upsell state in the UI)
UPDATE pricing_plans
SET feature_flags_json = COALESCE(feature_flags_json, '{}'::jsonb)
                         || '{"canAccessDownloads": true}'::jsonb
WHERE plan_key IN ('plus', 'studio');
