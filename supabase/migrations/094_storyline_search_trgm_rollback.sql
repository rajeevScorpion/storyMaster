-- 094 rollback: drop the trigram search indexes.
--
-- No data is involved, so nothing needs repairing. Search keeps working; it
-- falls back to a sequential scan per searched column, which is what it did
-- before this migration.
--
-- `pg_trgm` is deliberately left installed. Dropping an extension is not this
-- migration's to undo — anything else that starts using it would break, and an
-- unused extension costs nothing.

DROP INDEX IF EXISTS public.idx_storylines_public_title_trgm;
DROP INDEX IF EXISTS public.idx_storylines_public_author_trgm;
DROP INDEX IF EXISTS public.idx_storylines_public_intro_trgm;
DROP INDEX IF EXISTS public.idx_storylines_public_series_title_trgm;
