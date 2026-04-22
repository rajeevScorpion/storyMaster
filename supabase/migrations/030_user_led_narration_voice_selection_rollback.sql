-- 030_user_led_narration_voice_selection_rollback.sql

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'narration_user_led_voice_selection_enabled',
  'narration_male_voice_list',
  'narration_female_voice_list',
  'narration_default_male_voice',
  'narration_default_female_voice',
  'narration_sample_text_en_in',
  'narration_sample_text_hi_in'
);

DROP POLICY IF EXISTS "Anyone can read narration voice sample files" ON storage.objects;
DELETE FROM storage.objects WHERE bucket_id = 'narration-voice-samples';
DELETE FROM storage.buckets WHERE id = 'narration-voice-samples';

DROP TABLE IF EXISTS public.narration_voice_samples;

ALTER TABLE public.beats
  DROP COLUMN IF EXISTS narration_voice_id;

ALTER TABLE public.stories
  DROP CONSTRAINT IF EXISTS stories_narration_voice_gender_bucket_check,
  DROP CONSTRAINT IF EXISTS stories_narration_voice_mode_check,
  DROP COLUMN IF EXISTS narration_language_code,
  DROP COLUMN IF EXISTS narration_voice_gender_bucket,
  DROP COLUMN IF EXISTS narration_voice_mode;
