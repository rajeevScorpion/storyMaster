-- 080: Enable Supabase Realtime on public.beats
--
-- The media worker writes image_status ('ready'/'failed'), image_url and
-- image_synced_at to the beats row when a background image job completes (and
-- audio_url when narration completes). Adding beats to the Realtime publication
-- lets the browser be *pushed* these transitions the instant they land, so the
-- client can drop its image-job status polling loop (one signed-URL fetch on
-- the push instead of ~20 status POSTs per beat).
--
-- RLS already scopes beats SELECT to the owner (migration 003), and Realtime
-- enforces that same policy, so each user only receives their own beat rows.

-- FULL replica identity: Realtime evaluates RLS + column filters against the
-- changed row; the default identity exposes only the primary key in the OLD
-- record for UPDATE/DELETE, which breaks the story_id filter + owner RLS check.
ALTER TABLE public.beats REPLICA IDENTITY FULL;

-- Add beats to the Realtime publication (idempotent — ADD TABLE errors if the
-- table is already a member).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'beats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.beats;
  END IF;
END
$$;
