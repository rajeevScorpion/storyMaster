-- Rollback 088. The gallery falls back to the deterministic beat-1 excerpt
-- once these columns are gone, so no data repair is required.
ALTER TABLE public.storylines
  DROP COLUMN IF EXISTS discovery_intro,
  DROP COLUMN IF EXISTS discovery_intro_status;
