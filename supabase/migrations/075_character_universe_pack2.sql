-- 075_character_universe_pack2.sql
-- Pack 2: character library, story bible, journal & episodic branching.
--
-- Adds:
--   1. character_masters — user-owned reusable characters ("My Library").
--   2. episode_branches — the spine connecting a chain of episode stories.
--   3. story_bibles — one editable continuity bible per branch, embedding the
--      origin story's full StoryConfig snapshot so visual style / audience /
--      narration settings carry into every episode.
--   4. episode_journal_events — append-only series memory (episode summaries
--      and structural events).
--   5. Episode link columns on stories (episode_branch_id, episode_number,
--      parent_story_id).
--   6. Character-universe feature flags (seeded enabled per rollout decision).
--
-- Rollout safety: everything is additive. Story-level characters stay in the
-- existing JSONB stores; only library masters are normalized here.

-- 1. Character masters --------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.character_masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  type TEXT NOT NULL DEFAULT '',
  appearance_summary TEXT NOT NULL DEFAULT '',
  personality_summary TEXT NOT NULL DEFAULT '',
  role_notes TEXT NULL,
  portrait_url TEXT NULL,
  portrait_storage_key TEXT NULL,
  reference_sheet_url TEXT NULL,
  reference_sheet_storage_key TEXT NULL,
  source_type TEXT NOT NULL DEFAULT 'generated_from_story'
    CHECK (source_type IN ('generated_from_story', 'manual')),
  origin_story_id UUID NULL REFERENCES public.stories(id) ON DELETE SET NULL,
  origin_character_id TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_character_masters_user
  ON public.character_masters (user_id, archived_at, updated_at DESC);

-- One live master per normalized name per user; archived masters do not block
-- re-saving a character under the same name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_character_masters_user_name
  ON public.character_masters (user_id, normalized_name)
  WHERE archived_at IS NULL;

ALTER TABLE public.character_masters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own character masters" ON public.character_masters;
CREATE POLICY "Users read own character masters" ON public.character_masters
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own character masters" ON public.character_masters;
CREATE POLICY "Users insert own character masters" ON public.character_masters
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own character masters" ON public.character_masters;
CREATE POLICY "Users update own character masters" ON public.character_masters
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- No DELETE policy on purpose: masters are archived (archived_at), never
-- hard-deleted by users. Data retention over deletion (spec 07).

-- 2. Episode branches ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.episode_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  root_story_id UUID NULL REFERENCES public.stories(id) ON DELETE SET NULL,
  branch_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  latest_story_id UUID NULL REFERENCES public.stories(id) ON DELETE SET NULL,
  latest_episode_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episode_branches_user
  ON public.episode_branches (user_id, updated_at DESC);

ALTER TABLE public.episode_branches ENABLE ROW LEVEL SECURITY;

-- Branch lifecycle is server-orchestrated; all writes go through the
-- service-role client (no INSERT/UPDATE/DELETE policies on purpose).
DROP POLICY IF EXISTS "Users read own episode branches" ON public.episode_branches;
CREATE POLICY "Users read own episode branches" ON public.episode_branches
  FOR SELECT USING (auth.uid() = user_id);

-- 3. Story bibles ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.story_bibles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL UNIQUE REFERENCES public.episode_branches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  bible_text TEXT NOT NULL DEFAULT '',
  -- Full StoryConfig snapshot of the origin story so episodes inherit the
  -- Advanced settings (visual style, audience, narration, image pipeline).
  config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_model_id TEXT NULL,
  last_generated_at TIMESTAMPTZ NULL,
  last_edited_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.story_bibles ENABLE ROW LEVEL SECURITY;

-- Bibles are created by the generation pipeline (service role) but the owner
-- may read and hand-edit them.
DROP POLICY IF EXISTS "Users read own story bibles" ON public.story_bibles;
CREATE POLICY "Users read own story bibles" ON public.story_bibles
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own story bibles" ON public.story_bibles;
CREATE POLICY "Users update own story bibles" ON public.story_bibles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. Episode journal ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.episode_journal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.episode_branches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  story_id UUID NULL REFERENCES public.stories(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'episode_created', 'characters_migrated', 'episode_summary',
    'bible_generated', 'bible_edited'
  )),
  summary TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sequence_no BIGINT GENERATED ALWAYS AS IDENTITY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episode_journal_branch
  ON public.episode_journal_events (branch_id, sequence_no DESC);

ALTER TABLE public.episode_journal_events ENABLE ROW LEVEL SECURITY;

-- Append-only series memory; all writes go through the service-role client.
DROP POLICY IF EXISTS "Users read own journal events" ON public.episode_journal_events;
CREATE POLICY "Users read own journal events" ON public.episode_journal_events
  FOR SELECT USING (auth.uid() = user_id);

-- 5. Episode link columns on stories --------------------------------------------

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS episode_branch_id UUID NULL REFERENCES public.episode_branches(id) ON DELETE SET NULL;
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS episode_number INTEGER NULL;
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS parent_story_id UUID NULL REFERENCES public.stories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stories_episode_branch
  ON public.stories (episode_branch_id, episode_number)
  WHERE episode_branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stories_parent_story
  ON public.stories (parent_story_id)
  WHERE parent_story_id IS NOT NULL;

-- 6. Feature flags ----------------------------------------------------------------

INSERT INTO public.feature_flags (flag_key, enabled, value) VALUES
  ('character_library_enabled', true, NULL),
  ('character_global_save_enabled', true, NULL),
  ('character_mixing_enabled', true, NULL),
  ('episodes_enabled', true, NULL),
  ('story_bible_enabled', true, NULL),
  ('episode_journal_enabled', true, NULL)
ON CONFLICT (flag_key) DO NOTHING;
