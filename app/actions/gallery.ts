'use server';

import { createClient } from '@/lib/supabase/server';
import type { GalleryStoryline } from '@/lib/types/database';

/**
 * Fetch public storylines for the gallery.
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
