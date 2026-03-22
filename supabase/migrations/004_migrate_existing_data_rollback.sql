-- ============================================================
-- 004 Rollback: Remove migrated data (keeps table structure)
-- ============================================================

-- Clear migrated junction rows
DELETE FROM public.storyline_beats;

-- Clear migrated beats
DELETE FROM public.beats;

-- Clear path_hash values
UPDATE public.storylines SET path_hash = NULL;

-- Clear current_node_id values
UPDATE public.stories SET current_node_id = NULL;
