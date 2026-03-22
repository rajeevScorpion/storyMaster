-- ============================================================
-- 003 Rollback: Remove normalized tables and revert alterations
-- ============================================================

-- Drop new RLS policies on existing tables
DROP POLICY IF EXISTS "Authenticated users can view non-archived stories" ON public.stories;
DROP POLICY IF EXISTS "Anonymous can view non-archived stories for gallery" ON public.stories;
DROP POLICY IF EXISTS "Authenticated users can read story assets for exploration" ON storage.objects;

-- Drop new tables (cascades indexes and RLS)
DROP TABLE IF EXISTS public.explored_stories CASCADE;
DROP TABLE IF EXISTS public.saved_storylines CASCADE;
DROP TABLE IF EXISTS public.storyline_beats CASCADE;
DROP TABLE IF EXISTS public.beats CASCADE;

-- Revert alterations to existing tables
ALTER TABLE public.stories DROP COLUMN IF EXISTS is_archived;
ALTER TABLE public.stories DROP COLUMN IF EXISTS current_node_id;
ALTER TABLE public.storylines DROP COLUMN IF EXISTS path_hash;
