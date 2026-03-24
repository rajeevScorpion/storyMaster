'use server';

import { createClient } from '@/lib/supabase/server';
import type { GalleryStoryline, GalleryItem, GalleryFilters, GalleryPage, GenreSection } from '@/lib/types/database';

/**
 * Fetch public storylines for the landing page gallery (unchanged).
 */
export async function getPublicStorylines(limit: number = 6): Promise<GalleryStoryline[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('storylines')
    .select('id, title, cover_image_url, beat_count, author_name, story_id, created_at')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to fetch public storylines:', error.message);
    return [];
  }

  return data || [];
}

/**
 * Fetch top storylines grouped by genre for the genre showcase section.
 */
export async function getTopByGenre(): Promise<GenreSection[]> {
  const supabase = await createClient();

  // Fetch public storylines joined with their parent story for genre
  const { data: rows, error } = await supabase
    .from('storylines')
    .select('id, title, cover_image_url, beat_count, author_name, story_id, created_at, stories!inner(genre, story_config)')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !rows) {
    console.error('Failed to fetch top by genre:', error?.message);
    return [];
  }

  // Group by genre, pick top 4 per genre
  const genreMap = new Map<string, GalleryItem[]>();

  for (const row of rows as any[]) {
    const genre = row.stories?.genre || 'adventure';
    const genreKey = genre.toLowerCase();

    if (!genreMap.has(genreKey)) {
      genreMap.set(genreKey, []);
    }

    const items = genreMap.get(genreKey)!;
    if (items.length >= 4) continue;

    items.push({
      id: row.id,
      type: 'storyline',
      title: row.title,
      coverImageUrl: row.cover_image_url,
      authorName: row.author_name,
      storyId: row.story_id,
      beatCount: row.beat_count,
      genre: genreKey,
      ageGroup: row.stories?.story_config?.ageGroup || null,
      settingCountry: row.stories?.story_config?.settingCountry || null,
      createdAt: row.created_at,
    });
  }

  // Sort genres by item count desc, then alphabetically
  const sections: GenreSection[] = Array.from(genreMap.entries())
    .filter(([, items]) => items.length > 0)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([genre, items]) => ({
      genre: genre.charAt(0).toUpperCase() + genre.slice(1),
      items,
    }));

  return sections;
}

/**
 * Fetch gallery items with search, filters, and pagination.
 */
export async function getGalleryItems(
  filters: GalleryFilters,
  limit: number = 12,
  offset: number = 0
): Promise<GalleryPage> {
  const supabase = await createClient();

  const allItems: GalleryItem[] = [];

  // 1. Fetch storylines (when type is 'all' or 'storylines')
  if (filters.type !== 'trees') {
    let query = supabase
      .from('storylines')
      .select('id, title, cover_image_url, beat_count, author_name, story_id, created_at, stories!inner(genre, story_config)', { count: 'exact' })
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    if (filters.search) {
      query = query.ilike('title', `%${filters.search}%`);
    }
    if (filters.genre && filters.genre !== 'all') {
      query = query.ilike('stories.genre', filters.genre);
    }
    if (filters.ageGroup && filters.ageGroup !== 'all') {
      query = query.filter('stories.story_config->>ageGroup', 'eq', filters.ageGroup);
    }
    if (filters.country && filters.country !== 'all') {
      query = query.filter('stories.story_config->>settingCountry', 'eq', filters.country);
    }

    const { data: storylines } = await query;

    if (storylines) {
      for (const row of storylines as any[]) {
        allItems.push({
          id: row.id,
          type: 'storyline',
          title: row.title,
          coverImageUrl: row.cover_image_url,
          authorName: row.author_name,
          storyId: row.story_id,
          beatCount: row.beat_count,
          genre: row.stories?.genre || null,
          ageGroup: row.stories?.story_config?.ageGroup || null,
          settingCountry: row.stories?.story_config?.settingCountry || null,
          createdAt: row.created_at,
        });
      }
    }
  }

  // 2. Fetch story trees (when type is 'all' or 'trees')
  if (filters.type !== 'storylines') {
    // Get public storylines to find explorable story_ids + cover images
    const { data: publicStorylines } = await supabase
      .from('storylines')
      .select('story_id, cover_image_url, author_name, created_at')
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    if (publicStorylines && publicStorylines.length > 0) {
      // Deduplicate by story_id, keep most recent storyline's cover
      const storyCovers = new Map<string, { coverImageUrl: string | null; authorName: string | null; createdAt: string }>();
      for (const sl of publicStorylines) {
        if (sl.story_id && !storyCovers.has(sl.story_id)) {
          storyCovers.set(sl.story_id, {
            coverImageUrl: sl.cover_image_url,
            authorName: sl.author_name,
            createdAt: sl.created_at,
          });
        }
      }

      const storyIds = Array.from(storyCovers.keys());

      // Fetch the stories
      let storyQuery = supabase
        .from('stories')
        .select('id, title, user_prompt, genre, story_config, created_at')
        .in('id', storyIds)
        .eq('is_archived', false)
        .order('created_at', { ascending: false });

      if (filters.search) {
        storyQuery = storyQuery.or(`title.ilike.%${filters.search}%,user_prompt.ilike.%${filters.search}%`);
      }
      if (filters.genre && filters.genre !== 'all') {
        storyQuery = storyQuery.ilike('genre', filters.genre);
      }
      if (filters.ageGroup && filters.ageGroup !== 'all') {
        storyQuery = storyQuery.filter('story_config->>ageGroup', 'eq', filters.ageGroup);
      }
      if (filters.country && filters.country !== 'all') {
        storyQuery = storyQuery.filter('story_config->>settingCountry', 'eq', filters.country);
      }

      const { data: stories } = await storyQuery;

      if (stories) {
        for (const story of stories as any[]) {
          const cover = storyCovers.get(story.id);
          allItems.push({
            id: story.id,
            type: 'tree',
            title: story.title,
            coverImageUrl: cover?.coverImageUrl || null,
            authorName: cover?.authorName || null,
            storyId: story.id,
            beatCount: null,
            genre: story.genre || null,
            ageGroup: story.story_config?.ageGroup || null,
            settingCountry: story.story_config?.settingCountry || null,
            createdAt: cover?.createdAt || story.created_at,
          });
        }
      }
    }
  }

  // 3. Sort by createdAt desc
  allItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // 4. Paginate
  const total = allItems.length;
  const paginated = allItems.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  // 5. Fetch saved storyline IDs if authenticated
  let savedStorylineIds: string[] = [];
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: saved } = await supabase
        .from('saved_storylines')
        .select('storyline_id')
        .eq('user_id', user.id);
      savedStorylineIds = (saved || []).map((s: any) => s.storyline_id);
    }
  } catch {
    // Anonymous user, no saved IDs
  }

  return { items: paginated, total, hasMore, savedStorylineIds };
}
