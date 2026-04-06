-- 018_pricing_runtime_flags.sql
-- Seed pricing rollout flags and runtime scalar defaults.

ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

INSERT INTO feature_flags (flag_key, enabled, value)
VALUES
  ('pricing_admin_tab_enabled', false, null),
  ('pricing_snapshot_enabled', false, null),
  ('pricing_checkout_enabled', false, null),
  ('pricing_shadow_metering_enabled', false, null),
  ('pricing_hard_enforcement_enabled', false, null),
  ('pricing_story_length_ui_limits_enabled', false, null),
  ('pricing_default_grace_period_days', false, '5'),
  ('pricing_default_carry_forward_cap_multiplier', false, '2'),
  ('pricing_reservation_timeout_seconds', false, '1800'),
  ('pricing_migration_grant_beats', false, '25'),
  ('pricing_tester_studio_duration_days', false, '90'),
  ('pricing_routing_provider_in', false, 'razorpay'),
  ('pricing_routing_provider_row', false, 'stripe')
ON CONFLICT (flag_key) DO NOTHING;
