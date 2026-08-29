-- 100_legal_acceptances.sql
-- Server-authoritative evidence that a user accepted a contract document or was
-- shown a notice, tied to the exact document version.
--
-- Privacy-conscious by design: NO ip_address and NO user_agent column. The pack's
-- guidance is not to duplicate network identifiers into contract evidence without
-- a verified need, and no table in this schema stores them today.
--
-- Deliberately NOT a boolean on profiles: contract acceptance, notice
-- acknowledgement, optional consent and parental consent are different events and
-- must stay separately recorded.

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_key TEXT NOT NULL,
  document_version TEXT NOT NULL,
  acceptance_type TEXT NOT NULL DEFAULT 'accepted'
    CHECK (acceptance_type IN ('accepted', 'acknowledged')),
  surface TEXT NOT NULL
    CHECK (surface IN ('email_signup', 'oauth_onboarding', 'reconsent_modal', 'admin_backfill')),
  locale TEXT NULL,
  app_build TEXT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, document_key, document_version)
);

COMMENT ON TABLE public.legal_acceptances IS
  'Contract acceptance and notice acknowledgement, one row per user/document/version. UNIQUE makes repeated writes idempotent. accepted_at is a server timestamp; the version is resolved server-side and is never taken from the client.';

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user
  ON public.legal_acceptances (user_id, document_key, accepted_at DESC);

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.legal_acceptances FROM anon, authenticated;
GRANT ALL ON TABLE public.legal_acceptances TO service_role;
-- No end-user policies. Writes happen only through recordLegalAcceptance(), which
-- establishes identity server-side and resolves the version from managed_pages.
