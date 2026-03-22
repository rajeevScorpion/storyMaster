-- ============================================================
-- 002: Add UPDATE policies for storage buckets
-- Fixes: "new row violates row-level security policy" on upsert
-- ============================================================

-- story-assets: allow owner to update (needed for upsert: true)
create policy "Users can update own story assets"
  on storage.objects for update
  using (
    bucket_id = 'story-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- public-storylines: allow owner to update (needed for upsert: true)
create policy "Users can update own public storyline assets"
  on storage.objects for update
  using (
    bucket_id = 'public-storylines'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
