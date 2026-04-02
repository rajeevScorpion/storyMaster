-- 011_feature_flags.sql
-- Global feature flags table for admin-controlled runtime toggles

CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key   TEXT        PRIMARY KEY,
  enabled    BOOLEAN     NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: storyboard mode off by default
INSERT INTO feature_flags (flag_key, enabled)
VALUES ('storyboard_mode', false)
ON CONFLICT (flag_key) DO NOTHING;
