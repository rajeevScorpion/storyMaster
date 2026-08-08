-- Rollback for migration 090: Per-viewer storyline reading progress

DROP TRIGGER IF EXISTS trg_storyline_progress_updated_at ON public.storyline_progress;
DROP FUNCTION IF EXISTS public.touch_storyline_progress_updated_at();

DROP INDEX IF EXISTS public.idx_storyline_progress_continue;
DROP INDEX IF EXISTS public.idx_storyline_progress_user_storyline;

DROP TABLE IF EXISTS public.storyline_progress;
