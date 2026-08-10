-- 094_storyline_search_trgm.sql
--
-- Make catalogue search fast enough to be the primary way in.
--
-- Search used to be a filter box at the bottom of the gallery, matching titles
-- only, over one page of results people had already scrolled past. It is now the
-- surface the whole catalogue is reached through, and it matches the author, the
-- discovery blurb and the series name as well — because that is what people
-- actually remember about a story they want to find again.
--
-- Every one of those is a leading-wildcard `ILIKE '%term%'`, which no B-tree can
-- serve: Postgres would sequentially scan `storylines` once per searched column
-- per keystroke. Trigram GIN indexes are the standard answer and they support
-- leading wildcards directly.
--
-- The indexes are partial on `is_public = true`. Search only ever reads public
-- rows, and drafts are the bulk of the table, so this keeps the index roughly
-- the size of the catalogue rather than the size of the app.
--
-- Not `CREATE INDEX CONCURRENTLY`: the Supabase SQL editor wraps a script in a
-- transaction and CONCURRENTLY cannot run inside one. At the catalogue's current
-- size this builds instantly. If it ever grows enough to matter, run each index
-- on its own with CONCURRENTLY outside a transaction instead.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_storylines_public_title_trgm
  ON public.storylines USING gin (title gin_trgm_ops)
  WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_storylines_public_author_trgm
  ON public.storylines USING gin (author_name gin_trgm_ops)
  WHERE is_public = true;

-- Migration 088's column. Guarded so this migration still applies to a database
-- that has not seen 088/089 yet, which the gallery already tolerates at runtime.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'storylines'
      AND column_name = 'discovery_intro'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_storylines_public_intro_trgm
      ON public.storylines USING gin (discovery_intro gin_trgm_ops)
      WHERE is_public = true;
  END IF;
END
$$;

-- Migration 093's column, guarded for the same reason.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'storylines'
      AND column_name = 'series_title'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_storylines_public_series_title_trgm
      ON public.storylines USING gin (series_title gin_trgm_ops)
      WHERE is_public = true;
  END IF;
END
$$;

COMMENT ON INDEX public.idx_storylines_public_title_trgm IS
  'Trigram index backing the gallery search ILIKE on title. Partial: search reads public rows only.';
COMMENT ON INDEX public.idx_storylines_public_author_trgm IS
  'Trigram index backing the gallery search ILIKE on author_name.';
