ALTER TABLE public.beats
ADD COLUMN IF NOT EXISTS storyboard_narration_timing JSONB NULL;
