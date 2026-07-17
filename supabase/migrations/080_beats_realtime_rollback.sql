-- Rollback 080: remove public.beats from Realtime and restore replica identity.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'beats'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.beats;
  END IF;
END
$$;

ALTER TABLE public.beats REPLICA IDENTITY DEFAULT;
