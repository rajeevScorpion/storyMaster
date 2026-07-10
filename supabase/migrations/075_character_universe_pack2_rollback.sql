-- 075_character_universe_pack2_rollback.sql
-- Rollback for Pack 2: character library, story bible, journal & episodic branching.
--
-- WARNING: this permanently discards user-created library characters, series
-- bibles, and journals, and severs episode links between stories. The stories
-- themselves remain readable. Prefer disabling the six character-universe
-- feature flags instead of running this file (spec 07: hide over delete).

-- 1. Journal (references episode_branches)
DROP TABLE IF EXISTS public.episode_journal_events;

-- 2. Story bibles (references episode_branches)
DROP TABLE IF EXISTS public.story_bibles;

-- 3. Episode link columns on stories (drop before episode_branches for the FK)
DROP INDEX IF EXISTS public.idx_stories_episode_branch;
DROP INDEX IF EXISTS public.idx_stories_parent_story;
ALTER TABLE public.stories DROP COLUMN IF EXISTS episode_branch_id;
ALTER TABLE public.stories DROP COLUMN IF EXISTS episode_number;
ALTER TABLE public.stories DROP COLUMN IF EXISTS parent_story_id;

-- 4. Episode branches
DROP TABLE IF EXISTS public.episode_branches;

-- 5. Character masters
DROP TABLE IF EXISTS public.character_masters;

-- 6. Feature flags
DELETE FROM public.feature_flags
WHERE flag_key IN (
  'character_library_enabled',
  'character_global_save_enabled',
  'character_mixing_enabled',
  'episodes_enabled',
  'story_bible_enabled',
  'episode_journal_enabled'
);
