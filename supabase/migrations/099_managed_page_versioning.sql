-- 099_managed_page_versioning.sql
-- Document versioning, effective dates and acceptance semantics for managed_pages,
-- plus an append-only published-version history.
--
-- Deliberately additive and inert: requires_acceptance stays false for every page
-- until an admin publishes a version, and the consent gate itself is behind the
-- legal_consent_gate_enabled flag seeded below (off). A database without this
-- migration keeps working -- the app latches "versioning unavailable" and renders
-- pages exactly as it does today.

ALTER TABLE public.managed_pages
  ADD COLUMN IF NOT EXISTS doc_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS effective_date DATE NULL,
  ADD COLUMN IF NOT EXISTS requires_acceptance BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acceptance_kind TEXT NULL
    CHECK (acceptance_kind IS NULL OR acceptance_kind IN ('accepted', 'acknowledged')),
  ADD COLUMN IF NOT EXISTS reacceptance_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.managed_pages.doc_version IS
  'Semantic document version shown to users and recorded in legal_acceptances. NULL = unversioned page.';
COMMENT ON COLUMN public.managed_pages.acceptance_kind IS
  'accepted = contract action (Terms/EULA). acknowledged = notice shown (Privacy). Never conflate the two.';
COMMENT ON COLUMN public.managed_pages.reacceptance_required IS
  'True when the current version is a material change. The gate then demands acceptance of exactly this doc_version.';

CREATE TABLE IF NOT EXISTS public.managed_page_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_key TEXT NOT NULL REFERENCES public.managed_pages(page_key) ON DELETE CASCADE,
  doc_version TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT NULL,
  effective_date DATE NULL,
  change_type TEXT NOT NULL DEFAULT 'minor'
    CHECK (change_type IN ('minor', 'material')),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (page_key, doc_version)
);

COMMENT ON TABLE public.managed_page_versions IS
  'Append-only snapshot of each published document version. Never updated in place: an acceptance record points at a doc_version and the exact text must remain retrievable.';

CREATE INDEX IF NOT EXISTS idx_managed_page_versions_page
  ON public.managed_page_versions (page_key, published_at DESC);

ALTER TABLE public.managed_page_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.managed_page_versions FROM anon, authenticated;
GRANT ALL ON TABLE public.managed_page_versions TO service_role;
-- Intentionally no end-user policies: reads go through the service-role loader,
-- writes only after verifyAdmin(). Same pattern as ~40 other admin config tables.

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES ('legal_consent_gate_enabled', false, NULL)
ON CONFLICT (flag_key) DO NOTHING;
