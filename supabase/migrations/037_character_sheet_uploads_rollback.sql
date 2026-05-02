-- 037_character_sheet_uploads_rollback.sql

DELETE FROM public.feature_flags
WHERE flag_key IN (
  'character_sheet_upload_enabled',
  'character_sheet_upload_max_bytes'
);
