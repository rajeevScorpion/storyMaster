-- Rollback 006: Remove gallery story tree source
DROP VIEW IF EXISTS public.gallery_story_trees;
DROP INDEX IF EXISTS public.idx_storylines_public_story_latest;
