-- Rollback 036: remove vertical story metadata and rollout flag.

DELETE FROM public.feature_flags
WHERE flag_key = 'vertical_stories_setting_enabled';

DROP INDEX IF EXISTS public.idx_storylines_aspect_ratio_public_latest;
DROP INDEX IF EXISTS public.idx_storylines_vertical_public_latest;
DROP INDEX IF EXISTS public.idx_stories_vertical_latest;

DROP VIEW IF EXISTS public.gallery_story_trees;

ALTER TABLE public.storylines
  DROP CONSTRAINT IF EXISTS storylines_aspect_ratio_check;

ALTER TABLE public.stories
  DROP CONSTRAINT IF EXISTS stories_aspect_ratio_check;

ALTER TABLE public.storylines
  DROP COLUMN IF EXISTS aspect_ratio,
  DROP COLUMN IF EXISTS is_vertical_story;

ALTER TABLE public.stories
  DROP COLUMN IF EXISTS aspect_ratio,
  DROP COLUMN IF EXISTS is_vertical_story;

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
  latest_public_storylines.latest_storyline_created_at AS created_at
FROM public.stories s
JOIN latest_public_storylines
  ON latest_public_storylines.story_id = s.id
WHERE s.is_archived = false;

GRANT SELECT ON public.gallery_story_trees TO anon, authenticated;
