-- 018_pricing_runtime_flags_rollback.sql

DELETE FROM feature_flags
WHERE flag_key IN (
  'pricing_admin_tab_enabled',
  'pricing_snapshot_enabled',
  'pricing_checkout_enabled',
  'pricing_shadow_metering_enabled',
  'pricing_hard_enforcement_enabled',
  'pricing_story_length_ui_limits_enabled',
  'pricing_default_grace_period_days',
  'pricing_default_carry_forward_cap_multiplier',
  'pricing_reservation_timeout_seconds',
  'pricing_migration_grant_beats',
  'pricing_tester_studio_duration_days',
  'pricing_routing_provider_in',
  'pricing_routing_provider_row'
);
