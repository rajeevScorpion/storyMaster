-- Rollback for migration 091: Viewer profile foundation

DROP TRIGGER IF EXISTS trg_viewer_profiles_updated_at ON public.viewer_profiles;
DROP FUNCTION IF EXISTS public.touch_viewer_profiles_updated_at();

DROP INDEX IF EXISTS public.idx_viewer_profiles_one_default;
DROP INDEX IF EXISTS public.idx_viewer_profiles_account;

DROP TABLE IF EXISTS public.viewer_profiles;
