-- 103_agent_personas.sql
--
-- Agentic Creator System: the persona library.
--
-- `agent_personas` holds creative identity for autonomous story creators —
-- language, age group, genre lean, prompt, permissions, lifecycle status, and
-- per-persona model overrides. `agent_persona_memory` is a one-row-per-persona
-- scratchpad (recent titles/premises/character names/settings/themes plus
-- reviewer feedback) kept in sync by an AFTER INSERT trigger, so application
-- code never has to remember to create the memory row itself.
--
-- This migration ships EMPTY. No persona rows are inserted here — the 15 seed
-- personas are a separate migration (104), gated on an operator sight-check of
-- the taxonomy mapping (real age-group ids, genre values, TTS voice ids, style
-- preset, and confirmation every seed is image-off). An empty table after this
-- migration is the correct, expected end state.
--
-- Both new tables are RLS-enabled with zero policies and REVOKE ALL from
-- anon/authenticated, matching the pattern already used for admin-only tables
-- (model_config, prompt_configs, feature_flags — see 097). Service-role access
-- only, via lib/supabase/admin.ts createAdminClient(). Application code fails
-- closed while this migration is unapplied: app/actions/agentic-personas.ts
-- catches the missing-relation error and returns an empty list / null rather
-- than throwing, exactly like lib/legal/consent.ts does for 099/100.
--
-- ensure_agent_persona_memory() is SECURITY DEFINER with SET search_path =
-- public, matching the hardening migration 098 applied repo-wide (the posture
-- there is "0 mutable search_path functions on a SECURITY DEFINER function" —
-- this migration does not regress it by introducing a new mutable one).
--
-- `stories.agent_persona_id` is added nullable with ON DELETE SET NULL, so a
-- persona can be archived/removed without orphaning or blocking deletion of
-- any story it produced.
--
-- Apply to development first. Then confirm:
--   select * from public.schema_migration_ledger where migration_number = 103;
--   select count(*) from public.agent_personas;        -- expect 0
--   select count(*) from public.agent_persona_memory;   -- expect 0
-- and that ordinary story creation/save is unaffected (agent_persona_id is
-- nullable and untouched by every existing code path).

CREATE TABLE IF NOT EXISTS public.agent_personas (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    TEXT NOT NULL UNIQUE,
  display_name            TEXT NOT NULL,
  bio                     TEXT,
  avatar_url              TEXT,
  language                TEXT NOT NULL,
  age_group               TEXT NOT NULL,
  genres                  TEXT[] NOT NULL DEFAULT '{}',
  speciality              TEXT,
  persona_prompt          TEXT NOT NULL,
  creative_notes          TEXT,
  restricted_themes       TEXT[] NOT NULL DEFAULT '{}',
  default_story_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
  dynamic_setting_keys    TEXT[] NOT NULL DEFAULT '{}',
  beat_count_min          INTEGER NOT NULL DEFAULT 6,
  beat_count_max          INTEGER NOT NULL DEFAULT 10,
  preferred_voice         TEXT,
  approved_voice_pool     TEXT[] NOT NULL DEFAULT '{}',
  allow_image_generation  BOOLEAN NOT NULL DEFAULT false,
  allow_narration         BOOLEAN NOT NULL DEFAULT false,
  model_overrides         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','testing','active','paused','archived')),
  schedule_eligible       BOOLEAN NOT NULL DEFAULT false,
  is_seed                 BOOLEAN NOT NULL DEFAULT false,
  cloned_from             UUID REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_personas_filter
  ON public.agent_personas (status, language, age_group);

CREATE TABLE IF NOT EXISTS public.agent_persona_memory (
  persona_id        UUID PRIMARY KEY REFERENCES public.agent_personas(id) ON DELETE CASCADE,
  recent_titles     TEXT[] NOT NULL DEFAULT '{}',
  recent_premises   TEXT[] NOT NULL DEFAULT '{}',
  character_names   TEXT[] NOT NULL DEFAULT '{}',
  settings_used     TEXT[] NOT NULL DEFAULT '{}',
  themes_used       TEXT[] NOT NULL DEFAULT '{}',
  reviewer_feedback JSONB NOT NULL DEFAULT '[]'::jsonb,
  story_count       INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.ensure_agent_persona_memory()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.agent_persona_memory (persona_id) VALUES (NEW.id)
  ON CONFLICT (persona_id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_agent_persona_memory ON public.agent_personas;
CREATE TRIGGER trg_agent_persona_memory
  AFTER INSERT ON public.agent_personas
  FOR EACH ROW EXECUTE FUNCTION public.ensure_agent_persona_memory();

ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS agent_persona_id UUID
  REFERENCES public.agent_personas(id) ON DELETE SET NULL;

ALTER TABLE public.agent_personas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_persona_memory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_personas       FROM anon, authenticated;
REVOKE ALL ON public.agent_persona_memory FROM anon, authenticated;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (103, '103_agent_personas.sql') ON CONFLICT (migration_number) DO NOTHING;
