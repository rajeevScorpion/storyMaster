-- 048_reel_playground_image_styles_rollback.sql
-- Manual rollback for Reel Playground image style library.

DROP TRIGGER IF EXISTS reel_visual_styles_touch_updated_at ON public.reel_visual_styles;
DROP FUNCTION IF EXISTS public.touch_reel_visual_styles_updated_at();
DROP TABLE IF EXISTS public.reel_visual_styles;

DELETE FROM public.model_config
WHERE task_key = 'reel_image_generation';

DELETE FROM public.prompt_configs
WHERE task_key = 'reel_image_generation';

DELETE FROM public.prompt_drafts
WHERE task_key = 'reel_image_generation';

DELETE FROM public.prompt_history
WHERE task_key = 'reel_image_generation';

DELETE FROM public.prompt_test_runs
WHERE task_key = 'reel_image_generation';

ALTER TABLE public.media_assets
  DROP CONSTRAINT IF EXISTS media_assets_asset_type_check;

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_asset_type_check
  CHECK (asset_type IN (
    'beat_image',
    'storyboard_image',
    'character_reference',
    'storyline_cover',
    'share_cover',
    'youtube_thumbnail',
    'reel_thumbnail',
    'narration_audio',
    'portrait',
    'unknown'
  ));

UPDATE public.feature_flags
SET
  value = (
    COALESCE(value::jsonb, '{}'::jsonb)
    - 'defaultBeatCount'
    - 'defaultTextLength'
    - 'textOverlayDefault'
    - 'textLengthWordRanges'
    - 'elevenLabs'
  )::text,
  updated_at = now()
WHERE flag_key = 'reel_story_settings';
