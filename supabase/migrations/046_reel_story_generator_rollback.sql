-- 046_reel_story_generator_rollback.sql
-- Roll back the Reel Story Generator base migration.
--
-- Warning: this removes Reel Story metadata columns and cleanup audit data.
-- Run only if Reel Story data does not need to be preserved.

DO $$
BEGIN
  IF to_regclass('public.reel_cleanup_runs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins can read reel cleanup runs" ON public.reel_cleanup_runs;
  END IF;
END $$;

DROP TABLE IF EXISTS public.reel_cleanup_runs;

DROP INDEX IF EXISTS public.idx_stories_reel_cleanup;
DROP INDEX IF EXISTS public.idx_storylines_story_kind_created;
DROP INDEX IF EXISTS public.idx_stories_story_kind_created;

ALTER TABLE public.stories
  DROP CONSTRAINT IF EXISTS stories_reel_cleanup_status_check,
  DROP CONSTRAINT IF EXISTS stories_reel_length_key_check,
  DROP CONSTRAINT IF EXISTS stories_story_kind_check;

ALTER TABLE public.storylines
  DROP CONSTRAINT IF EXISTS storylines_story_kind_check;

ALTER TABLE public.beats
  DROP COLUMN IF EXISTS reel_captions;

ALTER TABLE public.storylines
  DROP COLUMN IF EXISTS story_kind;

ALTER TABLE public.stories
  DROP COLUMN IF EXISTS reel_cleanup_last_error,
  DROP COLUMN IF EXISTS reel_deleted_at,
  DROP COLUMN IF EXISTS reel_cleanup_status,
  DROP COLUMN IF EXISTS reel_expires_at,
  DROP COLUMN IF EXISTS reel_retention_days,
  DROP COLUMN IF EXISTS reel_length_key,
  DROP COLUMN IF EXISTS story_kind;

DELETE FROM public.model_config
WHERE task_key IN (
  'reel_story_generation',
  'reel_visual_prompt',
  'reel_tts'
);

DELETE FROM public.pricing_action_costs
WHERE action_key IN (
  'start_reel_initial_beat',
  'continue_reel_new_beat'
);

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'reel_story_enabled',
  'reel_story_settings'
);

-- Do not drop feature_flags.value here. It predates Reel Story in this repo
-- and is used by other settings/migrations.
