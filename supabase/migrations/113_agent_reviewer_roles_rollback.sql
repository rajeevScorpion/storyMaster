-- Reverses 113. LOSSY IF ROWS EXIST: role is dropped and the restored booleans
-- default to false, so an editor would come back as a reviewer with no publish
-- capability. Harmless today (zero rows); check before running it later.

ALTER TABLE public.agent_reviewers
  ADD COLUMN IF NOT EXISTS can_publish       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_trigger_media boolean NOT NULL DEFAULT false;

ALTER TABLE public.agent_reviewers
  DROP CONSTRAINT IF EXISTS agent_reviewers_role_check;

ALTER TABLE public.agent_reviewers
  DROP COLUMN IF EXISTS role,
  DROP COLUMN IF EXISTS age_groups,
  DROP COLUMN IF EXISTS languages,
  DROP COLUMN IF EXISTS genres,
  DROP COLUMN IF EXISTS updated_by;

DELETE FROM public.schema_migration_ledger WHERE migration_number = 113;
