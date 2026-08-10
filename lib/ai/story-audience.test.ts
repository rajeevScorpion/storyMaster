import { describe, expect, it } from 'vitest';

import {
  KIDS_AGE_GROUPS,
  STORY_AUDIENCE_OPTIONS,
  countStoryWords,
  formatAudienceBranchingContract,
  formatAudienceNarrationDirection,
  formatAudienceVisualContract,
  normalizeAgeGroup,
  normalizeStoredAgeGroup,
  normalizeStoryBeatLengthLevel,
  resolveStoryBeatLength,
} from './story-audience';

describe('story audience profiles', () => {
  it('exposes the reader-facing age labels without changing persisted keys', () => {
    expect(STORY_AUDIENCE_OPTIONS).toEqual([
      { value: 'all_ages', label: 'All Ages' },
      { value: 'kids_3_5', label: 'Preschool (3–5)' },
      { value: 'kids_5_8', label: 'Early Readers (6–8)' },
      { value: 'kids_8_12', label: 'Middle Grade (9–12)' },
      { value: 'teens', label: 'Teens (13–17)' },
      { value: 'adults', label: 'Adults (18+)' },
    ]);
  });

  it('maps one semantic level to age-appropriate word targets', () => {
    expect(resolveStoryBeatLength('kids_3_5', 3).targetWords).toBe(44);
    expect(resolveStoryBeatLength('kids_8_12', 3).targetWords).toBe(88);
    expect(resolveStoryBeatLength('adults', 3).targetWords).toBe(124);
  });

  it('caps invalid levels to the supported slider range', () => {
    expect(normalizeStoryBeatLengthLevel(-3)).toBe(1);
    expect(normalizeStoryBeatLengthLevel(100)).toBe(5);
    expect(normalizeStoryBeatLengthLevel('not-a-level')).toBe(3);
  });

  it('falls back safely for non-profile object property names', () => {
    expect(resolveStoryBeatLength('toString', 3).targetWords).toBe(84);
  });

  it('counts both whitespace-delimited and unspaced scripts', () => {
    expect(countStoryWords('one two three')).toBe(3);
    expect(countStoryWords('物語が始まる')).toBeGreaterThan(1);
  });

  it('keeps unknown audiences unclassified on the storage path', () => {
    // normalizeAgeGroup defaults to all_ages for prompting, which must never
    // leak into persisted classification.
    expect(normalizeAgeGroup(undefined)).toBe('all_ages');
    expect(normalizeStoredAgeGroup(undefined)).toBeNull();
    expect(normalizeStoredAgeGroup('')).toBeNull();
    expect(normalizeStoredAgeGroup('toddlers')).toBeNull();
    expect(normalizeStoredAgeGroup('toString')).toBeNull();
    expect(normalizeStoredAgeGroup('kids_5_8')).toBe('kids_5_8');
  });

  it('limits the kids band to explicitly classified young audiences', () => {
    expect(KIDS_AGE_GROUPS).toEqual(['kids_3_5', 'kids_5_8']);
    // all_ages is the historical default for unclassified stories, so it is
    // not a trustworthy child-safety signal.
    expect(KIDS_AGE_GROUPS).not.toContain('all_ages');
    expect(KIDS_AGE_GROUPS).not.toContain('kids_8_12');
  });

  it('keeps higher-age choices playable and visual direction open-ended', () => {
    expect(formatAudienceBranchingContract('adults')).toContain('legitimate competing values');
    expect(formatAudienceBranchingContract('teens')).toContain('something a character says');
    expect(formatAudienceVisualContract('adults')).toContain('must not dictate a fixed palette');
    expect(formatAudienceNarrationDirection('kids_3_5')).toContain('Never use baby talk');
  });
});
