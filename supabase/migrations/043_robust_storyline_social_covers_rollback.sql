-- 043_robust_storyline_social_covers_rollback.sql

DELETE FROM public.pricing_action_costs
WHERE action_key IN (
  'generate_social_share_cover',
  'generate_audio_story_cover',
  'generate_reel_thumbnail'
);

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'social_share_cover_system_enabled',
  'visual_story_cover_generation_enabled',
  'visual_story_cover_generation_coin_cost',
  'audio_story_cover_generation_enabled',
  'audio_story_cover_generation_coin_cost',
  'vertical_reel_thumbnail_generation_enabled',
  'vertical_reel_thumbnail_generation_coin_cost',
  'allow_free_cover_upload',
  'allow_audio_story_cover_upload',
  'allow_youtube_thumbnail_upload',
  'default_story_cover_template_enabled',
  'default_audio_story_cover_template_enabled',
  'cover_generation_model',
  'cover_generation_storage_bucket',
  'max_cover_generation_retries'
);

DROP INDEX IF EXISTS public.idx_storylines_share_cover_missing;
DROP INDEX IF EXISTS public.idx_storylines_share_cover_ready;

ALTER TABLE public.storylines
  DROP CONSTRAINT IF EXISTS storylines_orientation_check,
  DROP CONSTRAINT IF EXISTS storylines_story_visual_mode_check,
  DROP CONSTRAINT IF EXISTS storylines_story_format_check,
  DROP CONSTRAINT IF EXISTS storylines_reel_thumbnail_status_check,
  DROP CONSTRAINT IF EXISTS storylines_reel_thumbnail_source_check,
  DROP CONSTRAINT IF EXISTS storylines_youtube_thumbnail_status_check,
  DROP CONSTRAINT IF EXISTS storylines_youtube_thumbnail_source_check,
  DROP CONSTRAINT IF EXISTS storylines_share_cover_status_check,
  DROP CONSTRAINT IF EXISTS storylines_share_cover_source_check;

ALTER TABLE public.storylines
  DROP COLUMN IF EXISTS orientation,
  DROP COLUMN IF EXISTS story_visual_mode,
  DROP COLUMN IF EXISTS story_format,
  DROP COLUMN IF EXISTS audio_cover_prompt,
  DROP COLUMN IF EXISTS reel_thumbnail_prompt,
  DROP COLUMN IF EXISTS youtube_thumbnail_prompt,
  DROP COLUMN IF EXISTS social_cover_prompt,
  DROP COLUMN IF EXISTS reel_thumbnail_version,
  DROP COLUMN IF EXISTS reel_thumbnail_updated_at,
  DROP COLUMN IF EXISTS reel_thumbnail_mime_type,
  DROP COLUMN IF EXISTS reel_thumbnail_height,
  DROP COLUMN IF EXISTS reel_thumbnail_width,
  DROP COLUMN IF EXISTS reel_thumbnail_status,
  DROP COLUMN IF EXISTS reel_thumbnail_source,
  DROP COLUMN IF EXISTS reel_thumbnail_url,
  DROP COLUMN IF EXISTS youtube_thumbnail_version,
  DROP COLUMN IF EXISTS youtube_thumbnail_updated_at,
  DROP COLUMN IF EXISTS youtube_thumbnail_mime_type,
  DROP COLUMN IF EXISTS youtube_thumbnail_height,
  DROP COLUMN IF EXISTS youtube_thumbnail_width,
  DROP COLUMN IF EXISTS youtube_thumbnail_status,
  DROP COLUMN IF EXISTS youtube_thumbnail_source,
  DROP COLUMN IF EXISTS youtube_thumbnail_url,
  DROP COLUMN IF EXISTS share_cover_version,
  DROP COLUMN IF EXISTS share_cover_updated_at,
  DROP COLUMN IF EXISTS share_cover_mime_type,
  DROP COLUMN IF EXISTS share_cover_height,
  DROP COLUMN IF EXISTS share_cover_width,
  DROP COLUMN IF EXISTS share_cover_status,
  DROP COLUMN IF EXISTS share_cover_source,
  DROP COLUMN IF EXISTS share_cover_url;
