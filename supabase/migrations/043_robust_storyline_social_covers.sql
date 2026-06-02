-- 043_robust_storyline_social_covers.sql
-- Dedicated, crawler-safe publishing assets for storyline social sharing,
-- YouTube thumbnails, and reel thumbnails.

ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS value TEXT NULL;

-- Make the intended public delivery bucket explicit and self-healing. Older
-- environments may have the bucket/policies drifted from the initial migration.
INSERT INTO storage.buckets (id, name, public)
VALUES ('public-storylines', 'public-storylines', true)
ON CONFLICT (id) DO UPDATE
SET public = true;

DROP POLICY IF EXISTS "Anyone can read public storyline assets" ON storage.objects;
CREATE POLICY "Anyone can read public storyline assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'public-storylines');

DROP POLICY IF EXISTS "Users can upload public storyline assets" ON storage.objects;
CREATE POLICY "Users can upload public storyline assets"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'public-storylines'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update own public storyline assets" ON storage.objects;
CREATE POLICY "Users can update own public storyline assets"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'public-storylines'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete own public storyline assets" ON storage.objects;
CREATE POLICY "Users can delete own public storyline assets"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'public-storylines'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

ALTER TABLE public.storylines
  ADD COLUMN IF NOT EXISTS share_cover_url TEXT,
  ADD COLUMN IF NOT EXISTS share_cover_source TEXT,
  ADD COLUMN IF NOT EXISTS share_cover_status TEXT NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS share_cover_width INTEGER,
  ADD COLUMN IF NOT EXISTS share_cover_height INTEGER,
  ADD COLUMN IF NOT EXISTS share_cover_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS share_cover_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS share_cover_version TEXT,
  ADD COLUMN IF NOT EXISTS youtube_thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS youtube_thumbnail_source TEXT,
  ADD COLUMN IF NOT EXISTS youtube_thumbnail_status TEXT NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS youtube_thumbnail_width INTEGER,
  ADD COLUMN IF NOT EXISTS youtube_thumbnail_height INTEGER,
  ADD COLUMN IF NOT EXISTS youtube_thumbnail_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS youtube_thumbnail_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS youtube_thumbnail_version TEXT,
  ADD COLUMN IF NOT EXISTS reel_thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS reel_thumbnail_source TEXT,
  ADD COLUMN IF NOT EXISTS reel_thumbnail_status TEXT NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS reel_thumbnail_width INTEGER,
  ADD COLUMN IF NOT EXISTS reel_thumbnail_height INTEGER,
  ADD COLUMN IF NOT EXISTS reel_thumbnail_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS reel_thumbnail_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reel_thumbnail_version TEXT,
  ADD COLUMN IF NOT EXISTS social_cover_prompt TEXT,
  ADD COLUMN IF NOT EXISTS youtube_thumbnail_prompt TEXT,
  ADD COLUMN IF NOT EXISTS reel_thumbnail_prompt TEXT,
  ADD COLUMN IF NOT EXISTS audio_cover_prompt TEXT,
  ADD COLUMN IF NOT EXISTS story_format TEXT NOT NULL DEFAULT 'visual_story',
  ADD COLUMN IF NOT EXISTS story_visual_mode TEXT NOT NULL DEFAULT 'with_images',
  ADD COLUMN IF NOT EXISTS orientation TEXT NOT NULL DEFAULT 'landscape';

UPDATE public.storylines AS sl
SET
  story_format = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.stories s
      WHERE s.id = sl.story_id
        AND s.story_config->>'imageGenerationMode' = 'prompt_only'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.beats b
      JOIN public.storyline_beats sb ON sb.beat_id = b.id
      WHERE sb.storyline_id = sl.id
        AND b.image_url IS NOT NULL
    )
    THEN 'audio_story'
    ELSE 'visual_story'
  END,
  story_visual_mode = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.stories s
      WHERE s.id = sl.story_id
        AND s.story_config->>'imageGenerationMode' = 'prompt_only'
    )
    THEN 'without_images'
    ELSE 'with_images'
  END,
  orientation = CASE
    WHEN sl.is_vertical_story = true OR sl.aspect_ratio = '9:16' THEN 'portrait'
    ELSE 'landscape'
  END
WHERE sl.story_format = 'visual_story'
  AND sl.story_visual_mode = 'with_images'
  AND sl.orientation = 'landscape';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_share_cover_source_check') THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_share_cover_source_check
      CHECK (
        share_cover_source IS NULL OR share_cover_source IN (
          'custom_generated',
          'uploaded',
          'fallback_beat',
          'branded_default',
          'migrated_existing'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_share_cover_status_check') THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_share_cover_status_check
      CHECK (share_cover_status IN ('missing', 'generating', 'ready', 'failed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_youtube_thumbnail_source_check') THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_youtube_thumbnail_source_check
      CHECK (
        youtube_thumbnail_source IS NULL OR youtube_thumbnail_source IN (
          'custom_generated',
          'uploaded',
          'fallback_beat',
          'branded_default',
          'migrated_existing'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_youtube_thumbnail_status_check') THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_youtube_thumbnail_status_check
      CHECK (youtube_thumbnail_status IN ('missing', 'generating', 'ready', 'failed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_reel_thumbnail_source_check') THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_reel_thumbnail_source_check
      CHECK (
        reel_thumbnail_source IS NULL OR reel_thumbnail_source IN (
          'custom_generated',
          'uploaded',
          'fallback_beat',
          'branded_default',
          'migrated_existing'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_reel_thumbnail_status_check') THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_reel_thumbnail_status_check
      CHECK (reel_thumbnail_status IN ('missing', 'generating', 'ready', 'failed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_story_format_check') THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_story_format_check
      CHECK (story_format IN ('visual_story', 'audio_story'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_story_visual_mode_check') THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_story_visual_mode_check
      CHECK (story_visual_mode IN ('with_images', 'without_images'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storylines_orientation_check') THEN
    ALTER TABLE public.storylines
      ADD CONSTRAINT storylines_orientation_check
      CHECK (orientation IN ('landscape', 'portrait'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_storylines_share_cover_ready
  ON public.storylines (share_cover_status, share_cover_updated_at DESC)
  WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_storylines_share_cover_missing
  ON public.storylines (created_at DESC)
  WHERE is_public = true
    AND (share_cover_status <> 'ready' OR share_cover_url IS NULL);

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('social_share_cover_system_enabled', true, NULL),
  ('visual_story_cover_generation_enabled', true, NULL),
  ('visual_story_cover_generation_coin_cost', true, '10'),
  ('audio_story_cover_generation_enabled', true, NULL),
  ('audio_story_cover_generation_coin_cost', true, '10'),
  ('vertical_reel_thumbnail_generation_enabled', true, NULL),
  ('vertical_reel_thumbnail_generation_coin_cost', true, '10'),
  ('allow_free_cover_upload', true, NULL),
  ('allow_audio_story_cover_upload', true, NULL),
  ('allow_youtube_thumbnail_upload', true, NULL),
  ('default_story_cover_template_enabled', true, NULL),
  ('default_audio_story_cover_template_enabled', true, NULL),
  ('cover_generation_model', true, 'gemini-3.1-flash-image'),
  ('cover_generation_storage_bucket', true, 'public-storylines'),
  ('max_cover_generation_retries', true, '1')
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.pricing_action_costs (action_key, beat_cost, is_active)
VALUES
  ('generate_social_share_cover', 1, true),
  ('generate_audio_story_cover', 1, true),
  ('generate_reel_thumbnail', 1, true)
ON CONFLICT (action_key) DO UPDATE
SET
  beat_cost = EXCLUDED.beat_cost,
  is_active = EXCLUDED.is_active,
  updated_at = now();
