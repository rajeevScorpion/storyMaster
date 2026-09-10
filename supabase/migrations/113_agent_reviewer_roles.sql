-- 113_agent_reviewer_roles.sql
--
-- Phase 9b (D17): reviewer roles and routing coverage.
--
-- DEPENDS ON 111. Verify before applying:
--   select * from public.schema_migration_ledger where migration_number = 111;
--
-- 1. `role` becomes the SINGLE source of truth for capability. can_publish and
--    can_trigger_media are DROPPED rather than kept alongside it: two columns
--    describing one fact is exactly the drift bug this migration exists to avoid.
--    Capability is derived from role by a pure function (canPublish /
--    canTriggerMedia in lib/agentic/reviewers.shared.ts), so the matrix is one
--    readable table in code and is unit-testable without a database.
--
--    DROPPING IS SAFE HERE AND ONLY HERE: agent_reviewers holds ZERO rows on dev
--    (verified 2026-09-10) and does not exist at all on production -- no agentic
--    migration (103-112) has ever been applied there. No data is lost because no
--    data exists. If that stops being true, DO NOT apply this file as written:
--    backfill role from the booleans first.
--
-- 2. Routing coverage: three arrays, matching agent_personas.genres text[] (103)
--    rather than a join table, because there is no per-assignment metadata to
--    carry. These are the same three axes the Editorial Supervisor already
--    reasons in -- supervisor.shared.ts's cellKey(language, ageGroup, genre) --
--    so a reviewer's coverage is expressed in the taxonomy that produced the work.
--
-- Deliberately NO CHECK on array contents and NO GIN index:
--   * agent_tasks.age_group / .language carry no CHECK either (106); the taxonomy
--     lives in TypeScript (lib/story/age-groups.ts, lib/story/genres.ts,
--     lib/ai/story-config.ts) and a CHECK here would need a migration every time a
--     genre is added. Unit 9g validates on write against those same lists.
--   * the matcher (Unit 9j) loads the whole active roster into memory -- it must,
--     to compute least-loaded across all of them -- so there is no array-containment
--     query for a GIN index to serve.

ALTER TABLE public.agent_reviewers
  ADD COLUMN IF NOT EXISTS role       text   NOT NULL DEFAULT 'reviewer',
  ADD COLUMN IF NOT EXISTS age_groups text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS genres     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.agent_reviewers
  DROP CONSTRAINT IF EXISTS agent_reviewers_role_check;
ALTER TABLE public.agent_reviewers
  ADD CONSTRAINT agent_reviewers_role_check CHECK (role IN ('reviewer', 'editor'));

ALTER TABLE public.agent_reviewers
  DROP COLUMN IF EXISTS can_publish,
  DROP COLUMN IF EXISTS can_trigger_media;

COMMENT ON COLUMN public.agent_reviewers.role IS
  'Single source of truth for capability (D17). reviewer: review + trigger media. '
  'editor: also publish and assign. ADMIN_USER_ID is implicitly an editor in code, not here.';
COMMENT ON COLUMN public.agent_reviewers.age_groups IS
  'Concrete age groups this reviewer covers. Never contains all_ages (D16) -- an all_ages '
  'task is not auto-routed, it goes to the unassigned pool.';
COMMENT ON COLUMN public.agent_reviewers.genres IS
  'Genre preference, NOT a hard filter. Empty means no preference and never excludes.';

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (113, '113_agent_reviewer_roles.sql')
ON CONFLICT (migration_number) DO NOTHING;
