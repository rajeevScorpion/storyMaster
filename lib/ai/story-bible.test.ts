import { describe, expect, it } from 'vitest';
import { formatNarrativeStoryBible, formatStoryBible, validateGeneratedBeat } from './story-bible';
import type { Character, StoryBeat, StorySession } from '@/lib/types/story';
import { normalizeStoryConfig } from './story-config';

function makeCharacter(name: string, overrides: Partial<Character> = {}): Character {
  return {
    id: `char-${name.toLowerCase()}`,
    name,
    type: 'protagonist',
    appearanceSummary: `${name} appearance`,
    personalitySummary: `${name} personality`,
    ...overrides,
  };
}

function makeValidBeat(overrides: Partial<StoryBeat> = {}): StoryBeat {
  const words = ['A', 'story', 'begins', ...Array.from({ length: 81 }, (_, index) => `moment${index + 1}`)];
  const storyText = words.join(' ');
  return {
    title: 'Beat 1',
    beatNumber: 1,
    isEnding: false,
    storyText,
    storyTextParts: [
      words.slice(0, 21).join(' '),
      words.slice(21, 42).join(' '),
      words.slice(42, 63).join(' '),
      words.slice(63).join(' '),
    ],
    sceneSummary: 'The opening scene.',
    options: [
      { id: 'opt-1', label: 'Go left', intent: 'explore' },
      { id: 'opt-2', label: 'Go right', intent: 'risk' },
      { id: 'opt-3', label: 'Wait', intent: 'caution' },
    ],
    characters: [makeCharacter('Milo')],
    continuityNotes: [],
    imagePrompt: 'wide establishing shot of the orchard',
    clues: [],
    nextBeatGoal: 'Reveal the keeper.',
    endingForecast: ['discovery'],
    newCharacterIds: ['char-milo'],
    changedCharacterIds: [],
    ...overrides,
  };
}

describe('validateGeneratedBeat — beat 1 with a pre-seeded roster (Pack 2)', () => {
  const seededSession: Partial<StorySession> = {
    currentBeat: 0,
    maxBeats: 6,
    beats: [],
    characters: [makeCharacter('Milo', { portraitUrl: 'https://assets/milo.webp', masterId: 'm1' })],
  };

  it('does not demand seeded characters be flagged as new on beat 1', () => {
    const beat = makeValidBeat({ newCharacterIds: [] });
    const issues = validateGeneratedBeat(beat, seededSession);
    expect(issues.filter((issue) => issue.includes('beat 1 must flag'))).toEqual([]);
  });

  it('still rejects flagging a seeded character as new', () => {
    const beat = makeValidBeat({ newCharacterIds: ['char-milo'] });
    const issues = validateGeneratedBeat(beat, seededSession);
    expect(issues.some((issue) => issue.includes('includes existing character id'))).toBe(true);
  });

  it('still demands genuinely new characters be flagged on beat 1', () => {
    const beat = makeValidBeat({
      characters: [makeCharacter('Milo'), makeCharacter('Nia')],
      newCharacterIds: [],
    });
    const issues = validateGeneratedBeat(beat, seededSession);
    const flagIssues = issues.filter((issue) => issue.includes('beat 1 must flag'));
    expect(flagIssues).toHaveLength(1);
    expect(flagIssues[0]).toContain('char-nia');
    expect(flagIssues[0]).not.toContain('char-milo');
  });
});

describe('formatNarrativeStoryBible', () => {
  it('omits visual direction and prior image prompt excerpts from writer context', () => {
    const beat = makeValidBeat({ imagePrompt: 'A visual-only palette and rendering direction.' });
    const narrative = JSON.parse(formatNarrativeStoryBible({
      currentBeat: 1,
      maxBeats: 6,
      visualStyle: 'Rendering and palette instructions that must remain visual-only.',
      beats: [beat],
      characters: beat.characters,
    }));

    expect(narrative.visualDirection).toBeUndefined();
    expect(narrative.recentBeats[0].imagePromptExcerpt).toBeUndefined();
    expect(narrative.recentBeats[0].storyTextExcerpt).toContain('A story begins');
  });

  it('keeps the latest consequence and compact head-tail context from earlier beats', () => {
    const earlier = makeValidBeat({
      storyText: `EARLIER OPEN ${'middle '.repeat(120)} EARLIER CONSEQUENCE`,
    });
    const latest = makeValidBeat({
      beatNumber: 2,
      storyText: `LATEST OPEN ${'detail '.repeat(100)} LATEST CONSEQUENCE`,
      newCharacterIds: [],
    });
    const narrative = JSON.parse(formatNarrativeStoryBible({
      currentBeat: 2,
      beats: [earlier, latest],
      characters: latest.characters,
    }));

    expect(narrative.recentBeats[0].storyTextExcerpt).toContain('EARLIER OPEN');
    expect(narrative.recentBeats[0].storyTextExcerpt).toContain('EARLIER CONSEQUENCE');
    expect(narrative.recentBeats[0].storyTextExcerpt.length).toBeLessThanOrEqual(360);
    expect(narrative.recentBeats[1].storyTextExcerpt).toContain('LATEST CONSEQUENCE');
  });
});

describe('validateGeneratedBeat — placeholder-named reference seed (Reference Personalization)', () => {
  const seededSession: Partial<StorySession> = {
    currentBeat: 0,
    maxBeats: 6,
    beats: [],
    characters: [
      makeCharacter('Character 1', {
        id: 'ref_abc',
        referenceSheetUrl: 'https://assets/ref_abc.webp',
        nameIsPlaceholder: true,
      }),
    ],
  };

  it('allows the LLM to name a placeholder reference on beat 1 (id preserved)', () => {
    const beat = makeValidBeat({
      characters: [makeCharacter('मलिक', { id: 'ref_abc' })],
      newCharacterIds: [],
    });
    const issues = validateGeneratedBeat(beat, seededSession);
    expect(issues.some((issue) => issue.includes('was renamed'))).toBe(false);
  });

  it('still locks the name once the placeholder flag is cleared', () => {
    const namedSession: Partial<StorySession> = {
      currentBeat: 1,
      maxBeats: 6,
      beats: [],
      characters: [makeCharacter('मलिक', { id: 'ref_abc', nameIsPlaceholder: false })],
    };
    const beat = makeValidBeat({
      beatNumber: 2,
      characters: [makeCharacter('Someone Else', { id: 'ref_abc' })],
      newCharacterIds: [],
    });
    const issues = validateGeneratedBeat(beat, namedSession);
    expect(issues.some((issue) => issue.includes('was renamed'))).toBe(true);
  });
});

describe('validateGeneratedBeat — legacy beat 1 (no seeded roster)', () => {
  const legacySession: Partial<StorySession> = {
    currentBeat: 0,
    maxBeats: 6,
    beats: [],
    characters: [],
  };

  it('requires all named beat-1 characters in newCharacterIds', () => {
    const beat = makeValidBeat({ newCharacterIds: [] });
    const issues = validateGeneratedBeat(beat, legacySession);
    expect(issues.some((issue) => issue.includes('beat 1 must flag'))).toBe(true);
  });

  it('accepts a fully flagged beat 1', () => {
    const issues = validateGeneratedBeat(makeValidBeat(), legacySession);
    expect(issues).toEqual([]);
  });
});

describe('formatStoryBible — series context injection (Pack 2)', () => {
  const baseSession: Partial<StorySession> = {
    currentBeat: 0,
    maxBeats: 6,
    beats: [],
    characters: [],
  };

  it('includes seriesBible, seriesJournal, and episodeNumber when present', () => {
    const bible = JSON.parse(
      formatStoryBible({
        ...baseSession,
        episodeContext: {
          branchId: 'branch-1',
          episodeNumber: 2,
          bibleText: 'WORLD\nThe orchard is magic.',
          journalSummary: 'Episode 1: Pip found the lanterns.',
        },
      })
    );
    expect(bible.episodeNumber).toBe(2);
    expect(bible.seriesBible).toContain('The orchard is magic.');
    expect(bible.seriesJournal).toContain('Pip found the lanterns.');
  });

  it('omits series fields for stories outside an episode branch', () => {
    const bible = JSON.parse(formatStoryBible(baseSession));
    expect(bible.episodeNumber).toBeUndefined();
    expect(bible.seriesBible).toBeUndefined();
    expect(bible.seriesJournal).toBeUndefined();
  });

  it('truncates an oversized bible snapshot', () => {
    const bible = JSON.parse(
      formatStoryBible({
        ...baseSession,
        episodeContext: {
          branchId: 'branch-1',
          episodeNumber: 2,
          bibleText: 'x'.repeat(5000),
        },
      })
    );
    expect(bible.seriesBible.length).toBeLessThanOrEqual(2000);
  });
});

describe('validateGeneratedBeat - audience contracts', () => {
  it('requires exactly three choices for Preschool stories', () => {
    const words = Array.from({ length: 44 }, (_, index) => `word${index}`);
    const beat = makeValidBeat({
      storyText: words.join(' '),
      storyTextParts: [
        words.slice(0, 11).join(' '),
        words.slice(11, 22).join(' '),
        words.slice(22, 33).join(' '),
        words.slice(33).join(' '),
      ],
      options: [
        { id: '1', label: 'One', intent: 'one' },
        { id: '2', label: 'Two', intent: 'two' },
        { id: '3', label: 'Three', intent: 'three' },
        { id: '4', label: 'Four', intent: 'four' },
      ],
    });
    const issues = validateGeneratedBeat(beat, {
      currentBeat: 0,
      storyConfig: normalizeStoryConfig({ ageGroup: 'kids_3_5', beatLength: { level: 3 } }),
    });
    expect(issues.some((issue) => issue.includes('exactly 3 options'))).toBe(true);
  });

  it('allows a strict canonical seeded beat to preserve source length', () => {
    const source = 'These exact source words must stay unchanged.';
    const beat = makeValidBeat({
      storyText: source,
      storyTextParts: ['These exact', 'source words', 'must stay', 'unchanged.'],
      originKind: 'seeded_canonical',
    });
    const issues = validateGeneratedBeat(beat, {
      currentBeat: 0,
      storyConfig: normalizeStoryConfig({
        authoring: {
          mode: 'seeded',
          sourceText: source,
          sourceFidelity: 'strictly_follow',
        },
      }),
    });
    expect(issues.some((issue) => issue.includes('storyText has'))).toBe(false);
  });

  it('rejects panel chunks that alter the narration text', () => {
    const beat = makeValidBeat({
      storyTextParts: ['A different', 'story was', 'placed in', 'these chunks'],
    });
    const issues = validateGeneratedBeat(beat, { currentBeat: 0 });
    expect(issues.some((issue) => issue.includes('preserve all storyText content'))).toBe(true);
  });
});
