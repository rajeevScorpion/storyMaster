-- 073_storyline_visibility_rollback.sql
-- Restore boolean-only publishing. is_public already mirrors visibility, so
-- dropping the enum columns loses only unlisted links and quality prefs.

DROP TRIGGER IF EXISTS storylines_sync_visibility ON public.storylines;
DROP FUNCTION IF EXISTS public.sync_storyline_visibility();

DROP INDEX IF EXISTS idx_storylines_share_token;
DROP INDEX IF EXISTS idx_storylines_visibility;

ALTER TABLE public.storylines
  DROP CONSTRAINT IF EXISTS storylines_visibility_check,
  DROP CONSTRAINT IF EXISTS storylines_moderation_status_check,
  DROP CONSTRAINT IF EXISTS storylines_publish_quality_check;

ALTER TABLE public.storylines
  DROP COLUMN IF EXISTS visibility,
  DROP COLUMN IF EXISTS share_token,
  DROP COLUMN IF EXISTS published_at,
  DROP COLUMN IF EXISTS unpublished_at,
  DROP COLUMN IF EXISTS moderation_status,
  DROP COLUMN IF EXISTS publish_quality;
