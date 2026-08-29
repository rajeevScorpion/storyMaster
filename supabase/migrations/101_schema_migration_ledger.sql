-- 101_schema_migration_ledger.sql
-- A per-environment, self-recording record of which numbered migration files
-- have actually been run against *this* database.
--
-- Why this exists: migrations here are applied by hand, per environment, with
-- no Supabase CLI tracking table (WORKING_AGREEMENTS.md — "Never run the
-- Supabase CLI"). Until now the only record of what had actually been applied
-- was docs/agent-context/PROJECT_STATE.md, hand-maintained and prone to going
-- stale — it was caught stating an incorrect gate state earlier in this same
-- project. The Supabase dashboard's SQL editor "saved queries" list is not a
-- substitute either: it is client-side history tied to a browser session, not
-- a record of what actually executed against the database.
--
-- The fix: every migration records itself here as its last statement. The
-- table then answers "is migration NNN applied?" with one query against the
-- database being asked about, instead of inferring it from column/table
-- existence or trusting a doc.
--
-- Convention for every migration from 102 onward — add this as the FINAL
-- statement of the migration file (not the rollback):
--
--   INSERT INTO public.schema_migration_ledger (migration_number, file_name)
--   VALUES (102, '102_short_name.sql')
--   ON CONFLICT (migration_number) DO NOTHING;
--
-- And the mirror statement in that migration's _rollback.sql:
--
--   DELETE FROM public.schema_migration_ledger WHERE migration_number = 102;
--
-- ON CONFLICT DO NOTHING makes a re-run of the same file harmless, matching
-- every other migration's idempotency in this project.

CREATE TABLE IF NOT EXISTS public.schema_migration_ledger (
  migration_number INTEGER PRIMARY KEY,
  file_name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT NULL
);

COMMENT ON TABLE public.schema_migration_ledger IS
  'Insert-only, per-environment record of which numbered migration files have run against this database. Each migration inserts its own row as its last statement. Query this table directly rather than inferring applied state from column/table existence or trusting docs.';

ALTER TABLE public.schema_migration_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schema_migration_ledger FROM anon, authenticated;
GRANT ALL ON TABLE public.schema_migration_ledger TO service_role;
-- No end-user policies — this is an operator/agent table, read via the
-- read-only Supabase MCP connection or the dashboard, never by the app.

-- Backfill 001-100: verified applied on both dev and production as of
-- 2026-08-29 by direct schema inspection (table/column/function checks), not
-- assumption. See docs/agent-context/PROJECT_STATE.md for the verification
-- queries used.
INSERT INTO public.schema_migration_ledger (migration_number, file_name, note) VALUES
  (1, '001_initial_schema.sql', 'backfilled 2026-08-29'),
  (2, '002_storage_update_policies.sql', 'backfilled 2026-08-29'),
  (3, '003_normalize_beats.sql', 'backfilled 2026-08-29'),
  (4, '004_migrate_existing_data.sql', 'backfilled 2026-08-29'),
  (5, '005_story_cover_image.sql', 'backfilled 2026-08-29'),
  (6, '006_gallery_story_tree_source.sql', 'backfilled 2026-08-29'),
  (7, '007_storyline_likes_views.sql', 'backfilled 2026-08-29'),
  (8, '008_model_config.sql', 'backfilled 2026-08-29'),
  (9, '009_prompt_playground.sql', 'backfilled 2026-08-29'),
  (10, '010_portrait_generation.sql', 'backfilled 2026-08-29'),
  (11, '011_feature_flags.sql', 'backfilled 2026-08-29'),
  (12, '012_beat_is_storyboard.sql', 'backfilled 2026-08-29'),
  (13, '013_feature_flag_value.sql', 'backfilled 2026-08-29'),
  (14, '014_storyboard_vignette_flag.sql', 'backfilled 2026-08-29'),
  (15, '015_pricing_catalog.sql', 'backfilled 2026-08-29'),
  (16, '016_billing_core.sql', 'backfilled 2026-08-29'),
  (17, '017_wallet_core.sql', 'backfilled 2026-08-29'),
  (18, '018_pricing_runtime_flags.sql', 'backfilled 2026-08-29'),
  (19, '019_pricing_seed_data.sql', 'backfilled 2026-08-29'),
  (20, '020_rename_seeded_topup_pack_labels_to_coins.sql', 'backfilled 2026-08-29'),
  (21, '021_pricing_enforcement_primitives.sql', 'backfilled 2026-08-29'),
  (22, '022_fix_pricing_finalize_reservation_ambiguity.sql', 'backfilled 2026-08-29'),
  (23, '023_enable_video_downloads.sql', 'backfilled 2026-08-29'),
  (24, '024_script_seeded_story_mode.sql', 'backfilled 2026-08-29'),
  (25, '025_seed_script_model_config.sql', 'backfilled 2026-08-29'),
  (26, '026_ai_cost_events.sql', 'backfilled 2026-08-29'),
  (27, '027_storyboard_image_quality_controls.sql', 'backfilled 2026-08-29'),
  (28, '028_storyboard_vignette_amount.sql', 'backfilled 2026-08-29'),
  (29, '029_story_ui_controls.sql', 'backfilled 2026-08-29'),
  (30, '030_user_led_narration_voice_selection.sql', 'backfilled 2026-08-29'),
  (31, '031_story_asset_signed_url_swap_flag.sql', 'backfilled 2026-08-29'),
  (32, '032_managed_pages.sql', 'backfilled 2026-08-29'),
  (33, '033_incremental_beat_asset_sync.sql', 'backfilled 2026-08-29'),
  (34, '034_prompt_only_story_mode.sql', 'backfilled 2026-08-29'),
  (35, '035_prompt_only_beat_image_gallery.sql', 'backfilled 2026-08-29'),
  (36, '036_vertical_stories_9x16.sql', 'backfilled 2026-08-29'),
  (37, '037_character_sheet_uploads.sql', 'backfilled 2026-08-29'),
  (38, '038_character_sheet_gallery.sql', 'backfilled 2026-08-29'),
  (39, '039_video_export_presets.sql', 'backfilled 2026-08-29'),
  (40, '040_fractional_action_costs.sql', 'backfilled 2026-08-29'),
  (41, '041_dynamic_coin_pack_catalog.sql', 'backfilled 2026-08-29'),
  (42, '042_storyline_choice_flash_controls.sql', 'backfilled 2026-08-29'),
  (43, '043_robust_storyline_social_covers.sql', 'backfilled 2026-08-29'),
  (44, '044_client_side_image_compression_settings.sql', 'backfilled 2026-08-29'),
  (45, '045_cloudflare_r2_media_assets.sql', 'backfilled 2026-08-29'),
  (46, '046_reel_story_generator.sql', 'backfilled 2026-08-29'),
  (47, '047_reel_story_generator_post_apply_patch.sql', 'backfilled 2026-08-29'),
  (48, '048_reel_playground_image_styles.sql', 'backfilled 2026-08-29'),
  (49, '049_reel_quote_sequence_and_byoi.sql', 'backfilled 2026-08-29'),
  (50, '050_reel_visual_style_thumbnail.sql', 'backfilled 2026-08-29'),
  (51, '051_reel_moods.sql', 'backfilled 2026-08-29'),
  (52, '052_r2_media_backfill_ledger.sql', 'backfilled 2026-08-29'),
  (53, '053_reel_publish_flag.sql', 'backfilled 2026-08-29'),
  (54, '054_reel_narration_presets.sql', 'backfilled 2026-08-29'),
  (55, '055_refresh_gemini_model_defaults.sql', 'backfilled 2026-08-29'),
  (56, '056_reel_voice_previews.sql', 'backfilled 2026-08-29'),
  (57, '057_reel_narration_metadata.sql', 'backfilled 2026-08-29'),
  (58, '058_storyboard_narration_timing.sql', 'backfilled 2026-08-29'),
  (59, '059_client_story_persistence.sql', 'backfilled 2026-08-29'),
  (60, '060_story_text_overlay.sql', 'backfilled 2026-08-29'),
  (61, '061_story_effects.sql', 'backfilled 2026-08-29'),
  (62, '062_image_model_registry.sql', 'backfilled 2026-08-29'),
  (63, '063_image_provider_costs_and_portraits.sql', 'backfilled 2026-08-29'),
  (64, '064_image_stateful_continuity.sql', 'backfilled 2026-08-29'),
  (65, '065_elevenlabs_overlay_alignment_cost.sql', 'backfilled 2026-08-29'),
  (66, '066_image_batch_jobs.sql', 'backfilled 2026-08-29'),
  (67, '067_bulk_visual_generation.sql', 'backfilled 2026-08-29'),
  (68, '068_narration_batch_jobs.sql', 'backfilled 2026-08-29'),
  (69, '069_narration_accent.sql', 'backfilled 2026-08-29'),
  (70, '070_media_pipeline_flags.sql', 'backfilled 2026-08-29'),
  (71, '071_image_generation_jobs.sql', 'backfilled 2026-08-29'),
  (72, '072_media_asset_variants.sql', 'backfilled 2026-08-29'),
  (73, '073_storyline_visibility.sql', 'backfilled 2026-08-29'),
  (74, '074_beat_control_pack1.sql', 'backfilled 2026-08-29'),
  (75, '075_character_universe_pack2.sql', 'backfilled 2026-08-29'),
  (76, '076_video_export_engine_presets.sql', 'backfilled 2026-08-29'),
  (77, '077_beat_bundle_flag.sql', 'backfilled 2026-08-29'),
  (78, '078_reference_personalization.sql', 'backfilled 2026-08-29'),
  (79, '079_reference_direct_input.sql', 'backfilled 2026-08-29'),
  (80, '080_beats_realtime.sql', 'backfilled 2026-08-29'),
  (81, '081_image_prompt_compiler.sql', 'backfilled 2026-08-29'),
  (82, '082_coin_economy_gateway.sql', 'backfilled 2026-08-29'),
  (83, '083_admin_user_management.sql', 'backfilled 2026-08-29'),
  (84, '084_operational_policies_and_welcome_grant.sql', 'backfilled 2026-08-29'),
  (85, '085_story_visual_options.sql', 'backfilled 2026-08-29'),
  (86, '086_character_novelty_guard.sql', 'backfilled 2026-08-29'),
  (87, '087_story_beat_length.sql', 'backfilled 2026-08-29'),
  (88, '088_storyline_discovery_metadata.sql', 'backfilled 2026-08-29'),
  (89, '089_storyline_audience_genre.sql', 'backfilled 2026-08-29'),
  (90, '090_storyline_progress.sql', 'backfilled 2026-08-29'),
  (91, '091_viewer_profiles.sql', 'backfilled 2026-08-29'),
  (92, '092_backfill_beat_is_storyboard.sql', 'backfilled 2026-08-29'),
  (93, '093_storyline_series.sql', 'backfilled 2026-08-29'),
  (94, '094_storyline_search_trgm.sql', 'backfilled 2026-08-29'),
  (95, '095_runware_image_provider.sql', 'backfilled 2026-08-29'),
  (96, '096_user_entitlement_tier_overrides.sql', 'backfilled 2026-08-29'),
  (97, '097_enable_rls_admin_config_tables.sql', 'backfilled 2026-08-29'),
  (98, '098_harden_function_privileges.sql', 'backfilled 2026-08-29'),
  (99, '099_managed_page_versioning.sql', 'backfilled 2026-08-29'),
  (100, '100_legal_acceptances.sql', 'backfilled 2026-08-29')
ON CONFLICT (migration_number) DO NOTHING;

-- This migration records itself too, per the convention it establishes.
INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (101, '101_schema_migration_ledger.sql')
ON CONFLICT (migration_number) DO NOTHING;

-- Verify after applying:
--
--   select migration_number, file_name, applied_at, note
--   from public.schema_migration_ledger
--   order by migration_number desc
--   limit 5;
--
-- and to check whether a specific migration has run on this database:
--
--   select exists (
--     select 1 from public.schema_migration_ledger where migration_number = 99
--   ) as m099_applied;
