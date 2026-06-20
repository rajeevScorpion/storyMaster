DELETE FROM public.feature_flags
WHERE flag_key = 'story_text_overlay_words_per_line';

ALTER TABLE public.beats
  DROP CONSTRAINT IF EXISTS beats_story_text_overlay_mode_check,
  DROP COLUMN IF EXISTS story_text_overlay_alignment,
  DROP COLUMN IF EXISTS story_text_overlay_captions,
  DROP COLUMN IF EXISTS story_text_overlay_style,
  DROP COLUMN IF EXISTS story_text_overlay_mode,
  DROP COLUMN IF EXISTS story_text_overlay_enabled;
