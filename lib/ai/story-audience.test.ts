import { describe, expect, it } from 'vitest';

import {
  KIDS_AGE_GROUPS,
  STORY_AUDIENCE_OPTIONS,
  assessStoryBeatLength,
  countStoryWords,
  formatAudienceBranchingContract,
  formatAudienceImageDirection,
  formatAudienceNarrationDirection,
  formatAudienceNarrativeContract,
  formatAudienceVisualContract,
  getStoryAudienceProfile,
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

  it('formats a single-line audience image direction invariant', () => {
    const profile = getStoryAudienceProfile('teens');
    const line = formatAudienceImageDirection('teens');
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toBe(`Audience (${profile.label}): ${profile.visualDirection}`);
  });
});

describe('resolveStoryBeatLength — band and proportional allowance', () => {
  const cases: Array<{
    ageGroup: string;
    level: number;
    targetWords: number;
    band: [number, number];
    allowance: [number, number];
  }> = [
    { ageGroup: 'kids_3_5', level: 1, targetWords: 28, band: [24, 32], allowance: [20, 36] },
    { ageGroup: 'all_ages', level: 3, targetWords: 84, band: [74, 94], allowance: [61, 107] },
    { ageGroup: 'teens', level: 1, targetWords: 64, band: [56, 72], allowance: [46, 82] },
    { ageGroup: 'teens', level: 3, targetWords: 108, band: [95, 121], allowance: [79, 137] },
    { ageGroup: 'teens', level: 4, targetWords: 130, band: [114, 146], allowance: [94, 166] },
    { ageGroup: 'teens', level: 5, targetWords: 152, band: [134, 170], allowance: [111, 193] },
    { ageGroup: 'adults', level: 5, targetWords: 176, band: [155, 197], allowance: [129, 223] },
  ];

  cases.forEach(({ ageGroup, level, targetWords, band, allowance }) => {
    it(`${ageGroup} level ${level}: target ${targetWords}, band ${band.join('-')}, allowance ${allowance.join('-')}`, () => {
      const length = resolveStoryBeatLength(ageGroup, level);
      expect(length.targetWords).toBe(targetWords);
      expect([length.targetMinWords, length.targetMaxWords]).toEqual(band);
      expect([length.allowanceMinWords, length.allowanceMaxWords]).toEqual(allowance);
    });
  });

  it('no longer clamps the band to the hard min/max at Brief and Immersive', () => {
    // Teens Immersive used to clamp targetMaxWords to hardMaxWords (152); it is
    // now the unclamped target+tolerance (170).
    const length = resolveStoryBeatLength('teens', 5);
    expect(length.hardMaxWords).toBe(152);
    expect(length.targetMaxWords).toBe(170);
  });
});

describe('formatAudienceNarrativeContract', () => {
  it('tells the model the band and drops the old absolute-range wording', () => {
    const contract = formatAudienceNarrativeContract('teens', 4);
    expect(contract).toContain('114-146');
    expect(contract).toContain('about 130');
    expect(contract).toContain('about 33 words');
    expect(contract).not.toContain('absolute');
  });
});

describe('assessStoryBeatLength', () => {
  const length = resolveStoryBeatLength('teens', 4); // target 130, band 114-146, allowance 94-166

  function wordsOfLength(count: number): string {
    return Array.from({ length: count }, (_, index) => `word${index}`).join(' ');
  }

  it('is within allowance and carries no note for a beat inside the band', () => {
    const assessment = assessStoryBeatLength(wordsOfLength(130), length);
    expect(assessment.wordCount).toBe(130);
    expect(assessment.withinAllowance).toBe(true);
    expect(assessment.note).toBeNull();
  });

  it('flags an over-length beat outside the allowance with a "cut about" note', () => {
    const assessment = assessStoryBeatLength(wordsOfLength(200), length);
    expect(assessment.withinAllowance).toBe(false);
    expect(assessment.note).toContain('cut about');
  });

  it('flags an under-length beat outside the allowance with an "add about" note', () => {
    const assessment = assessStoryBeatLength(wordsOfLength(50), length);
    expect(assessment.withinAllowance).toBe(false);
    expect(assessment.note).toContain('add about');
  });
});
