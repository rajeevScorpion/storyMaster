-- Migration 090: Per-viewer storyline reading progress
--
-- Phase 6 of the gallery transformation needs server-side progress so the feed
-- can build a "Continue Reading" rail and mark finished storylines. Progress
-- already exists client-side in IndexedDB (lib/persistence), but that is
-- per-device and invisible to the server, so it cannot drive a feed query.
--
-- Definitions, matching how StorylinePlayer already persists local progress:
--   * started   -> current_beat_index >= 1 (opening beat 0 and leaving is not
--                  progress, so the rail is not filled by accidental taps)
--   * complete  -> the reader reached the final beat and that beat is an ending
--   * progress  -> beat index within the storyline's linear beat sequence; a
--                  storyline is already one flattened path through the story
--                  tree, so no branch-level summarisation is required
--
-- Deliberately omitted: a watch/replay counter. It would need either an
-- append-only event table or a counter that lies whenever a reader re-opens a
-- storyline, and nothing in the product surfaces it today.

CREATE TABLE IF NOT EXISTS public.storyline_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storyline_id uuid NOT NULL REFERENCES public.storylines(id) ON DELETE CASCADE,
  -- Zero-based index of the furthest beat the reader has reached.
  current_beat_index integer NOT NULL DEFAULT 0 CHECK (current_beat_index >= 0),
  -- Snapshot of the storyline length when progress was written, so a
  -- percentage can be rendered without joining the storyline row.
  beat_count integer CHECK (beat_count IS NULL OR beat_count >= 0),
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, storyline_id)
);

-- The Continue Reading rail: one viewer's unfinished storylines, newest first.
CREATE INDEX IF NOT EXISTS idx_storyline_progress_continue
  ON public.storyline_progress (user_id, updated_at DESC)
  WHERE completed = false;

-- Badge lookups for a page of feed items.
CREATE INDEX IF NOT EXISTS idx_storyline_progress_user_storyline
  ON public.storyline_progress (user_id, storyline_id);

CREATE OR REPLACE FUNCTION public.touch_storyline_progress_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_storyline_progress_updated_at ON public.storyline_progress;
CREATE TRIGGER trg_storyline_progress_updated_at
  BEFORE UPDATE ON public.storyline_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_storyline_progress_updated_at();

ALTER TABLE public.storyline_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own storyline progress" ON public.storyline_progress;
CREATE POLICY "Users can view own storyline progress"
  ON public.storyline_progress FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own storyline progress" ON public.storyline_progress;
CREATE POLICY "Users can insert own storyline progress"
  ON public.storyline_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own storyline progress" ON public.storyline_progress;
CREATE POLICY "Users can update own storyline progress"
  ON public.storyline_progress FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own storyline progress" ON public.storyline_progress;
CREATE POLICY "Users can delete own storyline progress"
  ON public.storyline_progress FOR DELETE
  USING (auth.uid() = user_id);
