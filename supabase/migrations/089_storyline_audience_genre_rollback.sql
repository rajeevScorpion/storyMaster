-- Rollback 089. Gallery filtering falls back to the stories join, so no data
-- repair is required beyond dropping the columns and their indexes.
DROP INDEX IF EXISTS idx_storylines_public_age_group;
DROP INDEX IF EXISTS idx_storylines_public_genre;

ALTER TABLE public.storylines
  DROP COLUMN IF EXISTS age_group,
  DROP COLUMN IF EXISTS genre;
