-- 093_storyline_series.sql
--
-- Denormalize episode/series membership onto published storylines.
--
-- The gallery and the public player read `storylines` anonymously. Episode
-- grouping itself lives on `stories`, which anonymous readers can already see
-- (migration 003), but the series *name* lives on `episode_branches.branch_name`,
-- which is owner-only by RLS and must stay that way — that table also carries
-- `latest_story_id`, a pointer at unpublished work in progress.
--
-- The resolution is that write-time reads are authorized and read-time reads
-- are not: publishing runs on the author's own cookie-bound client, which can
-- read their own branch, so the value is copied at publish. Read time needs no
-- new policy — `storylines` already exposes public rows to everyone (migration
-- 001) and RLS is row-level, so these columns inherit that. Nothing here widens
-- what anyone can see; `series_id` is an opaque grouping key that grants no
-- read on `episode_branches`.
--
-- It also makes series membership indexable. Filtering through an embedded
-- `stories!inner(episode_branch_id)` resource cannot use a storylines index,
-- and both the rail's collapse pass and the player's next-episode lookup filter
-- on series and order by episode number.

ALTER TABLE public.storylines
  ADD COLUMN IF NOT EXISTS series_id UUID NULL
    REFERENCES public.episode_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS episode_number INTEGER NULL,
  ADD COLUMN IF NOT EXISTS series_title TEXT NULL;

-- Added separately so re-running the migration does not fail on a duplicate
-- constraint name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'storylines_episode_number_check'
  ) THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_episode_number_check
      CHECK (episode_number IS NULL OR episode_number >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.storylines.series_id IS
  'episode_branches.id copied from the parent story at publish time. NULL means standalone. Opaque to the public: it groups public storylines and grants no read on episode_branches.';

COMMENT ON COLUMN public.storylines.episode_number IS
  'Episode position copied from stories.episode_number. Gaps are normal — an author may publish episode 3 without ever publishing episode 2 — so consumers must order and take the next, never assume current + 1.';

COMMENT ON COLUMN public.storylines.series_title IS
  'Series display name resolved at publish time from episode_branches.branch_name, falling back to the root story title. A later branch rename does not rewrite already-published rows.';

-- Backfill 1: membership, from the parent story. Both halves must be present —
-- a branch id with no episode number cannot be ordered, so such a row stays
-- standalone rather than joining a series at an unknown position.
UPDATE public.storylines sl
SET series_id = s.episode_branch_id,
    episode_number = s.episode_number
FROM public.stories s
WHERE sl.story_id = s.id
  AND sl.series_id IS NULL
  AND s.episode_branch_id IS NOT NULL
  AND s.episode_number IS NOT NULL;

-- Backfill 2: display name. `branch_name` defaults to '' at the table level and
-- is only ever written as the root story's title (app/actions/episodes.ts), so
-- an empty one falls back to the root story, then to the lowest-numbered
-- episode in the branch, then to the storyline's own title. Never left blank —
-- a blank series name would render as an unlabelled card.
UPDATE public.storylines sl
SET series_title = COALESCE(
      NULLIF(btrim(eb.branch_name), ''),
      NULLIF(btrim(root.title), ''),
      NULLIF(btrim(first_ep.title), ''),
      sl.title
    )
FROM public.episode_branches eb
LEFT JOIN public.stories root ON root.id = eb.root_story_id
LEFT JOIN LATERAL (
  SELECT s2.title
  FROM public.stories s2
  WHERE s2.episode_branch_id = eb.id
  ORDER BY s2.episode_number NULLS LAST, s2.created_at
  LIMIT 1
) first_ep ON true
WHERE sl.series_id = eb.id
  AND sl.series_title IS NULL;

-- Partial index matching the public listing shape, as 089 does: the collapse
-- pass and the next-episode lookup both filter series and order by episode
-- number, and both only ever touch public rows.
CREATE INDEX IF NOT EXISTS idx_storylines_public_series
  ON public.storylines (series_id, episode_number, created_at DESC)
  WHERE is_public = true AND series_id IS NOT NULL;

-- Both backfills are IS NULL-guarded and therefore re-runnable. Re-run them
-- after deploying the publish change if anything was published in the gap
-- between applying this migration and shipping the code that writes these
-- columns.
