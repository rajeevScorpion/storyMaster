-- 073_storyline_visibility.sql
-- Storyline visibility (private | public | unlisted) with revocable unlisted
-- share tokens and a publish quality preference.
--
-- Rollout safety: every existing RLS policy and the gallery_story_trees view
-- key off the boolean is_public. That column stays physical and a trigger
-- keeps it bidirectionally consistent with the new visibility enum, so
-- nothing that reads is_public changes behavior.

ALTER TABLE public.storylines
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS share_token TEXT NULL,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS unpublished_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS publish_quality TEXT NOT NULL DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_visibility_check') THEN
    ALTER TABLE public.storylines ADD CONSTRAINT storylines_visibility_check
      CHECK (visibility IN ('private', 'public', 'unlisted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_moderation_status_check') THEN
    ALTER TABLE public.storylines ADD CONSTRAINT storylines_moderation_status_check
      CHECK (moderation_status IN ('none', 'pending', 'approved', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_publish_quality_check') THEN
    ALTER TABLE public.storylines ADD CONSTRAINT storylines_publish_quality_check
      CHECK (publish_quality IN ('standard', 'high'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_storylines_share_token
  ON public.storylines (share_token)
  WHERE share_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_storylines_visibility
  ON public.storylines (visibility);

-- Backfill: existing rows keep their current effective visibility.
UPDATE public.storylines
SET visibility = 'public'
WHERE is_public = true AND visibility <> 'public';

-- Bidirectional sync:
-- - Writers that set visibility get is_public derived (public <=> true).
-- - Legacy writers that only touch is_public keep working; their change is
--   mapped onto visibility (an unlisted row that a legacy writer re-marks
--   is_public=false stays unlisted rather than collapsing to private).
CREATE OR REPLACE FUNCTION public.sync_storyline_visibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.visibility = 'public' AND NEW.is_public IS DISTINCT FROM true THEN
      NEW.is_public := true;
    ELSIF NEW.visibility <> 'public' AND NEW.is_public = true THEN
      -- Legacy inserts that only set is_public=true mean "publish".
      NEW.visibility := 'public';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    NEW.is_public := (NEW.visibility = 'public');
  ELSIF NEW.is_public IS DISTINCT FROM OLD.is_public THEN
    IF NEW.is_public THEN
      NEW.visibility := 'public';
    ELSIF OLD.visibility = 'public' THEN
      NEW.visibility := 'private';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS storylines_sync_visibility ON public.storylines;
CREATE TRIGGER storylines_sync_visibility
  BEFORE INSERT OR UPDATE ON public.storylines
  FOR EACH ROW EXECUTE FUNCTION public.sync_storyline_visibility();
