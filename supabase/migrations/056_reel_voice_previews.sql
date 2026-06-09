-- Voice preview history: stores up to 4 audio samples + settings snapshots per reel story.
-- Each row represents one "Preview" the user generated; applying one loads its settings back
-- into the narration draft so the user can tweak or export with those exact settings.

CREATE TABLE IF NOT EXISTS reel_narration_voice_previews (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id            UUID        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label               TEXT        NOT NULL,                         -- "Preview 01" … "Preview 04"
  voice_display_name  TEXT        NOT NULL DEFAULT '',
  audio_r2_key        TEXT        NOT NULL,                         -- R2 object key (private bucket)
  audio_mime_type     TEXT        NOT NULL DEFAULT 'audio/mpeg',
  settings_snapshot   JSONB       NOT NULL DEFAULT '{}',
  preview_scope       TEXT        NOT NULL DEFAULT '1_beat'
                        CHECK (preview_scope IN ('1_beat', 'full')),
  is_active           BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reel_voice_previews_story_id_idx ON reel_narration_voice_previews(story_id);
CREATE INDEX IF NOT EXISTS reel_voice_previews_user_id_idx  ON reel_narration_voice_previews(user_id);

ALTER TABLE reel_narration_voice_previews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own voice previews"
  ON reel_narration_voice_previews
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
