-- 098_harden_function_privileges_rollback.sql
-- Reverts 098: unpins search_path and hands EXECUTE back to the PostgREST-facing
-- roles on the same 17 functions.
--
-- WARNING: this restores the exposure 098 closed. In particular it makes
-- prune_orphaned_beat_images and prune_orphaned_character_sheets — routines that
-- delete media — callable over `/rest/v1/rpc/` by anyone holding the anon key,
-- which ships in the browser bundle. Only run this if 098 actually broke
-- something, and treat it as temporary.
--
-- Before reaching for it, note what 098 cannot plausibly have broken:
--   * Triggers. Trigger execution does not check the invoking user's EXECUTE
--     privilege, so revoking it cannot stop a trigger firing. If like or view
--     counters stopped incrementing, look at the trigger itself, not the grant.
--   * Server code. service_role holds an explicit EXECUTE grant that a revoke
--     from PUBLIC does not remove, and 098 re-grants it explicitly.
--
-- The likelier cause of a genuine break is a call path reaching one of these
-- functions with the anon or user-session client instead of createAdminClient().
-- Fixing that call site is the better remedy than reopening the grant.
--
-- This restores the Supabase default grant shape (PUBLIC plus explicit anon and
-- authenticated). It does not attempt to restore per-function ACL variations, as
-- all 17 shared the same default shape when 098 was written.

-- 1. Unpin search_path ------------------------------------------------------
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'handle_new_user',
        'update_storyline_like_count',
        'update_storyline_view_count',
        'pricing_authorize_spend',
        'pricing_expire_stale_reservations',
        'pricing_finalize_reservation',
        'pricing_materialize_usage_components',
        'pricing_release_reservation',
        'touch_media_assets_updated_at',
        'touch_media_backfill_items_updated_at',
        'touch_reel_narration_updated_at',
        'touch_reel_visual_styles_updated_at',
        'touch_story_visual_options_updated_at',
        'touch_storyline_progress_updated_at',
        'touch_viewer_profiles_updated_at'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s RESET search_path', fn);
  END LOOP;
END;
$$;

-- 2. Restore the default EXECUTE grants -------------------------------------
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'handle_new_user',
        'update_storyline_like_count',
        'update_storyline_view_count',
        'prune_orphaned_beat_images',
        'prune_orphaned_character_sheets',
        'pricing_authorize_spend',
        'pricing_expire_stale_reservations',
        'pricing_finalize_reservation',
        'pricing_materialize_usage_components',
        'pricing_release_reservation',
        'touch_media_assets_updated_at',
        'touch_media_backfill_items_updated_at',
        'touch_reel_narration_updated_at',
        'touch_reel_visual_styles_updated_at',
        'touch_story_visual_options_updated_at',
        'touch_storyline_progress_updated_at',
        'touch_viewer_profiles_updated_at'
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated', fn);
  END LOOP;
END;
$$;
