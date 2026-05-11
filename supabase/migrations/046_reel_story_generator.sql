-- 046_reel_story_generator.sql
-- Manual migration for Reel Story Generator support.
-- Do not apply automatically from the agent.

ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS story_kind TEXT NOT NULL DEFAULT 'story',
  ADD COLUMN IF NOT EXISTS reel_length_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS reel_retention_days INTEGER NULL,
  ADD COLUMN IF NOT EXISTS reel_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reel_cleanup_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS reel_deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reel_cleanup_last_error TEXT NULL;

ALTER TABLE public.storylines
  ADD COLUMN IF NOT EXISTS story_kind TEXT NOT NULL DEFAULT 'story';

ALTER TABLE public.beats
  ADD COLUMN IF NOT EXISTS reel_captions JSONB NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stories_story_kind_check') THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_story_kind_check
      CHECK (story_kind IN ('story', 'reel'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_story_kind_check') THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_story_kind_check
      CHECK (story_kind IN ('story', 'reel'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stories_reel_length_key_check') THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_reel_length_key_check
      CHECK (reel_length_key IS NULL OR reel_length_key IN ('short', 'medium', 'long'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stories_reel_cleanup_status_check') THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_reel_cleanup_status_check
      CHECK (reel_cleanup_status IN ('active', 'deleted', 'failed'));
  END IF;
END $$;

UPDATE public.stories
SET
  story_kind = CASE
    WHEN story_config->>'storyKind' = 'reel' THEN 'reel'
    ELSE 'story'
  END,
  reel_length_key = CASE
    WHEN story_config->>'storyKind' = 'reel'
      AND story_config->>'reelLength' IN ('short', 'medium', 'long')
    THEN story_config->>'reelLength'
    ELSE reel_length_key
  END
WHERE story_config IS NOT NULL;

UPDATE public.storylines AS sl
SET story_kind = COALESCE(s.story_kind, 'story')
FROM public.stories AS s
WHERE s.id = sl.story_id;

CREATE INDEX IF NOT EXISTS idx_stories_story_kind_created
  ON public.stories (story_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_storylines_story_kind_created
  ON public.storylines (story_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stories_reel_cleanup
  ON public.stories (story_kind, reel_expires_at, reel_cleanup_status)
  WHERE story_kind = 'reel' AND reel_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.reel_cleanup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  eligible_story_count INTEGER NOT NULL DEFAULT 0,
  deleted_story_count INTEGER NOT NULL DEFAULT 0,
  deleted_asset_count INTEGER NOT NULL DEFAULT 0,
  failed_asset_count INTEGER NOT NULL DEFAULT 0,
  deleted_object_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT reel_cleanup_runs_mode_check
    CHECK (mode IN ('dry_run', 'execute')),
  CONSTRAINT reel_cleanup_runs_status_check
    CHECK (status IN ('completed', 'failed'))
);

ALTER TABLE public.reel_cleanup_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read reel cleanup runs" ON public.reel_cleanup_runs;
CREATE POLICY "Admins can read reel cleanup runs"
  ON public.reel_cleanup_runs FOR SELECT
  USING (auth.uid() = current_setting('app.admin_user_id', true)::uuid);

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  (
    'reel_story_enabled',
    true,
    NULL
  ),
  (
    'reel_story_settings',
    true,
    '{
      "defaultLength": "short",
      "defaultMood": "playful",
      "defaultVisualStyle": "cinematic",
      "defaultNarrationStyle": "expressive",
      "panelCount": 4,
      "retentionDays": { "free": 30, "plus": 90, "studio": 180 },
      "moods": [
        { "key": "playful", "label": "Playful", "prompt": "bright, curious, quick emotional turns" },
        { "key": "cozy", "label": "Cozy", "prompt": "warm, intimate, gentle emotional rhythm" },
        { "key": "epic", "label": "Epic", "prompt": "bold, cinematic, adventurous stakes" }
      ],
      "visualStyles": [
        { "key": "cinematic", "label": "Cinematic", "prompt": "cinematic storybook frames with expressive lighting" },
        { "key": "anime", "label": "Anime", "prompt": "clean anime cel framing with expressive characters" },
        { "key": "storybook", "label": "Storybook", "prompt": "painterly storybook frames with warm character appeal" }
      ],
      "narrationStyles": [
        { "key": "expressive", "label": "Expressive", "prompt": "expressive narrator with natural pauses and energy" },
        { "key": "gentle", "label": "Gentle", "prompt": "soft, warm, reassuring narration" },
        { "key": "dramatic", "label": "Dramatic", "prompt": "dramatic narration with suspense and momentum" }
      ]
    }'
  )
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active)
VALUES
  ('start_reel_initial_beat', 1, true),
  ('continue_reel_new_beat', 1, true)
ON CONFLICT (action_key) DO NOTHING;

INSERT INTO public.model_config (task_key, model_id, temperature)
VALUES
  ('reel_story_generation', 'gemini-3.1-pro-preview', 0.7),
  ('reel_visual_prompt', 'gemini-3.1-pro-preview', 0.5),
  ('reel_tts', 'gemini-2.5-flash-preview-tts', NULL)
ON CONFLICT (task_key) DO NOTHING;
