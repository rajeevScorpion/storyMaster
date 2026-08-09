'use server';

import { createAnonClient } from '@/lib/supabase/server';
import { getMediaPipelineSettings } from '@/lib/media/processing-mode';
import { SERIES_EPISODE_LIST_LIMIT } from '@/lib/gallery/series';
import type { GalleryEpisodeSummary } from '@/lib/types/database';
import type { NextEpisodeLink, StorylineSeriesContext } from '@/lib/types/series';

/**
 * Public, sign-in-free reads of a published series.
 *
 * Deliberately separate from `app/actions/episodes.ts`, which serves the
 * authoring reader and cannot be reused here: it returns nothing to signed-out
 * callers, is keyed by story rather than storyline, hands back story ids where
 * the player needs storyline ids, and applies no visibility filter at all — it
 * would happily point a reader at an unpublished episode.
 *
 * Everything here reads `storylines` through the anonymous client, so RLS is
 * the floor and `is_public` plus the moderation gate are the ceiling.
 */

type EpisodeRow = {
  id: string;
  story_id: string;
  title: string;
  episode_number: number;
  beat_count: number | null;
  created_at: string;
};

const EPISODE_COLUMNS = 'id, story_id, title, episode_number, beat_count, created_at';

/**
 * Migration 093's columns are not in the generated database types, so a select
 * naming them narrows to `never`. Read through this shape instead.
 */
type SeriesPositionRow = {
  series_id?: string | null;
  series_title?: string | null;
  episode_number?: number | null;
};

async function moderationGateActive(): Promise<boolean> {
  try {
    return (await getMediaPipelineSettings()).moderationRequiredForPublic;
  } catch {
    return false;
  }
}

function isMissingSeriesColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    (error.code === '42703' || error.code === 'PGRST200' || error.code === 'PGRST204')
    && /series_id|series_title|episode_number/i.test(error.message ?? '')
  );
}

/**
 * Where a storyline sits in its series. Null for a standalone storyline, and
 * for any database that has not had migration 093 applied — series features go
 * quiet rather than erroring.
 */
async function readSeriesPosition(
  supabase: ReturnType<typeof createAnonClient>,
  storylineId: string
): Promise<{ seriesId: string; episodeNumber: number } | null> {
  const { data, error } = await supabase
    .from('storylines')
    .select('series_id, episode_number')
    .eq('id', storylineId)
    .maybeSingle();

  if (error) {
    if (!isMissingSeriesColumn(error)) {
      console.warn('Failed to read storyline series position:', error.message);
    }
    return null;
  }

  const row = data as SeriesPositionRow | null;
  const seriesId = row?.series_id ?? null;
  const episodeNumber = row?.episode_number ?? null;
  if (!seriesId || typeof episodeNumber !== 'number') return null;

  return { seriesId, episodeNumber };
}

/**
 * Every published episode of a series, in order.
 *
 * Duplicate episode numbers are expected — republishing a story creates a
 * second storyline row for it — so rows are ordered newest-first within an
 * episode and the first one per number wins.
 */
export async function getSeriesEpisodes(seriesId: string): Promise<GalleryEpisodeSummary[]> {
  if (!seriesId) return [];

  const supabase = createAnonClient();
  const gateActive = await moderationGateActive();

  let query = supabase
    .from('storylines')
    .select(EPISODE_COLUMNS)
    .eq('series_id', seriesId)
    .eq('is_public', true)
    .not('episode_number', 'is', null);

  if (gateActive) query = query.in('moderation_status', ['none', 'approved']);

  const { data, error } = await query
    .order('episode_number', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(SERIES_EPISODE_LIST_LIMIT * 3);

  if (error || !data) {
    if (error && !isMissingSeriesColumn(error)) {
      console.warn('Failed to fetch series episodes:', error.message);
    }
    return [];
  }

  const seen = new Set<number>();
  const episodes: GalleryEpisodeSummary[] = [];
  for (const row of data as EpisodeRow[]) {
    if (seen.has(row.episode_number)) continue;
    seen.add(row.episode_number);
    episodes.push({
      storylineId: row.id,
      storyId: row.story_id,
      title: row.title,
      episodeNumber: row.episode_number,
      beatCount: row.beat_count,
      createdAt: row.created_at,
      progress: null,
    });
    if (episodes.length >= SERIES_EPISODE_LIST_LIMIT) break;
  }

  return episodes;
}

/**
 * The episode to queue up after this one, or null at the end of a series.
 *
 * Takes the next episode that exists rather than `current + 1`: an author can
 * publish episode 3 without ever publishing 2, and a gap must not dead-end the
 * series. `is_public` and the moderation gate both apply, or the end-of-story
 * CTA would link somewhere the reader cannot go.
 */
export async function getNextEpisode(storylineId: string): Promise<NextEpisodeLink | null> {
  if (!storylineId) return null;

  const supabase = createAnonClient();
  const position = await readSeriesPosition(supabase, storylineId);
  if (!position) return null;

  const gateActive = await moderationGateActive();

  let query = supabase
    .from('storylines')
    .select(EPISODE_COLUMNS)
    .eq('series_id', position.seriesId)
    .eq('is_public', true)
    .gt('episode_number', position.episodeNumber);

  if (gateActive) query = query.in('moderation_status', ['none', 'approved']);

  const { data, error } = await query
    // Lowest episode above the current one; newest republish of it wins.
    .order('episode_number', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data?.length) {
    if (error) console.warn('Failed to fetch next episode:', error.message);
    return null;
  }

  const row = data[0] as EpisodeRow;
  return {
    storylineId: row.id,
    storyId: row.story_id,
    title: row.title,
    episodeNumber: row.episode_number,
    beatCount: row.beat_count,
  };
}

/**
 * Everything the player needs to present a storyline as an episode: its
 * position, the jump list for the header picker, and what comes next.
 *
 * Resolved server-side in one place so the end-of-story modal is instant —
 * a spinner at the emotional peak of a story is the wrong place to save a
 * query.
 */
export async function getStorylineSeriesContext(
  storylineId: string
): Promise<StorylineSeriesContext | null> {
  if (!storylineId) return null;

  const supabase = createAnonClient();

  const { data, error } = await supabase
    .from('storylines')
    .select('series_id, series_title, episode_number')
    .eq('id', storylineId)
    .maybeSingle();

  if (error || !data) {
    if (error && !isMissingSeriesColumn(error)) {
      console.warn('Failed to read storyline series context:', error.message);
    }
    return null;
  }

  const row = data as SeriesPositionRow;
  const seriesId = row.series_id ?? null;
  const episodeNumber = row.episode_number ?? null;
  if (!seriesId || typeof episodeNumber !== 'number') return null;

  const episodes = await getSeriesEpisodes(seriesId);
  // A branch with one published episode is not yet a series to a reader.
  if (episodes.length < 2) return null;

  const nextEpisode =
    episodes
      .filter((episode) => episode.episodeNumber > episodeNumber)
      .sort((a, b) => a.episodeNumber - b.episodeNumber)[0] ?? null;

  return {
    seriesId,
    seriesTitle: row.series_title ?? null,
    episodeNumber,
    episodes,
    nextEpisode: nextEpisode
      ? {
          storylineId: nextEpisode.storylineId,
          storyId: nextEpisode.storyId,
          title: nextEpisode.title,
          episodeNumber: nextEpisode.episodeNumber,
          beatCount: nextEpisode.beatCount,
        }
      : null,
  };
}
