-- ============================================================
-- 003: Normalize beats into independent table, add storyline
--      junction, saved_storylines, explored_stories, and
--      support for shared branching + soft delete
-- ============================================================

-- ============================================================
-- 1. New Tables
-- ============================================================

-- 1a. Beats: independent entities scoped to a story
CREATE TABLE public.beats (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  story_id uuid REFERENCES public.stories(id) ON DELETE CASCADE NOT NULL,
  node_id text NOT NULL,
  beat_number integer NOT NULL,
  parent_node_id text,
  selected_option_id text,
  generated_by uuid REFERENCES auth.users(id),
  title text NOT NULL,
  is_ending boolean DEFAULT false,
  story_text text NOT NULL,
  scene_summary text,
  options jsonb,
  characters jsonb,
  continuity_notes jsonb,
  image_prompt text,
  clues jsonb,
  next_beat_goal text,
  ending_forecast jsonb,
  image_url text,
  audio_url text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(story_id, node_id)
);

-- 1b. Storyline-to-beat junction (replaces storylines.beats JSONB)
CREATE TABLE public.storyline_beats (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  storyline_id uuid REFERENCES public.storylines(id) ON DELETE CASCADE NOT NULL,
  beat_id uuid REFERENCES public.beats(id) ON DELETE CASCADE NOT NULL,
  position integer NOT NULL,
  choice_label text,
  UNIQUE(storyline_id, position)
);

-- 1c. User bookmarks for storylines (reference-only)
CREATE TABLE public.saved_storylines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  storyline_id uuid REFERENCES public.storylines(id) ON DELETE CASCADE NOT NULL,
  saved_at timestamptz DEFAULT now(),
  UNIQUE(user_id, storyline_id)
);

-- 1d. User-explored stories tracker (reference-only)
CREATE TABLE public.explored_stories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  story_id uuid REFERENCES public.stories(id) ON DELETE CASCADE NOT NULL,
  last_node_id text,
  explored_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, story_id)
);

-- ============================================================
-- 2. Alter Existing Tables
-- ============================================================

-- Stories: soft delete + creator position tracking
ALTER TABLE public.stories ADD COLUMN is_archived boolean DEFAULT false;
ALTER TABLE public.stories ADD COLUMN current_node_id text;

-- Storylines: path hash for duplicate detection
ALTER TABLE public.storylines ADD COLUMN path_hash text;

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX idx_beats_story_id ON public.beats(story_id);
CREATE INDEX idx_beats_story_node ON public.beats(story_id, node_id);
CREATE INDEX idx_beats_parent ON public.beats(story_id, parent_node_id);
CREATE INDEX idx_storyline_beats_storyline ON public.storyline_beats(storyline_id, position);
CREATE INDEX idx_storyline_beats_beat ON public.storyline_beats(beat_id);
CREATE INDEX idx_saved_storylines_user ON public.saved_storylines(user_id);
CREATE INDEX idx_saved_storylines_storyline ON public.saved_storylines(storyline_id);
CREATE INDEX idx_explored_stories_user ON public.explored_stories(user_id);
CREATE INDEX idx_explored_stories_story ON public.explored_stories(story_id);
CREATE INDEX idx_storylines_path_hash ON public.storylines(story_id, path_hash);
CREATE INDEX idx_stories_not_archived ON public.stories(is_archived, created_at DESC);

-- ============================================================
-- 4. RLS for beats
-- ============================================================
ALTER TABLE public.beats ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read beats of non-archived stories
CREATE POLICY "Authenticated users can view beats of non-archived stories"
  ON public.beats FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = beats.story_id AND s.is_archived = false
    )
  );

-- Owner can always read their own story beats (even archived)
CREATE POLICY "Users can view beats of own stories"
  ON public.beats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = beats.story_id AND s.user_id = auth.uid()
    )
  );

-- Any authenticated user can insert beats (shared branching)
CREATE POLICY "Authenticated users can insert beats"
  ON public.beats FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND generated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = beats.story_id AND s.is_archived = false
    )
  );

-- Beat generator can update their own beats (e.g., add audio URL)
CREATE POLICY "Beat generator can update own beats"
  ON public.beats FOR UPDATE
  USING (generated_by = auth.uid());

-- ============================================================
-- 5. RLS for storyline_beats
-- ============================================================
ALTER TABLE public.storyline_beats ENABLE ROW LEVEL SECURITY;

-- Readable if parent storyline is public
CREATE POLICY "Public storyline beats are viewable"
  ON public.storyline_beats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.storylines sl
      WHERE sl.id = storyline_beats.storyline_id AND sl.is_public = true
    )
  );

-- Readable if user owns the parent storyline
CREATE POLICY "Own storyline beats are viewable"
  ON public.storyline_beats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.storylines sl
      WHERE sl.id = storyline_beats.storyline_id AND sl.user_id = auth.uid()
    )
  );

-- Authenticated users can insert (auto-publish creates these)
CREATE POLICY "Authenticated users can insert storyline beats"
  ON public.storyline_beats FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.storylines sl
      WHERE sl.id = storyline_beats.storyline_id AND sl.user_id = auth.uid()
    )
  );

-- ============================================================
-- 6. RLS for saved_storylines
-- ============================================================
ALTER TABLE public.saved_storylines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own saved storylines"
  ON public.saved_storylines FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved storylines"
  ON public.saved_storylines FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved storylines"
  ON public.saved_storylines FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- 7. RLS for explored_stories
-- ============================================================
ALTER TABLE public.explored_stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own explored stories"
  ON public.explored_stories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own explored stories"
  ON public.explored_stories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own explored stories"
  ON public.explored_stories FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own explored stories"
  ON public.explored_stories FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- 8. Update stories RLS: allow authenticated read for non-archived
-- ============================================================

-- Any authenticated user can read non-archived stories (for exploration)
CREATE POLICY "Authenticated users can view non-archived stories"
  ON public.stories FOR SELECT
  USING (is_archived = false AND auth.uid() IS NOT NULL);

-- Anonymous users can read non-archived stories (for gallery metadata)
CREATE POLICY "Anonymous can view non-archived stories for gallery"
  ON public.stories FOR SELECT
  USING (is_archived = false);

-- ============================================================
-- 9. Update storage: allow authenticated users to read story-assets
--    (needed for exploration of other users' story trees)
-- ============================================================
CREATE POLICY "Authenticated users can read story assets for exploration"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'story-assets'
    AND auth.uid() IS NOT NULL
  );
