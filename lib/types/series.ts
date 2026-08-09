import type { GalleryEpisodeSummary } from '@/lib/types/database';

/**
 * Series shapes the public player consumes.
 *
 * Kept out of `app/actions/series.ts` because a `'use server'` module is only
 * allowed to export async functions.
 */

/** The episode queued up after the one being read. */
export interface NextEpisodeLink {
  storylineId: string;
  storyId: string;
  title: string;
  episodeNumber: number;
  beatCount: number | null;
}

/** Everything the player needs to present a storyline as an episode. */
export interface StorylineSeriesContext {
  seriesId: string;
  seriesTitle: string | null;
  episodeNumber: number;
  episodes: GalleryEpisodeSummary[];
  nextEpisode: NextEpisodeLink | null;
}
