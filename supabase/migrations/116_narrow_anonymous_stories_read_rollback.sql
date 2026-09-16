-- 116_narrow_anonymous_stories_read_rollback.sql
--
-- Restores 003's original anon policy verbatim, re-exposing every non-archived
-- story row to anonymous callers. Only run this if the signed-out gallery rails
-- came up empty after 116.

DROP POLICY IF EXISTS "Anonymous can view stories behind public storylines" ON public.stories;

CREATE POLICY "Anonymous can view non-archived stories for gallery"
  ON public.stories FOR SELECT
  USING (is_archived = false);

DELETE FROM public.schema_migration_ledger WHERE migration_number = 116;
