-- Migration 007: Add likes and views for storylines
-- Adds engagement tracking tables with counter caches on storylines

-- ============================================================
-- 1. New tables
-- ============================================================

CREATE TABLE public.storyline_likes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  storyline_id uuid REFERENCES public.storylines(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, storyline_id)
);

CREATE TABLE public.storyline_views (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  storyline_id uuid REFERENCES public.storylines(id) ON DELETE CASCADE NOT NULL,
  viewed_at timestamptz DEFAULT now(),
  UNIQUE(user_id, storyline_id)
);

-- ============================================================
-- 2. Counter cache columns on storylines
-- ============================================================

ALTER TABLE public.storylines
  ADD COLUMN like_count integer NOT NULL DEFAULT 0,
  ADD COLUMN view_count integer NOT NULL DEFAULT 0;

-- ============================================================
-- 3. Indexes
-- ============================================================

CREATE INDEX idx_storyline_likes_user ON public.storyline_likes(user_id);
CREATE INDEX idx_storyline_likes_storyline ON public.storyline_likes(storyline_id);
CREATE INDEX idx_storyline_views_user ON public.storyline_views(user_id);
CREATE INDEX idx_storyline_views_storyline ON public.storyline_views(storyline_id);

-- ============================================================
-- 4. Trigger functions for counter cache
-- ============================================================

CREATE OR REPLACE FUNCTION update_storyline_like_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.storylines SET like_count = like_count + 1 WHERE id = NEW.storyline_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.storylines SET like_count = like_count - 1 WHERE id = OLD.storyline_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_storyline_like_count
  AFTER INSERT OR DELETE ON public.storyline_likes
  FOR EACH ROW EXECUTE FUNCTION update_storyline_like_count();

CREATE OR REPLACE FUNCTION update_storyline_view_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.storylines SET view_count = view_count + 1 WHERE id = NEW.storyline_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_storyline_view_count
  AFTER INSERT ON public.storyline_views
  FOR EACH ROW EXECUTE FUNCTION update_storyline_view_count();

-- ============================================================
-- 5. RLS policies
-- ============================================================

ALTER TABLE public.storyline_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own likes"
  ON public.storyline_likes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own likes"
  ON public.storyline_likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own likes"
  ON public.storyline_likes FOR DELETE
  USING (auth.uid() = user_id);

ALTER TABLE public.storyline_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own views"
  ON public.storyline_views FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own views"
  ON public.storyline_views FOR INSERT
  WITH CHECK (auth.uid() = user_id);
