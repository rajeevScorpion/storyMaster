import { describe, expect, it } from 'vitest';

import { extractMediaObjectScopeCandidates } from './media-object-keys';

describe('extractMediaObjectScopeCandidates', () => {
  it('returns the story id for legacy beat keys', () => {
    expect(
      extractMediaObjectScopeCandidates('stories/story-1/beats/beat-1/audio.wav')
    ).toEqual(['story-1']);
  });

  it('returns the story segment first for media-pipeline keys', () => {
    expect(
      extractMediaObjectScopeCandidates('stories/user-1/story-1/media/group-1/display.webp')
    ).toEqual(['story-1', 'user-1']);
  });

  it('rejects keys outside the stories prefix', () => {
    expect(extractMediaObjectScopeCandidates('media-jobs/job-1/refs/0')).toEqual([]);
    expect(extractMediaObjectScopeCandidates('stories/')).toEqual([]);
  });
});
