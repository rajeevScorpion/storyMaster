-- Rollback for 056_reel_voice_previews.sql
-- NOTE: Audio blobs stored in Cloudflare R2 under stories/*/voice-previews/* are NOT
-- automatically deleted by this rollback. Clean them up manually via the R2 dashboard
-- or with: aws s3 rm s3://<private-bucket>/stories/ --recursive --exclude "*" --include "*/voice-previews/*"

DROP POLICY IF EXISTS "Users can manage own voice previews" ON reel_narration_voice_previews;
DROP INDEX  IF EXISTS reel_voice_previews_user_id_idx;
DROP INDEX  IF EXISTS reel_voice_previews_story_id_idx;
DROP TABLE  IF EXISTS reel_narration_voice_previews;
