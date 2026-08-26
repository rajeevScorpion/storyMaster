-- 098_harden_function_privileges.sql
-- Two related hardening steps on the functions this project owns:
--   1. Pin `search_path` on the 15 functions that leave it mutable.
--   2. Remove EXECUTE from the PostgREST-facing roles on 17 functions that are
--      never meant to be called over `/rest/v1/rpc/`.
--
-- ---------------------------------------------------------------------------
-- Why search_path matters
--
-- A function with a mutable search_path resolves unqualified names against
-- whatever the caller's search_path happens to be. In a SECURITY DEFINER
-- function that is a privilege-escalation vector: the caller can shadow a table
-- or operator with their own object and have it run with the definer's rights.
-- Three of ours are SECURITY DEFINER and were mutable — handle_new_user,
-- update_storyline_like_count, update_storyline_view_count. The other twelve are
-- SECURITY INVOKER, so the risk is much lower, but pinning them is free.
--
-- ---------------------------------------------------------------------------
-- Why the REVOKE has to name PUBLIC
--
-- Supabase grants EXECUTE both to PUBLIC and explicitly to anon/authenticated.
-- Verified on the live database, the ACL reads:
--
--     =X/postgres   postgres=X/postgres   anon=X/postgres
--     authenticated=X/postgres            service_role=X/postgres
--
-- The leading `=X/postgres` is the PUBLIC grant. Revoking from anon and
-- authenticated alone would therefore change nothing — they would still hold
-- EXECUTE through PUBLIC. The revoke below names PUBLIC explicitly. service_role
-- and postgres hold their own explicit grants, which a revoke from PUBLIC does
-- not touch, so server code keeps working.
--
-- ---------------------------------------------------------------------------
-- Why each of these is safe to revoke
--
--   * The trigger functions (handle_new_user, update_storyline_*_count, and the
--     touch_*_updated_at family) are invoked by the trigger mechanism, which does
--     not check the invoking user's EXECUTE privilege. They are reachable over
--     REST only as an accident of the default grant.
--   * prune_orphaned_beat_images and prune_orphaned_character_sheets are called
--     by pg_cron (migrations 035 and 038, `$cron$SELECT ...$cron$`) and by nothing
--     in the application — there are zero TypeScript callers. Today a signed-out
--     visitor can invoke a media-deleting routine over REST; it is feature-flag
--     gated, which is the only reason that is not already a problem.
--   * The pricing_* functions are called exclusively from
--     lib/pricing/enforcement.ts, which is `import 'server-only'` and uses
--     createAdminClient() (service role).
--
-- ---------------------------------------------------------------------------
-- Deliberately NOT in this migration
--
--   * pg_trgm's functions (similarity, word_similarity, the gtrgm_* and gin_*
--     operator-class internals). They belong to an extension, not to us; altering
--     them can be undone by an extension upgrade, and revoking EXECUTE would break
--     trigram search. Supabase's own advisor excludes them for the same reason.
--   * Moving pg_trgm out of the public schema, which the advisor also suggests.
--     That would invalidate the GIN indexes migration 094 created and needs its
--     own migration with an index rebuild.
--   * Leaked-password protection, which is an Auth dashboard toggle rather than
--     SQL: Authentication -> Policies -> enable "Leaked password protection".
--
-- Apply to development first. Then like a storyline and open one, and confirm the
-- like and view counters still increment — that is the one behaviour these
-- changes could plausibly disturb.

-- 1. Pin search_path on the functions we own -------------------------------
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
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn);
  END LOOP;
END;
$$;

-- 2. Take EXECUTE away from the PostgREST-facing roles ----------------------
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
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    -- Granted explicitly, so server access does not depend on an inherited grant.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;

-- Verify after applying. Expect anon_can_execute = false on all 17, and
-- search_path = 'search_path=public, pg_temp' on the 15 in step 1:
--
--   select p.proname,
--          coalesce(array_to_string(p.proconfig, ', '), 'MUTABLE') as search_path,
--          has_function_privilege('anon', p.oid, 'EXECUTE')         as anon_can_execute,
--          has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('handle_new_user','update_storyline_like_count',
--                       'update_storyline_view_count','prune_orphaned_beat_images',
--                       'prune_orphaned_character_sheets','pricing_authorize_spend',
--                       'pricing_expire_stale_reservations','pricing_finalize_reservation',
--                       'pricing_materialize_usage_components','pricing_release_reservation',
--                       'touch_media_assets_updated_at','touch_media_backfill_items_updated_at',
--                       'touch_reel_narration_updated_at','touch_reel_visual_styles_updated_at',
--                       'touch_story_visual_options_updated_at','touch_storyline_progress_updated_at',
--                       'touch_viewer_profiles_updated_at')
--   order by p.proname;
