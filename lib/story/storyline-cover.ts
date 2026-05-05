import 'server-only';

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { extractStoragePath } from '@/lib/supabase/storage';

type CoverBucket = 'public-storylines' | 'story-assets';

type StorylineCoverRow = {
  id: string;
  story_id: string;
  title: string;
  cover_image_url: string | null;
  is_vertical_story: boolean | null;
  aspect_ratio: string | null;
  node_path: string[] | null;
  beats: unknown;
  is_public: boolean;
};

type BeatImageRow = {
  image_url: string | null;
};

type StorylineBeatRow = {
  beat_id: string;
  position: number;
};

export type StorylineCoverSource = {
  storylineId: string;
  title: string;
  url: string;
  storageBucket: CoverBucket | null;
  storagePath: string | null;
  isVertical: boolean;
  version: string;
};

export type StorylineCoverMetadata = {
  title: string;
  isVertical: boolean;
  source: StorylineCoverSource | null;
};

function cleanUrl(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getStorageReference(url: string): Pick<StorylineCoverSource, 'storageBucket' | 'storagePath'> {
  const buckets: CoverBucket[] = ['public-storylines', 'story-assets'];

  for (const bucket of buckets) {
    const path = extractStoragePath(url, bucket);
    if (path) {
      return { storageBucket: bucket, storagePath: path };
    }
  }

  return { storageBucket: null, storagePath: null };
}

function createVersion(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 12);
}

function readLegacyCoverUrl(beats: unknown): string | null {
  if (!Array.isArray(beats)) return null;

  const coverBeat = beats[1] ?? beats[0];
  if (!coverBeat || typeof coverBeat !== 'object') return null;

  const data = coverBeat as { imageUrl?: unknown; image_url?: unknown };
  return cleanUrl(data.imageUrl) ?? cleanUrl(data.image_url);
}

function getCoverNodeId(nodePath: string[] | null): string | null {
  if (!Array.isArray(nodePath) || nodePath.length === 0) return null;
  return nodePath[1] ?? nodePath[0] ?? null;
}

async function getCurrentBeatCoverUrl(
  admin: SupabaseClient,
  storyId: string,
  nodePath: string[] | null
): Promise<string | null> {
  const coverNodeId = getCoverNodeId(nodePath);
  if (!coverNodeId) return null;

  const { data, error } = await admin
    .from('beats')
    .select('image_url')
    .eq('story_id', storyId)
    .eq('node_id', coverNodeId)
    .maybeSingle();

  if (error || !data) return null;
  return cleanUrl((data as BeatImageRow).image_url);
}

async function getJunctionCoverUrl(
  admin: SupabaseClient,
  storylineId: string
): Promise<string | null> {
  const { data: junctionRows, error: junctionError } = await admin
    .from('storyline_beats')
    .select('beat_id, position')
    .eq('storyline_id', storylineId)
    .in('position', [0, 1])
    .order('position', { ascending: false })
    .limit(1);

  if (junctionError || !junctionRows || junctionRows.length === 0) return null;

  const beatId = (junctionRows[0] as StorylineBeatRow).beat_id;
  if (!beatId) return null;

  const { data: beat, error: beatError } = await admin
    .from('beats')
    .select('image_url')
    .eq('id', beatId)
    .maybeSingle();

  if (beatError || !beat) return null;
  return cleanUrl((beat as BeatImageRow).image_url);
}

function toCoverSource(row: StorylineCoverRow, url: string): StorylineCoverSource {
  const storage = getStorageReference(url);

  return {
    storylineId: row.id,
    title: row.title,
    url,
    storageBucket: storage.storageBucket,
    storagePath: storage.storagePath,
    isVertical: row.is_vertical_story === true || row.aspect_ratio === '9:16',
    version: createVersion(url),
  };
}

export function getStorylineCoverImagePath(storylineId: string, version?: string): string {
  const base = `/storyline/${encodeURIComponent(storylineId)}/cover-image`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

export function getAbsoluteStorylineCoverImageUrl(
  storylineId: string,
  origin: string,
  version?: string
): string {
  return new URL(getStorylineCoverImagePath(storylineId, version), origin).toString();
}

export async function resolveStorylineCoverMetadata(
  storylineId: string
): Promise<StorylineCoverMetadata | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('storylines')
      .select('id, story_id, title, cover_image_url, is_vertical_story, aspect_ratio, node_path, beats, is_public')
      .eq('id', storylineId)
      .eq('is_public', true)
      .maybeSingle();

    if (error || !data) return null;

    const row = data as StorylineCoverRow;
    const url = cleanUrl(row.cover_image_url)
      ?? await getCurrentBeatCoverUrl(admin, row.story_id, row.node_path)
      ?? await getJunctionCoverUrl(admin, row.id)
      ?? readLegacyCoverUrl(row.beats);

    return {
      title: row.title,
      isVertical: row.is_vertical_story === true || row.aspect_ratio === '9:16',
      source: url ? toCoverSource(row, url) : null,
    };
  } catch (error) {
    console.error('Failed to resolve storyline cover metadata:', error);
    return null;
  }
}

export async function resolveStorylineCoverSource(
  storylineId: string
): Promise<StorylineCoverSource | null> {
  const metadata = await resolveStorylineCoverMetadata(storylineId);
  return metadata?.source ?? null;
}
