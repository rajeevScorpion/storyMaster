-- ============================================================
-- Kissago Database Schema
-- Run this migration in your Supabase SQL editor
-- ============================================================

-- ============================================================
-- 1. Profiles (auto-created from auth.users on signup)
-- ============================================================
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

-- Auto-create profile when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'Anonymous'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. Stories (branching story trees)
-- ============================================================
create table public.stories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  user_prompt text not null,
  genre text,
  tone text,
  visual_style text,
  target_age text,
  story_config jsonb,           -- { ageGroup, settingCountry, maxBeats, language }
  story_map jsonb not null,     -- Full StoryMap graph (images replaced with storage URLs)
  characters jsonb,
  setting jsonb,                -- { world, timeOfDay, mood }
  status text default 'active', -- 'active' | 'completed'
  narrator_voice text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- 3. Storylines (published linear paths from root to ending)
-- ============================================================
create table public.storylines (
  id uuid default gen_random_uuid() primary key,
  story_id uuid references public.stories(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  beat_count integer not null,
  cover_image_url text,         -- Public URL to cover thumbnail
  node_path text[] not null,    -- Ordered array of node IDs from root to ending
  beats jsonb not null,         -- Array of StoryBeat objects with storage URLs
  choices jsonb not null,       -- Array of { fromBeat, optionLabel } for playback
  author_name text,
  is_public boolean default true,
  created_at timestamptz default now()
);

-- ============================================================
-- 4. Row Level Security
-- ============================================================

-- Profiles
alter table public.profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Stories (private to owner)
alter table public.stories enable row level security;

create policy "Users can view own stories"
  on public.stories for select
  using (auth.uid() = user_id);

create policy "Users can insert own stories"
  on public.stories for insert
  with check (auth.uid() = user_id);

create policy "Users can update own stories"
  on public.stories for update
  using (auth.uid() = user_id);

create policy "Users can delete own stories"
  on public.stories for delete
  using (auth.uid() = user_id);

-- Storylines (public readable, own manageable)
alter table public.storylines enable row level security;

create policy "Public storylines are viewable by everyone"
  on public.storylines for select
  using (is_public = true);

create policy "Users can view own storylines"
  on public.storylines for select
  using (auth.uid() = user_id);

create policy "Users can insert own storylines"
  on public.storylines for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own storylines"
  on public.storylines for delete
  using (auth.uid() = user_id);

-- ============================================================
-- 5. Indexes
-- ============================================================
create index idx_stories_user_id on public.stories(user_id);
create index idx_storylines_public on public.storylines(is_public, created_at desc);
create index idx_storylines_user_id on public.storylines(user_id);
create index idx_storylines_story_id on public.storylines(story_id);

-- ============================================================
-- 6. Storage Buckets (run these separately or via Supabase dashboard)
-- ============================================================
-- Create these buckets manually in Supabase Dashboard > Storage:
--
-- 1. "story-assets" (Private)
--    - Authenticated users can upload to their own paths
--    - Owner-only read access
--
-- 2. "public-storylines" (Public)
--    - Public read access for everyone
--    - Authenticated users can upload to their own paths
--
-- Storage bucket policies (run in SQL editor after creating buckets):

-- story-assets: owner can upload and read
insert into storage.buckets (id, name, public) values ('story-assets', 'story-assets', false)
  on conflict (id) do nothing;

create policy "Users can upload story assets"
  on storage.objects for insert
  with check (
    bucket_id = 'story-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can read own story assets"
  on storage.objects for select
  using (
    bucket_id = 'story-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update own story assets"
  on storage.objects for update
  using (
    bucket_id = 'story-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own story assets"
  on storage.objects for delete
  using (
    bucket_id = 'story-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- public-storylines: anyone can read, authenticated users can upload to own paths
insert into storage.buckets (id, name, public) values ('public-storylines', 'public-storylines', true)
  on conflict (id) do nothing;

create policy "Anyone can read public storyline assets"
  on storage.objects for select
  using (bucket_id = 'public-storylines');

create policy "Users can upload public storyline assets"
  on storage.objects for insert
  with check (
    bucket_id = 'public-storylines'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update own public storyline assets"
  on storage.objects for update
  using (
    bucket_id = 'public-storylines'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own public storyline assets"
  on storage.objects for delete
  using (
    bucket_id = 'public-storylines'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
