import type { GalleryEpisodeSummary, GalleryItem } from '@/lib/types/database';

/**
 * Collapsing a published series into one catalogue entry.
 *
 * Episodes publish as ordinary, unrelated storylines — one `stories` row and
 * one `storylines` row each — so a four-episode series arrives from the
 * database as four near-identical cards with nothing to say which comes first.
 * Migration 093 stamps the grouping key onto each published storyline; this
 * module is what turns that key back into a series.
 *
 * Deliberately pure: no Supabase, no React. The rails call it after their
 * queries, the player shares `pickNextEpisode`, and every rule below is a unit
 * test rather than something you have to publish a series to observe.
 */

/** A series needs at least this many published episodes to be worth collapsing. */
export const SERIES_MIN_EPISODES = 2;

/**
 * How many episodes a jump list carries. A series at the ceiling renders as
 * "N+ Episodes" rather than claiming a count it did not finish counting.
 *
 * Lives here rather than beside the query that applies it because a `'use
 * server'` module may only export async functions.
 */
export const SERIES_EPISODE_LIST_LIMIT = 20;

/**
 * Membership requires both halves. A storyline carrying a branch id but no
 * episode number cannot be ordered against its siblings, so it stays standalone
 * rather than joining a series at an unknown position.
 */
export function seriesKeyOf(item: {
  seriesId: string | null;
  episodeNumber: number | null;
}): string | null {
  if (!item.seriesId) return null;
  if (typeof item.episodeNumber !== 'number') return null;
  return item.seriesId;
}

/**
 * Republishing a story creates a fresh storyline row for it, so the same
 * episode can appear twice in a series. Keep the first (rows arrive
 * newest-first) appearance of each story, or a series with two republishes
 * would advertise twice the episodes it has.
 */
export function dedupeEpisodesByStory<T extends { storyId: string; id: string }>(
  items: T[]
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const key = item.storyId || item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

/** Group items by series, preserving each group's incoming order. */
export function groupSeries(items: GalleryItem[]): Map<string, GalleryItem[]> {
  const groups = new Map<string, GalleryItem[]>();
  for (const item of items) {
    const key = seriesKeyOf(item);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

/**
 * The episode whose artwork, title and link stand for the whole series: the
 * lowest published episode number, oldest first on a tie.
 *
 * Not the newest. Dropping someone who has never seen the series into episode
 * five is the failure this exists to prevent — the rail sells the series, and
 * the way into a series is its beginning.
 */
export function pickSeriesRepresentative(episodes: GalleryItem[]): GalleryItem {
  return episodes.reduce((best, candidate) => {
    const bestNumber = best.episodeNumber ?? Number.POSITIVE_INFINITY;
    const candidateNumber = candidate.episodeNumber ?? Number.POSITIVE_INFINITY;
    if (candidateNumber !== bestNumber) return candidateNumber < bestNumber ? candidate : best;
    return candidate.createdAt < best.createdAt ? candidate : best;
  });
}

/**
 * The episode to resume or start on, given the viewer's progress across the
 * series: the furthest one they have started but not finished, else the first
 * one they have never touched, else the representative.
 */
export function pickResumeEpisode(episodes: GalleryEpisodeSummary[]): GalleryEpisodeSummary | null {
  if (episodes.length === 0) return null;

  const ordered = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);

  const inProgress = [...ordered]
    .reverse()
    .find((episode) => episode.progress && !episode.progress.completed && episode.progress.beatIndex >= 1);
  if (inProgress) return inProgress;

  const unwatched = ordered.find((episode) => !episode.progress?.completed);
  return unwatched ?? ordered[0];
}

/**
 * The next episode after `currentEpisodeNumber`.
 *
 * Takes the next one that exists rather than `current + 1`: an author can
 * publish episode 3 without ever publishing episode 2, and a series with a gap
 * must still play through instead of dead-ending on the missing number.
 */
export function pickNextEpisode<T extends { episodeNumber: number }>(
  episodes: T[],
  currentEpisodeNumber: number | null
): T | null {
  if (typeof currentEpisodeNumber !== 'number') return null;
  return (
    [...episodes]
      .filter((episode) => episode.episodeNumber > currentEpisodeNumber)
      .sort((a, b) => a.episodeNumber - b.episodeNumber)[0] ?? null
  );
}

/**
 * Replace each series' episodes with a single card.
 *
 * The collapsed card takes the representative's artwork but keeps the position
 * of the group's *first* member in the incoming order. Rails arrive
 * newest-first, so publishing episode four resurfaces the series in "New" while
 * the card still opens at episode one.
 *
 * Series with only one published episode are left exactly as they were — a
 * series nobody has continued yet is just a story.
 */
export function collapseSeries(
  items: GalleryItem[],
  episodesBySeriesId: Map<string, GalleryEpisodeSummary[]>
): GalleryItem[] {
  const groups = groupSeries(items);
  if (groups.size === 0) return items;

  const emitted = new Set<string>();
  const collapsed: GalleryItem[] = [];

  for (const item of items) {
    const key = seriesKeyOf(item);
    if (!key) {
      collapsed.push(item);
      continue;
    }

    if (emitted.has(key)) continue;
    emitted.add(key);

    const members = dedupeEpisodesByStory(groups.get(key) ?? []);
    // The pool query knows about episodes outside this rail's slice, so it is
    // the authority on how many there are; the rail's own members are the
    // fallback when it returned nothing.
    const episodes = episodesBySeriesId.get(key) ?? [];
    const episodeCount = Math.max(episodes.length, members.length);

    if (episodeCount < SERIES_MIN_EPISODES) {
      collapsed.push(item);
      continue;
    }

    const representative = pickSeriesRepresentative(members);
    const resume = pickResumeEpisode(episodes);

    collapsed.push({
      ...representative,
      // Open where the viewer left the series, not where the artwork starts.
      id: resume?.storylineId ?? representative.id,
      storyId: resume?.storyId ?? representative.storyId,
      beatCount: resume?.beatCount ?? representative.beatCount,
      progress: resume?.progress ?? representative.progress,
      episodeNumber: resume?.episodeNumber ?? representative.episodeNumber,
      title: representative.seriesTitle?.trim() || representative.title,
      seriesTitle: representative.seriesTitle?.trim() || representative.title,
      episodeCount,
      episodes: episodes.length > 0 ? episodes : null,
    });
  }

  return collapsed;
}
