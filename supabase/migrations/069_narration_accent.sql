-- Narrator accent support for background narration jobs.
--
-- Accent is an English-narration steering instruction injected into the Gemini TTS
-- prompt (Gemini exposes no structured accent parameter). For the interactive path
-- the chosen accent id rides along inside stories.story_config JSON
-- (story_config.narrationVoice.accent), so no stories column is needed.
--
-- The background narration worker, however, locks the resolved voice on the job row
-- at submit time (mirroring voice_id) so it can reproduce the exact narration later.
-- This adds the matching accent id column so the worker reproduces the accent too.

ALTER TABLE public.narration_batch_jobs
  ADD COLUMN IF NOT EXISTS accent TEXT NULL;
