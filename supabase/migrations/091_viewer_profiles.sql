-- Migration 091: Viewer profile foundation
--
-- Phase 7 of the gallery transformation. Kissago already has public.profiles,
-- but that is the *account* identity (1:1 with auth.users, carries the creator
-- display name shown on published storylines). Household viewing profiles are a
-- different concept: several viewers share one account, and each needs its own
-- catalogue eligibility and, later, its own history.
--
--   Account (auth.users) -> Viewer profile -> Age eligibility -> Feed
--
-- This migration adds the table only. It deliberately does NOT:
--   * backfill a row per existing account — an account with no rows resolves to
--     an implicit default adult profile, so nothing changes for current users
--   * move saved storylines or progress under a profile — that data stays
--     account-scoped until profile switching actually ships
--   * add PINs, parental dashboards, or entitlements
--
-- The one rule that must hold from day one: a kids profile constrains the
-- catalogue in the query layer (see resolveEffectiveAudienceMode in
-- app/actions/gallery.ts), never by hiding UI.

CREATE TABLE IF NOT EXISTS public.viewer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  -- Kept intentionally small: one emoji, not an avatar asset pipeline.
  avatar_emoji text,
  -- Discovery scope this profile may browse. Mirrors GalleryAudienceMode.
  audience_mode text NOT NULL DEFAULT 'all'
    CHECK (audience_mode IN ('all', 'kids')),
  -- Optional finer-grained band for later ranking; NULL means unrestricted.
  age_band text
    CHECK (age_band IS NULL OR age_band IN
      ('all_ages', 'kids_3_5', 'kids_5_8', 'kids_8_12', 'teens', 'adults')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_viewer_profiles_account
  ON public.viewer_profiles (account_id, created_at);

-- At most one explicit default per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_viewer_profiles_one_default
  ON public.viewer_profiles (account_id)
  WHERE is_default = true;

CREATE OR REPLACE FUNCTION public.touch_viewer_profiles_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_viewer_profiles_updated_at ON public.viewer_profiles;
CREATE TRIGGER trg_viewer_profiles_updated_at
  BEFORE UPDATE ON public.viewer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_viewer_profiles_updated_at();

ALTER TABLE public.viewer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own viewer profiles" ON public.viewer_profiles;
CREATE POLICY "Users can view own viewer profiles"
  ON public.viewer_profiles FOR SELECT
  USING (auth.uid() = account_id);

DROP POLICY IF EXISTS "Users can insert own viewer profiles" ON public.viewer_profiles;
CREATE POLICY "Users can insert own viewer profiles"
  ON public.viewer_profiles FOR INSERT
  WITH CHECK (auth.uid() = account_id);

DROP POLICY IF EXISTS "Users can update own viewer profiles" ON public.viewer_profiles;
CREATE POLICY "Users can update own viewer profiles"
  ON public.viewer_profiles FOR UPDATE
  USING (auth.uid() = account_id)
  WITH CHECK (auth.uid() = account_id);

DROP POLICY IF EXISTS "Users can delete own viewer profiles" ON public.viewer_profiles;
CREATE POLICY "Users can delete own viewer profiles"
  ON public.viewer_profiles FOR DELETE
  USING (auth.uid() = account_id);
