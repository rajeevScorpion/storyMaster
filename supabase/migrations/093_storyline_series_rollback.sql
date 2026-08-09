-- Rollback 093_storyline_series.sql
--
-- No data repair is needed. Series grouping degrades to the `stories!inner`
-- join the rails already perform — `stories.episode_branch_id` and
-- `episode_number` are anon-readable — so dropping these columns costs the
-- series *title* and the index, not the feature.

DROP INDEX IF EXISTS idx_storylines_public_series;

ALTER TABLE public.storylines
  DROP CONSTRAINT IF EXISTS storylines_episode_number_check;

ALTER TABLE public.storylines
  DROP COLUMN IF EXISTS series_id,
  DROP COLUMN IF EXISTS episode_number,
  DROP COLUMN IF EXISTS series_title;
