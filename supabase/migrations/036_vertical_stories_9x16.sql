-- 036_vertical_stories_9x16.sql
-- Durable metadata and rollout flag for portrait / vertical 9:16 stories.

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS is_vertical_story BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aspect_ratio TEXT NOT NULL DEFAULT '16:9';

ALTER TABLE public.storylines
  ADD COLUMN IF NOT EXISTS is_vertical_story BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aspect_ratio TEXT NOT NULL DEFAULT '16:9';

UPDATE public.stories
SET
  is_vertical_story = CASE
    WHEN story_config->>'isVerticalStory' = 'true'
      OR story_config->>'is_vertical_story' = 'true'
      OR story_config->>'aspectRatio' = '9:16'
      OR story_config->>'aspect_ratio' = '9:16'
    THEN true
    ELSE false
  END,
  aspect_ratio = CASE
    WHEN story_config->>'isVerticalStory' = 'true'
      OR story_config->>'is_vertical_story' = 'true'
      OR story_config->>'aspectRatio' = '9:16'
      OR story_config->>'aspect_ratio' = '9:16'
    THEN '9:16'
    ELSE '16:9'
  END;

UPDATE public.storylines AS sl
SET
  is_vertical_story = s.is_vertical_story,
  aspect_ratio = s.aspect_ratio
FROM public.stories AS s
WHERE sl.story_id = s.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stories_aspect_ratio_check'
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_aspect_ratio_check
      CHECK (aspect_ratio IN ('16:9', '9:16'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'storylines_aspect_ratio_check'
  ) THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_aspect_ratio_check
      CHECK (aspect_ratio IN ('16:9', '9:16'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stories_vertical_latest
  ON public.stories (is_vertical_story, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_storylines_vertical_public_latest
  ON public.storylines (is_vertical_story, created_at DESC)
  WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_storylines_aspect_ratio_public_latest
  ON public.storylines (aspect_ratio, created_at DESC)
  WHERE is_public = true;

CREATE OR REPLACE VIEW public.gallery_story_trees
WITH (security_invoker = true) AS
WITH latest_public_storylines AS (
  SELECT DISTINCT ON (sl.story_id)
    sl.story_id,
    sl.cover_image_url AS storyline_cover_image_url,
    sl.author_name,
    sl.created_at AS latest_storyline_created_at
  FROM public.storylines sl
  WHERE sl.is_public = true
  ORDER BY sl.story_id, sl.created_at DESC
)
SELECT
  s.id AS story_id,
  s.title,
  s.user_prompt,
  s.genre,
  s.story_config,
  COALESCE(s.cover_image_url, latest_public_storylines.storyline_cover_image_url) AS cover_image_url,
  latest_public_storylines.author_name,
  latest_public_storylines.latest_storyline_created_at AS created_at,
  s.is_vertical_story,
  s.aspect_ratio
FROM public.stories s
JOIN latest_public_storylines
  ON latest_public_storylines.story_id = s.id
WHERE s.is_archived = false;

GRANT SELECT ON public.gallery_story_trees TO anon, authenticated;

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('vertical_stories_setting_enabled', false, NULL)
ON CONFLICT (flag_key) DO NOTHING;
