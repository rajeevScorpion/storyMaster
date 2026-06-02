-- Refresh Gemini model defaults after Gemini preview model deprecations.
-- Moves app-managed task defaults off preview/retiring model IDs while leaving unknown custom values untouched.

INSERT INTO public.model_config (task_key, model_id, temperature)
VALUES
  ('story_generation', 'gemini-3.5-flash', 0.7),
  ('reel_story_generation', 'gemini-3.5-flash', 0.7),
  ('seed_plan_generation', 'gemini-3.5-flash', 0.3),
  ('seeded_beat_materialization', 'gemini-3.5-flash', 0.4),
  ('visual_prompt', 'gemini-3.5-flash', 0.7),
  ('reel_visual_prompt', 'gemini-3.5-flash', 0.5),
  ('image_generation', 'gemini-3.1-flash-image', NULL),
  ('reel_image_generation', 'gemini-3.1-flash-image', NULL),
  ('portrait_generation', 'gemini-3.1-flash-image', NULL),
  ('graphic_style_extraction', 'gemini-2.5-flash', 0.4),
  ('tts', 'gemini-3.1-flash-tts-preview', NULL),
  ('reel_tts', 'gemini-3.1-flash-tts-preview', NULL),
  ('voice_selection', 'gemini-3.5-flash', 0.3)
ON CONFLICT (task_key) DO NOTHING;

UPDATE public.model_config
SET model_id = 'gemini-3.5-flash',
    updated_at = now()
WHERE task_key IN (
    'story_generation',
    'reel_story_generation',
    'seed_plan_generation',
    'seeded_beat_materialization',
    'visual_prompt',
    'reel_visual_prompt',
    'voice_selection'
  )
  AND model_id IN (
    'gemini-3.1-pro-preview',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash-preview-05-20',
    'gemini-2.5-flash-preview-09-25',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001'
  );

UPDATE public.model_config
SET model_id = 'gemini-3.1-flash-lite',
    updated_at = now()
WHERE model_id IN (
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash-lite-preview-09-2025',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
  'gemini-2.0-flash-lite-preview',
  'gemini-2.0-flash-lite-preview-02-05'
);

UPDATE public.model_config
SET model_id = 'gemini-3.1-flash-image',
    updated_at = now()
WHERE task_key IN (
    'image_generation',
    'reel_image_generation',
    'portrait_generation'
  )
  AND model_id IN (
    'gemini-3.1-flash-image-preview',
    'gemini-2.5-flash-image-preview',
    'gemini-2.0-flash-preview-image-generation'
  );

UPDATE public.model_config
SET model_id = 'gemini-3-pro-image',
    updated_at = now()
WHERE task_key IN (
    'image_generation',
    'reel_image_generation',
    'portrait_generation'
  )
  AND model_id = 'gemini-3-pro-image-preview';

UPDATE public.model_config
SET model_id = 'gemini-3.1-flash-tts-preview',
    updated_at = now()
WHERE task_key IN ('tts', 'reel_tts')
  AND model_id IN (
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts'
  );

UPDATE public.feature_flags
SET value = 'gemini-3.1-flash-image',
    updated_at = now()
WHERE flag_key = 'cover_generation_model'
  AND value IN (
    'gemini-3.1-flash-image-preview',
    'gemini-2.5-flash-image-preview',
    'gemini-2.0-flash-preview-image-generation'
  );

UPDATE public.feature_flags
SET value = 'gemini-3-pro-image',
    updated_at = now()
WHERE flag_key = 'cover_generation_model'
  AND value = 'gemini-3-pro-image-preview';
