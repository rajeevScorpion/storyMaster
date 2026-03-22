-- ============================================================
-- ROLLBACK 002: Remove UPDATE policies for storage buckets
-- ============================================================

drop policy if exists "Users can update own story assets" on storage.objects;
drop policy if exists "Users can update own public storyline assets" on storage.objects;
