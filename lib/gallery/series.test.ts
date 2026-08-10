import { describe, expect, it } from 'vitest';
import {
  collapseSeries,
  dedupeEpisodesByStory,
  pickNextEpisode,
  pickResumeEpisode,
  pickSeriesRepresentative,
  seriesKeyOf,
} from './series';
import type { GalleryEpisodeSummary, GalleryItem } from '@/lib/types/database';

function item(overrides: Partial<GalleryItem> & { id: string; storyId: string }): GalleryItem {
  return {
    type: 'storyline',
    title: `Story ${overrides.id}`,
    coverImageUrl: null,
    coverIsStoryboard: false,
    openingImageUrl: null,
    isVerticalStory: false,
    aspectRatio: '16:9',
    authorName: 'Anonymous',
    beatCount: 4,
    intro: null,
    genre: null,
    ageGroup: null,
    settingCountry: null,
    likeCount: 0,
    viewCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    progress: null,
    seriesId: null,
    seriesTitle: null,
    episodeNumber: null,
    episodeCount: null,
    episodes: null,
    ...overrides,
  };
}

function episode(
  overrides: Partial<GalleryEpisodeSummary> & { storylineId: string; episodeNumber: number }
): GalleryEpisodeSummary {
  return {
    storyId: `story-${overrides.storylineId}`,
    title: `Episode ${overrides.episodeNumber}`,
    beatCount: 4,
    createdAt: '2026-01-01T00:00:00Z',
    progress: null,
    ...overrides,
  };
}

describe('seriesKeyOf', () => {
  it('ignores a branch id with no episode number', () => {
    // Unorderable against its siblings, so it stays standalone rather than
    // joining the series at an unknown position.
    expect(seriesKeyOf({ seriesId: 'branch-1', episodeNumber: null })).toBeNull();
  });

  it('ignores an episode number with no branch', () => {
    expect(seriesKeyOf({ seriesId: null, episodeNumber: 2 })).toBeNull();
  });

  it('accepts a complete pair', () => {
    expect(seriesKeyOf({ seriesId: 'branch-1', episodeNumber: 1 })).toBe('branch-1');
  });
});

describe('pickSeriesRepresentative', () => {
  it('picks the lowest episode number, not the newest', () => {
    const chosen = pickSeriesRepresentative([
      item({ id: 'c', storyId: 's3', episodeNumber: 3, createdAt: '2026-03-01T00:00:00Z' }),
      item({ id: 'a', storyId: 's1', episodeNumber: 1, createdAt: '2026-01-01T00:00:00Z' }),
      item({ id: 'b', storyId: 's2', episodeNumber: 2, createdAt: '2026-02-01T00:00:00Z' }),
    ]);

    expect(chosen.id).toBe('a');
  });

  it('breaks a tie on episode number by the oldest row', () => {
    const chosen = pickSeriesRepresentative([
      item({ id: 'new', storyId: 's1', episodeNumber: 1, createdAt: '2026-05-01T00:00:00Z' }),
      item({ id: 'old', storyId: 's2', episodeNumber: 1, createdAt: '2026-01-01T00:00:00Z' }),
    ]);

    expect(chosen.id).toBe('old');
  });
});

describe('dedupeEpisodesByStory', () => {
  it('keeps the first row per story, so a republish is not a second episode', () => {
    const deduped = dedupeEpisodesByStory([
      { id: 'fresh', storyId: 'story-1' },
      { id: 'stale', storyId: 'story-1' },
      { id: 'other', storyId: 'story-2' },
    ]);

    expect(deduped.map((row) => row.id)).toEqual(['fresh', 'other']);
  });
});

describe('pickNextEpisode', () => {
  const episodes = [episode({ storylineId: 'e1', episodeNumber: 1 }), episode({ storylineId: 'e3', episodeNumber: 3 })];

  it('skips a gap rather than dead-ending on a missing number', () => {
    expect(pickNextEpisode(episodes, 1)?.storylineId).toBe('e3');
  });

  it('returns null at the end of the series', () => {
    expect(pickNextEpisode(episodes, 3)).toBeNull();
  });

  it('returns null when the current episode number is unknown', () => {
    expect(pickNextEpisode(episodes, null)).toBeNull();
  });
});

describe('pickResumeEpisode', () => {
  it('resumes the furthest started-but-unfinished episode', () => {
    const chosen = pickResumeEpisode([
      episode({ storylineId: 'e1', episodeNumber: 1, progress: { beatIndex: 3, beatCount: 4, completed: true } }),
      episode({ storylineId: 'e2', episodeNumber: 2, progress: { beatIndex: 2, beatCount: 5, completed: false } }),
      episode({ storylineId: 'e3', episodeNumber: 3 }),
    ]);

    expect(chosen?.storylineId).toBe('e2');
  });

  it('falls through to the first unwatched episode', () => {
    const chosen = pickResumeEpisode([
      episode({ storylineId: 'e1', episodeNumber: 1, progress: { beatIndex: 3, beatCount: 4, completed: true } }),
      episode({ storylineId: 'e2', episodeNumber: 2 }),
    ]);

    expect(chosen?.storylineId).toBe('e2');
  });

  it('returns the first episode once the whole series is watched', () => {
    const watched = { beatIndex: 3, beatCount: 4, completed: true };
    const chosen = pickResumeEpisode([
      episode({ storylineId: 'e2', episodeNumber: 2, progress: watched }),
      episode({ storylineId: 'e1', episodeNumber: 1, progress: watched }),
    ]);

    expect(chosen?.storylineId).toBe('e1');
  });
});

describe('collapseSeries', () => {
  const seriesEpisodes = [
    episode({ storylineId: 'a', episodeNumber: 1 }),
    episode({ storylineId: 'b', episodeNumber: 2 }),
  ];
  const episodesBySeriesId = new Map([['branch-1', seriesEpisodes]]);

  const members = [
    item({ id: 'b', storyId: 's2', seriesId: 'branch-1', seriesTitle: 'The Robot', episodeNumber: 2, createdAt: '2026-02-01T00:00:00Z' }),
    item({ id: 'a', storyId: 's1', seriesId: 'branch-1', seriesTitle: 'The Robot', episodeNumber: 1, createdAt: '2026-01-01T00:00:00Z' }),
  ];

  it('replaces a series with one card carrying the series title and count', () => {
    const collapsed = collapseSeries(members, episodesBySeriesId);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].title).toBe('The Robot');
    expect(collapsed[0].episodeCount).toBe(2);
    expect(collapsed[0].episodes).toHaveLength(2);
  });

  it('keeps the position of the newest member so a new episode resurfaces the series', () => {
    const collapsed = collapseSeries(
      [item({ id: 'z', storyId: 'sz' }), ...members],
      episodesBySeriesId
    );

    // Standalone card came first in the incoming order and stays first; the
    // series takes the slot of its newest member, which was second.
    expect(collapsed.map((entry) => entry.id)).toEqual(['z', 'a']);
  });

  it('opens at episode one when the viewer has never watched the series', () => {
    expect(collapseSeries(members, episodesBySeriesId)[0].id).toBe('a');
  });

  it('opens where the viewer stopped rather than at episode one', () => {
    const withProgress = new Map([
      [
        'branch-1',
        [
          episode({
            storylineId: 'a',
            episodeNumber: 1,
            progress: { beatIndex: 3, beatCount: 4, completed: true },
          }),
          episode({
            storylineId: 'b',
            episodeNumber: 2,
            progress: { beatIndex: 1, beatCount: 5, completed: false },
          }),
        ],
      ],
    ]);

    const collapsed = collapseSeries(members, withProgress);
    expect(collapsed[0].id).toBe('b');
    expect(collapsed[0].episodeNumber).toBe(2);
  });

  it('leaves a one-episode series alone — it is just a story', () => {
    const single = [item({ id: 'a', storyId: 's1', seriesId: 'branch-2', episodeNumber: 1 })];
    const collapsed = collapseSeries(single, new Map([['branch-2', [episode({ storylineId: 'a', episodeNumber: 1 })]]]));

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].episodeCount).toBeNull();
    expect(collapsed[0].title).toBe('Story a');
  });

  it('does not count a republished episode twice', () => {
    const republished = [
      item({ id: 'a2', storyId: 's1', seriesId: 'branch-3', seriesTitle: 'S', episodeNumber: 1, createdAt: '2026-03-01T00:00:00Z' }),
      item({ id: 'a1', storyId: 's1', seriesId: 'branch-3', seriesTitle: 'S', episodeNumber: 1, createdAt: '2026-01-01T00:00:00Z' }),
      item({ id: 'b1', storyId: 's2', seriesId: 'branch-3', seriesTitle: 'S', episodeNumber: 2, createdAt: '2026-02-01T00:00:00Z' }),
    ];

    // Two stories, three storylines: the pool query is the authority and
    // reports two, and the members must not inflate that to three.
    const collapsed = collapseSeries(republished, new Map());
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].episodeCount).toBe(2);
  });

  it('leaves items with no series membership untouched', () => {
    const standalone = [item({ id: 'x', storyId: 'sx' }), item({ id: 'y', storyId: 'sy' })];
    expect(collapseSeries(standalone, new Map())).toEqual(standalone);
  });

  it('is a no-op on a Continue Watching list, which must keep the exact episode', () => {
    // Encoded as a test so a later refactor cannot quietly start collapsing the
    // one rail where the viewer already told us which episode they meant.
    const continueList = [
      item({ id: 'b', storyId: 's2', seriesId: 'branch-1', seriesTitle: 'The Robot', episodeNumber: 2 }),
    ];

    expect(continueList.map((entry) => entry.id)).toEqual(['b']);
  });
});
