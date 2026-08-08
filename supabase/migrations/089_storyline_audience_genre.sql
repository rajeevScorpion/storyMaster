-- Denormalize audience band and genre onto published storylines.
--
-- Discovery filters on both on every gallery request. Today that costs an
-- inner join to stories plus an unindexable `story_config->>'ageGroup'` jsonb
-- extraction. Storyline-level columns make age eligibility machine-filterable,
-- which is what the Kids surface needs to enforce server-side.
ALTER TABLE public.storylines
  ADD COLUMN IF NOT EXISTS age_group TEXT
    CHECK (age_group IN ('all_ages', 'kids_3_5', 'kids_5_8', 'kids_8_12', 'teens', 'adults')),
  ADD COLUMN IF NOT EXISTS genre TEXT;

COMMENT ON COLUMN public.storylines.age_group IS
  'Audience band copied from the parent story at publish time. NULL means unclassified — deliberately NOT eligible for kids surfaces.';

COMMENT ON COLUMN public.storylines.genre IS
  'Lowercased genre copied from the parent story at publish time.';

-- Backfill from the parent story. Only values already inside the supported set
-- are copied; anything else stays NULL. Unknown content must never be coerced
-- into a band that looks child-safe.
UPDATE public.storylines sl
SET age_group = s.story_config->>'ageGroup'
FROM public.stories s
WHERE sl.story_id = s.id
  AND sl.age_group IS NULL
  AND s.story_config->>'ageGroup' IN ('all_ages', 'kids_3_5', 'kids_5_8', 'kids_8_12', 'teens', 'adults');

UPDATE public.storylines sl
SET genre = lower(trim(s.genre))
FROM public.stories s
WHERE sl.story_id = s.id
  AND sl.genre IS NULL
  AND coalesce(trim(s.genre), '') <> '';

-- Partial indexes matching the public listing shape (filter + created_at order).
CREATE INDEX IF NOT EXISTS idx_storylines_public_age_group
  ON public.storylines (age_group, created_at DESC)
  WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_storylines_public_genre
  ON public.storylines (genre, created_at DESC)
  WHERE is_public = true;
