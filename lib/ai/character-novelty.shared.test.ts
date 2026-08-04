import { describe, expect, it } from 'vitest';
import type { Character, StoryBeat, StorySession } from '@/lib/types/story';
import {
  applyCharacterNameProvenance,
  appearanceSimilarity,
  buildCharacterNoveltyInstructions,
  findSimilarRecentName,
  normalizeCharacterName,
  validateCharacterNovelty,
  type CharacterNoveltyContext,
} from './character-novelty.shared';

function character(name: string, overrides: Partial<Character> = {}): Character {
  return {
    id: `char-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type: 'main',
    appearanceSummary: 'tall figure with a charcoal coat, silver braid, brass monocle, and measured posture',
    personalitySummary: 'observant and patient',
    ...overrides,
  };
}

function beat(characters: Character[]): StoryBeat {
  return {
    title: 'Opening',
    beatNumber: 1,
    isEnding: false,
    storyText: 'The adventure begins.',
    storyTextParts: ['The', 'adventure', 'now', 'begins.'],
    sceneSummary: 'An opening encounter.',
    options: [
      { id: 'a', label: 'Ask', intent: 'curiosity' },
      { id: 'b', label: 'Wait', intent: 'caution' },
      { id: 'c', label: 'Leave', intent: 'retreat' },
    ],
    characters,
    continuityNotes: [],
    imagePrompt: 'wide establishing shot',
    clues: [],
    nextBeatGoal: 'Reveal the path.',
    endingForecast: ['discovery'],
    newCharacterIds: characters.map((entry) => entry.id),
    changedCharacterIds: [],
  };
}

const context: CharacterNoveltyContext = {
  recentCharacters: [
    {
      displayName: 'Milo',
      normalizedName: 'milo',
      appearanceSignature: 'small golden brown monkey with a curled tail, red waistcoat, bright eyes, and quick gestures',
    },
    {
      displayName: 'Tara',
      normalizedName: 'tara',
      appearanceSignature: 'short elderly sailor with a blue wool coat, copper earrings, and a rolling gait',
    },
  ],
};

describe('character name matching', () => {
  it('normalizes Unicode punctuation, case, and spacing', () => {
    expect(normalizeCharacterName('  Captain—MILO!  ')).toBe('captain milo');
  });

  it('catches exact, titled, and one-edit near repeats', () => {
    expect(findSimilarRecentName('MILO', context.recentCharacters)?.displayName).toBe('Milo');
    expect(findSimilarRecentName('Captain Milo', context.recentCharacters)?.displayName).toBe('Milo');
    expect(findSimilarRecentName('Miko', context.recentCharacters)?.displayName).toBe('Milo');
  });

  it('allows clearly different names', () => {
    expect(findSimilarRecentName('Zareen', context.recentCharacters)).toBeUndefined();
  });
});

describe('visual persona matching', () => {
  it('scores formatting-only rewrites as highly similar', () => {
    const score = appearanceSimilarity(
      'A small golden-brown monkey with bright eyes, curled tail, quick gestures and a red waistcoat.',
      context.recentCharacters[0].appearanceSignature || ''
    );
    expect(score).toBeGreaterThanOrEqual(0.78);
  });

  it('does not flag a substantially different persona', () => {
    const score = appearanceSimilarity(
      'towering stone automaton with mossy shoulders and a glowing geometric face',
      context.recentCharacters[0].appearanceSignature || ''
    );
    expect(score).toBe(0);
  });
});

describe('buildCharacterNoveltyInstructions', () => {
  it('separates protected current names from recent names and includes visual guidance', () => {
    const prompt = buildCharacterNoveltyInstructions(context, [character('Tara')]);
    expect(prompt).toContain('Protected current names: Tara');
    expect(prompt).toContain('Milo | Tara');
    expect(prompt).toContain('Vary at least three relevant axes');
    expect(prompt).toContain('small golden brown monkey');
  });
});

describe('validateCharacterNovelty', () => {
  it('rejects a newly invented repeated or near-repeated name', () => {
    const issues = validateCharacterNovelty(
      beat([character('Miko', { appearanceSummary: 'towering stone automaton with mossy shoulders and a glowing geometric face' })]),
      { currentBeat: 0, beats: [], characters: [] },
      'Tell a mountain adventure',
      context
    );
    expect(issues.some((issue) => issue.includes('conflicts with recently used name "Milo"'))).toBe(true);
  });

  it('rejects near-duplicate inventions inside the same new cast', () => {
    const localContext: CharacterNoveltyContext = {
      recentCharacters: [{ displayName: 'Tara', normalizedName: 'tara' }],
    };
    const issues = validateCharacterNovelty(
      beat([
        character('Milo'),
        character('Miko', { appearanceSummary: 'round clockwork bird with enamel wings and a glass beak' }),
      ]),
      { currentBeat: 0, beats: [], characters: [] },
      'Tell a mountain adventure',
      localContext
    );
    expect(issues.some((issue) => issue.includes('too similar to current cast name "Milo"'))).toBe(true);
  });

  it('allows an explicitly user-requested recent name and visual persona', () => {
    const requested = character('Milo', {
      appearanceSummary: context.recentCharacters[0].appearanceSignature,
    });
    expect(validateCharacterNovelty(
      beat([requested]),
      { currentBeat: 0, beats: [], characters: [] },
      'Continue the adventures of Milo',
      context
    )).toEqual([]);
  });

  it('allows an existing or imported character even when it is in recent history', () => {
    const existing = character('Tara', { id: 'library-tara', masterId: 'master-tara' });
    const session: Partial<StorySession> = {
      currentBeat: 0,
      beats: [],
      characters: [existing],
    };
    expect(validateCharacterNovelty(
      beat([existing]),
      session,
      'A voyage across the glass sea',
      context
    )).toEqual([]);
  });

  it('still checks an AI-assigned name for an unnamed reference placeholder', () => {
    const placeholder = character('Character 1', {
      id: 'reference-1',
      nameIsPlaceholder: true,
      nameSource: 'ai_generated',
    });
    const namedReference = character('Milo', { id: 'reference-1' });
    const issues = validateCharacterNovelty(
      beat([namedReference]),
      { currentBeat: 0, beats: [], characters: [placeholder] },
      'Use my unnamed character reference',
      context
    );
    expect(issues.some((issue) => issue.includes('recently used name "Milo"'))).toBe(true);
  });

  it('rejects a closely repeated visual persona under a new name', () => {
    const repeatedVisual = character('Zareen', {
      appearanceSummary: 'A small golden-brown monkey with bright eyes, curled tail, quick gestures and a red waistcoat.',
    });
    const issues = validateCharacterNovelty(
      beat([repeatedVisual]),
      { currentBeat: 0, beats: [], characters: [] },
      'Tell a jungle adventure',
      context
    );
    expect(issues.some((issue) => issue.includes('repeats the recent visual persona of "Milo"'))).toBe(true);
  });
});

describe('applyCharacterNameProvenance', () => {
  it('marks explicit names as user-provided and inventions as AI-generated', () => {
    const result = applyCharacterNameProvenance(
      beat([character('Milo'), character('Zareen')]),
      { currentBeat: 0, beats: [], characters: [] },
      'Write a story about Milo'
    );
    expect(result.characters.find((entry) => entry.name === 'Milo')?.nameSource).toBe('user_provided');
    expect(result.characters.find((entry) => entry.name === 'Zareen')?.nameSource).toBe('ai_generated');
  });

  it('preserves imported provenance for an existing character', () => {
    const imported = character('Tara', { id: 'tara-1', nameSource: 'character_library' });
    const result = applyCharacterNameProvenance(
      beat([character('Tara', { id: 'tara-1' })]),
      { currentBeat: 1, beats: [], characters: [imported] },
      ''
    );
    expect(result.characters[0].nameSource).toBe('character_library');
  });
});
