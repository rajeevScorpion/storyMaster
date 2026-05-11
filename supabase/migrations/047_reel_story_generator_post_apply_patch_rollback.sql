-- 047_reel_story_generator_post_apply_patch_rollback.sql
-- Roll back the post-apply patch while leaving the base 046 Reel Story schema.
--
-- This restores the earlier 046 behavior as closely as possible without
-- dropping Reel Story tables/columns.

-- Restore the earlier direct-client cleanup policy if the audit table exists.
DO $$
BEGIN
  IF to_regclass('public.reel_cleanup_runs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins can read reel cleanup runs" ON public.reel_cleanup_runs;

    CREATE POLICY "Admins can read reel cleanup runs"
      ON public.reel_cleanup_runs FOR SELECT
      USING (auth.uid() = current_setting('app.admin_user_id', true)::uuid);
  END IF;
END $$;

-- Restore the earlier seeded Short default while preserving other JSON edits.
UPDATE public.feature_flags
SET
  value = jsonb_set(
    COALESCE(value::jsonb, '{}'::jsonb),
    '{defaultLength}',
    '"short"'::jsonb,
    true
  )::text,
  updated_at = now()
WHERE flag_key = 'reel_story_settings'
;

-- Restore the earlier reel length backfill path for rows that still carry the
-- legacy flat key. Rows without the legacy key are left untouched.
UPDATE public.stories
SET reel_length_key = story_config->>'reelLength'
WHERE story_config IS NOT NULL
  AND story_config->>'storyKind' = 'reel'
  AND story_config->>'reelLength' IN ('short', 'medium', 'long');

-- Restore earlier 1-beat seed values only for unmodified reel action costs.
-- Admin-edited rows should have updated_by set and are left alone.
UPDATE public.pricing_action_costs
SET
  beat_cost = 1,
  is_active = true,
  updated_at = now()
WHERE action_key IN (
    'start_reel_initial_beat',
    'continue_reel_new_beat'
  )
  AND updated_by IS NULL;
