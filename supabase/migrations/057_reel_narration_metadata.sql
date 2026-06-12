-- Preserve provider/timestamp metadata for reel narration previews and applied beat narration.

ALTER TABLE public.reel_narration_voice_previews
  ADD COLUMN IF NOT EXISTS node_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS provider_used TEXT NULL,
  ADD COLUMN IF NOT EXISTS selected_model TEXT NULL,
  ADD COLUMN IF NOT EXISTS voice_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS language TEXT NULL,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER NULL,
  ADD COLUMN IF NOT EXISTS word_timestamps JSONB NULL,
  ADD COLUMN IF NOT EXISTS text_highlight_supported BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timestamp_source TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallback_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS chars_used INTEGER NULL,
  ADD COLUMN IF NOT EXISTS tokens_used INTEGER NULL,
  ADD COLUMN IF NOT EXISTS reel_captions JSONB NULL,
  ADD COLUMN IF NOT EXISTS active_narration JSONB NULL,
  ADD COLUMN IF NOT EXISTS generation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reel_voice_previews_provider_used_check'
  ) THEN
    ALTER TABLE public.reel_narration_voice_previews
      ADD CONSTRAINT reel_voice_previews_provider_used_check
      CHECK (provider_used IS NULL OR provider_used IN ('elevenlabs', 'gemini_tts'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reel_voice_previews_timestamp_source_check'
  ) THEN
    ALTER TABLE public.reel_narration_voice_previews
      ADD CONSTRAINT reel_voice_previews_timestamp_source_check
      CHECK (timestamp_source IN ('elevenlabs', 'none'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reel_voice_previews_provider_idx
  ON public.reel_narration_voice_previews(provider_used, fallback_used, created_at DESC);

CREATE INDEX IF NOT EXISTS reel_voice_previews_story_node_idx
  ON public.reel_narration_voice_previews(story_id, node_id, created_at DESC);

ALTER TABLE public.beats
  ADD COLUMN IF NOT EXISTS active_narration_preview_id UUID NULL REFERENCES public.reel_narration_voice_previews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS narration_metadata JSONB NULL;

CREATE INDEX IF NOT EXISTS beats_active_narration_preview_idx
  ON public.beats(active_narration_preview_id)
  WHERE active_narration_preview_id IS NOT NULL;
