'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractStoragePath } from '@/lib/supabase/storage';
import type { GalleryStoryline, GalleryItem, GalleryFilters, GalleryPage, GenreSection } from '@/lib/types/database';
import type { StoryAspectRatio } from '@/lib/types/story';

type LegacyGalleryBeat = {
  imageUrl?: string | null;
  image_url?: string | null;
  isStoryboard?: boolean | null;
  is_storyboard?: boolean | null;
  storyboardPlan?: unknown;
  storyboard_plan?: unknown;
  imagePrompt?: string | null;
  image_prompt?: string | null;
};

type StorylineGalleryRow = Omit<GalleryStoryline, 'cover_is_storyboard' | 'is_vertical_story' | 'aspect_ratio'> & {
  cover_is_storyboard?: boolean;
  is_vertical_story?: boolean | null;
  aspect_ratio?: string | null;
  node_path?: string[] | null;
  beats?: LegacyGalleryBeat[] | null;
  stories?: {
    genre?: string | null;
    story_config?: Record<string, unknown> | null;
    story_map?: Record<string, unknown> | null;
  } | null;
};

type StorylineCoverBeatRow = {
  storyline_id: string;
  beat_id: string;
  position: number;
};

type StoryboardFlagBeatRow = {
  id: string;
  is_storyboard: boolean | null;
};

type StoryMapFlagStoryRow = {
  id: string;
  story_map: Record<string, unknown> | null;
};

type BeatCoverImageRow = {
  story_id: string;
  node_id: string;
  image_url: string | null;
};

function readStoryConfigString(
  storyConfig: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  const value = storyConfig?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readStoryConfigBoolean(
  storyConfig: Record<string, unknown> | null | undefined,
  key: string
): boolean {
  return storyConfig?.[key] === true;
}

function resolveStoryAspectRatio(
  row: { is_vertical_story?: boolean | null; aspect_ratio?: string | null },
  storyConfig?: Record<string, unknown> | null
): StoryAspectRatio {
  if (
    row.is_vertical_story === true ||
    row.aspect_ratio === '9:16' ||
    readStoryConfigBoolean(storyConfig, 'isVerticalStory') ||
    readStoryConfigBoolean(storyConfig, 'is_vertical_story') ||
    readStoryConfigString(storyConfig, 'aspectRatio') === '9:16' ||
    readStoryConfigString(storyConfig, 'aspect_ratio') === '9:16'
  ) {
    return '9:16';
  }

  return '16:9';
}

function resolveIsVerticalStory(
  row: { is_vertical_story?: boolean | null; aspect_ratio?: string | null },
  storyConfig?: Record<string, unknown> | null
): boolean {
  return resolveStoryAspectRatio(row, storyConfig) === '9:16';
}

function mapStorylineRow(row: any): GalleryItem {
  const aspectRatio = resolveStoryAspectRatio(row, row.stories?.story_config);
  return {
    id: row.id,
    type: 'storyline',
    title: row.title,
    coverImageUrl: row.cover_image_url,
    coverIsStoryboard: row.cover_is_storyboard === true,
    isVerticalStory: resolveIsVerticalStory(row, row.stories?.story_config),
    aspectRatio,
    authorName: row.author_name,
    storyId: row.story_id ?? row.id,
    beatCount: row.beat_count,
    genre: row.stories?.genre || null,
    ageGroup: readStoryConfigString(row.stories?.story_config, 'ageGroup'),
    settingCountry: readStoryConfigString(row.stories?.story_config, 'settingCountry'),
    likeCount: row.like_count ?? 0,
    viewCount: row.view_count ?? 0,
    createdAt: row.created_at,
  };
}

function mapTreeRow(row: any): GalleryItem {
  const aspectRatio = resolveStoryAspectRatio(row, row.story_config);
  return {
    id: row.story_id,
    type: 'tree',
    title: row.title,
    coverImageUrl: row.cover_image_url,
    coverIsStoryboard: false,
    isVerticalStory: resolveIsVerticalStory(row, row.story_config),
    aspectRatio,
    authorName: row.author_name,
    storyId: row.story_id,
    beatCount: null,
    genre: row.genre || null,
    ageGroup: row.story_config?.ageGroup || null,
    settingCountry: readStoryConfigString(row.story_config as Record<string, unknown> | null | undefined, 'settingCountry'),
    likeCount: 0,
    viewCount: 0,
    createdAt: row.created_at,
  };
}

function getLegacyCoverBeat(row: StorylineGalleryRow): LegacyGalleryBeat | null {
  const beats = Array.isArray(row.beats) ? row.beats : [];
  return beats[1] ?? beats[0] ?? null;
}

function getLegacyCoverUrl(row: StorylineGalleryRow): string | null {
  const coverBeat = getLegacyCoverBeat(row);
  const imageUrl = coverBeat?.imageUrl ?? coverBeat?.image_url;

  return typeof imageUrl === 'string' && imageUrl.trim().length > 0
    ? imageUrl
    : null;
}

function getLegacyCoverIsStoryboard(row: StorylineGalleryRow): boolean {
  const coverBeat = getLegacyCoverBeat(row);
  const imagePrompt = coverBeat?.imagePrompt ?? coverBeat?.image_prompt;
  const promptLooksStoryboard = typeof imagePrompt === 'string'
    && /\b(storyboard|2x2|2×2|four-panel|panel grid)\b/i.test(imagePrompt);

  return coverBeat?.isStoryboard === true
    || coverBeat?.is_storyboard === true
    || !!coverBeat?.storyboardPlan
    || !!coverBeat?.storyboard_plan
    || promptLooksStoryboard;
}

function getPreferredStorylineCoverUrl(row: StorylineGalleryRow): string | null {
  if (row.cover_image_url && row.cover_image_url.trim().length > 0) {
    return row.cover_image_url;
  }

  return getLegacyCoverUrl(row);
}

function getStorylineCoverNodeId(row: StorylineGalleryRow): string | null {
  const nodePath = Array.isArray(row.node_path) ? row.node_path : [];
  return nodePath[1] ?? nodePath[0] ?? null;
}

async function resolveCurrentBeatCoverUrls<T extends StorylineGalleryRow>(
  rows: T[]
): Promise<T[]> {
  const targets = rows
    .map((row, index) => ({
      index,
      storyId: row.story_id,
      nodeId: getStorylineCoverNodeId(row),
      hasCover: Boolean(getPreferredStorylineCoverUrl(row)),
    }))
    .filter((target): target is { index: number; storyId: string; nodeId: string; hasCover: boolean } =>
      !target.hasCover
      && typeof target.storyId === 'string'
      && target.storyId.length > 0
      && typeof target.nodeId === 'string'
      && target.nodeId.length > 0
    );

  if (targets.length === 0) return rows;

  try {
    const admin = createAdminClient();
    const storyIds = Array.from(new Set(targets.map((target) => target.storyId)));
    const nodeIds = Array.from(new Set(targets.map((target) => target.nodeId)));
    const { data, error } = await admin
      .from('beats')
      .select('story_id, node_id, image_url')
      .in('story_id', storyIds)
      .in('node_id', nodeIds);

    if (error || !data) {
      console.error('Failed to fetch gallery current beat cover URLs:', error?.message);
      return rows;
    }

    const imageUrlByStoryAndNode = new Map<string, string>();
    for (const beat of data as BeatCoverImageRow[]) {
      if (beat.image_url && beat.image_url.trim().length > 0) {
        imageUrlByStoryAndNode.set(`${beat.story_id}:${beat.node_id}`, beat.image_url);
      }
    }

    if (imageUrlByStoryAndNode.size === 0) return rows;

    const nextRows = [...rows];
    for (const target of targets) {
      const imageUrl = imageUrlByStoryAndNode.get(`${target.storyId}:${target.nodeId}`);
      if (imageUrl) {
        nextRows[target.index] = {
          ...nextRows[target.index],
          cover_image_url: imageUrl,
        };
      }
    }

    return nextRows;
  } catch (error) {
    console.error('Failed to resolve gallery current beat cover URLs:', error);
    return rows;
  }
}

async function resolveNormalizedCoverStoryboardFlags<T extends StorylineGalleryRow & { cover_is_storyboard: boolean }>(
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const storylineIds = Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
  if (storylineIds.length === 0) return rows;

  try {
    const admin = createAdminClient();

    const { data: coverBeatRows, error: coverBeatError } = await admin
      .from('storyline_beats')
      .select('storyline_id, beat_id, position')
      .in('storyline_id', storylineIds)
      .in('position', [0, 1]);

    if (coverBeatError || !coverBeatRows) {
      console.error('Failed to fetch gallery cover storyboard flags:', coverBeatError?.message);
      return rows;
    }

    const beatIds = Array.from(new Set(
      (coverBeatRows as StorylineCoverBeatRow[])
        .map((row) => row.beat_id)
        .filter(Boolean)
    ));
    if (beatIds.length === 0) return rows;

    const { data: beatRows, error: beatError } = await admin
      .from('beats')
      .select('id, is_storyboard')
      .in('id', beatIds);

    if (beatError || !beatRows) {
      console.error('Failed to fetch gallery beat storyboard flags:', beatError?.message);
      return rows;
    }

    const storyboardByBeatId = new Map(
      (beatRows as StoryboardFlagBeatRow[]).map((beat) => [beat.id, beat.is_storyboard === true])
    );
    const coverFlagByStorylineId = new Map<string, { position: number; isStoryboard: boolean }>();

    for (const row of coverBeatRows as StorylineCoverBeatRow[]) {
      if (row.position !== 0 && row.position !== 1) continue;

      const isStoryboard = storyboardByBeatId.get(row.beat_id);
      if (typeof isStoryboard !== 'boolean') continue;

      const current = coverFlagByStorylineId.get(row.storyline_id);
      if (!current || row.position > current.position) {
        coverFlagByStorylineId.set(row.storyline_id, {
          position: row.position,
          isStoryboard,
        });
      }
    }

    if (coverFlagByStorylineId.size === 0) return rows;

    return rows.map((row) => {
      const coverFlag = coverFlagByStorylineId.get(row.id);
      return coverFlag
        ? { ...row, cover_is_storyboard: row.cover_is_storyboard || coverFlag.isStoryboard }
        : row;
    });
  } catch (error) {
    console.error('Failed to resolve gallery cover storyboard flags:', error);
    return rows;
  }
}

function readStoryMapCoverIsStoryboard(row: StorylineGalleryRow, storyMap: Record<string, unknown> | null | undefined): boolean {
  if (!storyMap || typeof storyMap !== 'object') return false;

  const nodes = (storyMap as { nodes?: Record<string, { data?: Record<string, unknown> }> }).nodes;
  if (!nodes) return false;

  const nodePath = Array.isArray(row.node_path) ? row.node_path : [];
  const coverNodeId = nodePath[1] ?? nodePath[0];
  const coverNodeData = coverNodeId ? nodes[coverNodeId]?.data : undefined;
  if (!coverNodeData) return false;

  return coverNodeData.isStoryboard === true
    || coverNodeData.is_storyboard === true
    || !!coverNodeData.storyboardPlan
    || !!coverNodeData.storyboard_plan;
}

async function resolveStoryMapCoverStoryboardFlags<T extends StorylineGalleryRow & { cover_is_storyboard: boolean }>(
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const rowsNeedingStoryMap = rows.filter((row) => !row.cover_is_storyboard);
  if (rowsNeedingStoryMap.length === 0) return rows;

  const embeddedFlags = new Map<string, boolean>();
  for (const row of rowsNeedingStoryMap) {
    if (readStoryMapCoverIsStoryboard(row, row.stories?.story_map)) {
      embeddedFlags.set(row.id, true);
    }
  }

  const storyIdsToFetch = Array.from(new Set(
    rowsNeedingStoryMap
      .filter((row) => !embeddedFlags.has(row.id))
      .map((row) => row.story_id)
      .filter((storyId): storyId is string => typeof storyId === 'string' && storyId.length > 0)
  ));

  let storyMapByStoryId = new Map<string, Record<string, unknown> | null>();

  if (storyIdsToFetch.length > 0) {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from('stories')
        .select('id, story_map')
        .in('id', storyIdsToFetch);

      if (error || !data) {
        console.error('Failed to fetch gallery story-map storyboard flags:', error?.message);
      } else {
        storyMapByStoryId = new Map(
          (data as StoryMapFlagStoryRow[]).map((story) => [story.id, story.story_map])
        );
      }
    } catch (error) {
      console.error('Failed to resolve gallery story-map storyboard flags:', error);
    }
  }

  return rows.map((row) => {
    const isStoryboard = row.cover_is_storyboard
      || embeddedFlags.get(row.id) === true
      || readStoryMapCoverIsStoryboard(row, row.story_id ? storyMapByStoryId.get(row.story_id) : null);

    return isStoryboard ? { ...row, cover_is_storyboard: true } : row;
  });
}

async function resolveStorylineCovers<T extends StorylineGalleryRow>(
  rows: T[]
): Promise<Array<T & { cover_is_storyboard: boolean }>> {
  if (rows.length === 0) return [];

  const rowsWithCurrentBeatCovers = await resolveCurrentBeatCoverUrls(rows);
  const resolvedWithFallbackFlags = rowsWithCurrentBeatCovers.map((row) => ({
    ...row,
    cover_image_url: getPreferredStorylineCoverUrl(row),
    cover_is_storyboard: getLegacyCoverIsStoryboard(row),
  }));
  const normalizedResolved = await resolveNormalizedCoverStoryboardFlags(resolvedWithFallbackFlags);
  const resolved = await resolveStoryMapCoverStoryboardFlags(normalizedResolved);

  const signTargets = resolved
    .map((row, index) => ({
      index,
      path: row.cover_image_url ? extractStoragePath(row.cover_image_url, 'story-assets') : null,
    }))
    .filter((entry): entry is { index: number; path: string } => !!entry.path);

  if (signTargets.length === 0) {
    return resolved;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from('story-assets')
      .createSignedUrls(signTargets.map((entry) => entry.path), 60 * 60 * 24);

    if (error || !data) {
      console.error('Failed to sign gallery cover URLs:', error?.message);
      return resolved;
    }

    const nextRows = [...resolved];
    signTargets.forEach((entry, index) => {
      const signedUrl = data[index]?.signedUrl;
      if (signedUrl) {
        nextRows[entry.index] = {
          ...nextRows[entry.index],
          cover_image_url: signedUrl,
        };
      }
    });

    return nextRows;
  } catch (error) {
    console.error('Failed to resolve gallery cover URLs:', error);
    return resolved;
  }
}

/**
 * Fetch public storylines for the landing page gallery.
 */
export async function getPublicStorylines(limit: number = 6): Promise<GalleryStoryline[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('storylines')
    .select('id, title, cover_image_url, beat_count, author_name, story_id, is_vertical_story, aspect_ratio, node_path, like_count, view_count, created_at, beats')
    .eq('is_public', true)
    .eq('is_vertical_story', false)
    .neq('aspect_ratio', '9:16')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to fetch public storylines:', error.message);
    return [];
  }

  const rows = await resolveStorylineCovers((data || []) as StorylineGalleryRow[]);
  return rows.map(({ beats, node_path, stories, ...storyline }) => {
    const aspectRatio = resolveStoryAspectRatio(storyline, stories?.story_config);
    return {
      ...storyline,
      is_vertical_story: aspectRatio === '9:16',
      aspect_ratio: aspectRatio,
    };
  });
}

/**
 * Fetch top storylines grouped by genre for the genre showcase section.
 */
export async function getTopByGenre(): Promise<GenreSection[]> {
  const supabase = await createClient();

  // Fetch public storylines joined with their parent story for genre
  const { data: rows, error } = await supabase
    .from('storylines')
    .select('id, title, cover_image_url, beat_count, author_name, story_id, is_vertical_story, aspect_ratio, node_path, like_count, view_count, created_at, beats, stories!inner(genre, story_config, story_map)')
    .eq('is_public', true)
    .eq('is_vertical_story', false)
    .neq('aspect_ratio', '9:16')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !rows) {
    console.error('Failed to fetch top by genre:', error?.message);
    return [];
  }

  const resolvedRows = await resolveStorylineCovers((rows || []) as StorylineGalleryRow[]);

  // Group by genre, pick top 4 per genre
  const genreMap = new Map<string, GalleryItem[]>();

  for (const row of resolvedRows) {
    const genre = row.stories?.genre || 'adventure';
    const genreKey = genre.toLowerCase();

    if (!genreMap.has(genreKey)) {
      genreMap.set(genreKey, []);
    }

    const items = genreMap.get(genreKey)!;
    if (items.length >= 4) continue;

    const aspectRatio = resolveStoryAspectRatio(row, row.stories?.story_config);
    items.push({
      id: row.id,
      type: 'storyline',
      title: row.title,
      coverImageUrl: row.cover_image_url,
      coverIsStoryboard: row.cover_is_storyboard,
      isVerticalStory: resolveIsVerticalStory(row, row.stories?.story_config),
      aspectRatio,
      authorName: row.author_name,
      storyId: row.story_id ?? row.id,
      beatCount: row.beat_count,
      genre: genreKey,
      ageGroup: readStoryConfigString(row.stories?.story_config, 'ageGroup'),
      settingCountry: readStoryConfigString(row.stories?.story_config, 'settingCountry'),
      likeCount: row.like_count ?? 0,
      viewCount: row.view_count ?? 0,
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

export async function getSavedStorylineIds(): Promise<string[]> {
  const supabase = await createClient();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return [];

    const { data, error } = await supabase
      .from('saved_storylines')
      .select('storyline_id')
      .eq('user_id', user.id);

    if (error) {
      console.error('Failed to fetch saved storyline IDs:', error.message);
      return [];
    }

    return (data || []).map((row: any) => row.storyline_id);
  } catch {
    return [];
  }
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
  const rangeEnd = offset + limit - 1;

  // 1. Fetch storylines
  if (filters.type === 'storylines') {
    let query = supabase
      .from('storylines')
      .select('id, title, cover_image_url, beat_count, author_name, story_id, is_vertical_story, aspect_ratio, node_path, like_count, view_count, created_at, beats, stories!inner(genre, story_config, story_map)', { count: 'exact' })
      .eq('is_public', true)
      .eq('is_vertical_story', false)
      .neq('aspect_ratio', '9:16')
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
    if (filters.language && filters.language !== 'all') {
      query = query.filter('stories.story_config->>language', 'eq', filters.language);
    }

    const { data: storylines, count, error } = await query.range(offset, rangeEnd);

    if (error) {
      throw new Error(`Failed to fetch storyline gallery items: ${error.message}`);
    }

    const resolvedRows = await resolveStorylineCovers((storylines || []) as StorylineGalleryRow[]);
    const items = resolvedRows.map(mapStorylineRow);
    const total = count ?? 0;

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  // 2. Fetch vertical/portrait storylines as their own gallery lane.
  if (filters.type === 'vertical') {
    let query = supabase
      .from('storylines')
      .select('id, title, cover_image_url, beat_count, author_name, story_id, is_vertical_story, aspect_ratio, node_path, like_count, view_count, created_at, beats, stories!inner(genre, story_config, story_map)', { count: 'exact' })
      .eq('is_public', true)
      .or('is_vertical_story.eq.true,aspect_ratio.eq.9:16')
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
    if (filters.language && filters.language !== 'all') {
      query = query.filter('stories.story_config->>language', 'eq', filters.language);
    }

    const { data: storylines, count, error } = await query.range(offset, rangeEnd);

    if (error) {
      throw new Error(`Failed to fetch vertical story gallery items: ${error.message}`);
    }

    const resolvedRows = await resolveStorylineCovers((storylines || []) as StorylineGalleryRow[]);
    const items = resolvedRows.map(mapStorylineRow);
    const total = count ?? 0;

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  // 3. Fetch story trees from a DB-backed gallery source
  let query = supabase
    .from('gallery_story_trees')
    .select('story_id, title, user_prompt, genre, story_config, cover_image_url, author_name, created_at, is_vertical_story, aspect_ratio', { count: 'exact' })
    .eq('is_vertical_story', false)
    .neq('aspect_ratio', '9:16')
    .order('created_at', { ascending: false });

  if (filters.search) {
    query = query.or(`title.ilike.%${filters.search}%,user_prompt.ilike.%${filters.search}%`);
  }
  if (filters.genre && filters.genre !== 'all') {
    query = query.ilike('genre', filters.genre);
  }
  if (filters.ageGroup && filters.ageGroup !== 'all') {
    query = query.filter('story_config->>ageGroup', 'eq', filters.ageGroup);
  }
  if (filters.country && filters.country !== 'all') {
    query = query.filter('story_config->>settingCountry', 'eq', filters.country);
  }
  if (filters.language && filters.language !== 'all') {
    query = query.filter('story_config->>language', 'eq', filters.language);
  }

  const { data: storyTrees, count, error } = await query.range(offset, rangeEnd);

  if (error) {
    throw new Error(`Failed to fetch story tree gallery items: ${error.message}`);
  }

  const items = (storyTrees || []).map(mapTreeRow);
  const total = count ?? 0;

  return {
    items,
    total,
    hasMore: offset + items.length < total,
  };
}
