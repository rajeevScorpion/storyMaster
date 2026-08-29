-- 099_managed_page_versioning_rollback.sql

DROP INDEX IF EXISTS public.idx_managed_page_versions_page;
DROP TABLE IF EXISTS public.managed_page_versions;

ALTER TABLE public.managed_pages
  DROP COLUMN IF EXISTS doc_version,
  DROP COLUMN IF EXISTS effective_date,
  DROP COLUMN IF EXISTS requires_acceptance,
  DROP COLUMN IF EXISTS acceptance_kind,
  DROP COLUMN IF EXISTS reacceptance_required,
  DROP COLUMN IF EXISTS published_at;

DELETE FROM public.feature_flags WHERE flag_key = 'legal_consent_gate_enabled';
