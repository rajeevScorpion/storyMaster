-- 037_character_sheet_uploads.sql
-- Feature flags for user-uploaded character reference sheets. The reference
-- URL itself lives inside the existing characters JSONB on stories/beats, so
-- no column-level schema changes are required.

INSERT INTO public.feature_flags (flag_key, enabled, value)
VALUES
  ('character_sheet_upload_enabled', true, NULL),
  ('character_sheet_upload_max_bytes', true, '5242880')
ON CONFLICT (flag_key) DO NOTHING;
