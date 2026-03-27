-- Rollback Migration 007: Remove likes and views for storylines

DROP TRIGGER IF EXISTS trg_storyline_like_count ON public.storyline_likes;
DROP TRIGGER IF EXISTS trg_storyline_view_count ON public.storyline_views;
DROP FUNCTION IF EXISTS update_storyline_like_count();
DROP FUNCTION IF EXISTS update_storyline_view_count();
DROP TABLE IF EXISTS public.storyline_views;
DROP TABLE IF EXISTS public.storyline_likes;
ALTER TABLE public.storylines DROP COLUMN IF EXISTS like_count;
ALTER TABLE public.storylines DROP COLUMN IF EXISTS view_count;
