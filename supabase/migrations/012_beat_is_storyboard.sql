-- 012_beat_is_storyboard.sql
-- Persist storyboard flag on beats so it survives round-trips through the normalized beats table

ALTER TABLE beats
  ADD COLUMN IF NOT EXISTS is_storyboard BOOLEAN NOT NULL DEFAULT false;
