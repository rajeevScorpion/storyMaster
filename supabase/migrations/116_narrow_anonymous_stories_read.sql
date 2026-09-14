-- 116_narrow_anonymous_stories_read.sql
--
-- 003's anon policy on `stories` had no auth predicate and no `TO` clause, so any
-- anonymous caller could read every non-archived row -- unpublished drafts and
-- agent drafts awaiting review included. This narrows anon to stories that back a
-- public storyline.
--
-- DO NOT simplify this to a bare DROP. gallery.ts:187 joins `stories!inner(...)` on
-- the anon client, so with zero visible `stories` rows the inner join drops every
-- storyline and the signed-out gallery renders empty.
--
-- `TO anon` is deliberate: the separate authenticated policy (003) stays as-is.
-- Narrowing that one needs its own audit -- loadStory, loadStoryTree and
-- loadStorylineWithBeats all read on the session client without an ownership check.
--
-- Verify on dev: load `/` signed out and confirm the rails populate.

DROP POLICY IF EXISTS "Anonymous can view non-archived stories for gallery" ON public.stories;

CREATE POLICY "Anonymous can view stories behind public storylines"
  ON public.stories FOR SELECT
  TO anon
  USING (
    is_archived = false
    AND EXISTS (
      SELECT 1 FROM public.storylines sl
      WHERE sl.story_id = stories.id
        AND sl.is_public = true
    )
  );

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (116, '116_narrow_anonymous_stories_read.sql')
ON CONFLICT (migration_number) DO NOTHING;
