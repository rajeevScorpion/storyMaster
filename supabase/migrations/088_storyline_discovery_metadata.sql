-- Discovery intro shown on gallery cards and the featured hero.
--
-- Stored rather than derived at read time: the gallery must never call an LLM
-- on a listing request, and a purpose-written catalogue line reads better than
-- an excerpt of the opening beat. Rows without a value fall back to a
-- deterministic beat-1 excerpt in application code, so the gallery keeps
-- working while these columns are null.
ALTER TABLE public.storylines
  ADD COLUMN IF NOT EXISTS discovery_intro TEXT,
  ADD COLUMN IF NOT EXISTS discovery_intro_status TEXT
    CHECK (discovery_intro_status IN ('ready', 'failed'));

COMMENT ON COLUMN public.storylines.discovery_intro IS
  'Concise 1-2 sentence catalogue introduction generated once at publish time.';

-- NULL = never attempted (legacy rows, or the generator has not run yet).
-- 'failed' = attempted and failed; the read path uses the deterministic
-- fallback. The distinction keeps the admin backfill idempotent.
COMMENT ON COLUMN public.storylines.discovery_intro_status IS
  'ready | failed | null(never attempted) — drives backfill selection and read fallback.';
