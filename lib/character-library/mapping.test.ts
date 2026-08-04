import { describe, expect, it } from 'vitest';
import { findCharacterNameConflicts, masterToCharacter, normalizeCharacterName } from './mapping';
import type { CharacterMaster } from '@/lib/types/character-library';

function makeMaster(overrides: Partial<CharacterMaster> = {}): CharacterMaster {
  return {
    id: 'master-1',
    userId: 'user-1',
    name: 'Milo',
    type: 'copper fox',
    appearanceSummary: 'small copper fox with a teal satchel',
    personalitySummary: 'curious and quick-thinking',
    roleNotes: 'usually the finder of clues',
    portraitUrl: 'https://assets/milo-portrait.webp',
    portraitStorageKey: 'u/library/characters/master-1_portrait.webp',
    referenceSheetUrl: 'https://assets/milo-sheet.webp',
    referenceSheetStorageKey: 'u/library/characters/master-1_sheet.webp',
    sourceType: 'generated_from_story',
    originStoryId: 'story-a',
    originCharacterId: 'char-milo',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

describe('masterToCharacter', () => {
  it('creates a fresh local instance linked back to the master', () => {
    const now = new Date('2026-07-10T10:00:00.000Z');
    const character = masterToCharacter(makeMaster(), now);
    expect(character.id).not.toBe('master-1');
    expect(character.masterId).toBe('master-1');
    expect(character.sourceStoryId).toBe('story-a');
    expect(character.importedAt).toBe(now.toISOString());
    expect(character.nameSource).toBe('character_library');
    expect(character.name).toBe('Milo');
    expect(character.appearanceSummary).toContain('copper fox');
    expect(character.portraitUrl).toBe('https://assets/milo-portrait.webp');
    expect(character.referenceSheetUrl).toBe('https://assets/milo-sheet.webp');
    expect(character.referenceSheetStorageKey).toBe('u/library/characters/master-1_sheet.webp');
    expect(character.portraitBase64).toBeUndefined();
  });

  it('generates a unique id per instance', () => {
    const master = makeMaster();
    expect(masterToCharacter(master).id).not.toBe(masterToCharacter(master).id);
  });

  it('omits asset fields the master does not have', () => {
    const character = masterToCharacter(
      makeMaster({ portraitUrl: null, referenceSheetUrl: null, referenceSheetStorageKey: null, originStoryId: null })
    );
    expect('portraitUrl' in character).toBe(false);
    expect('referenceSheetUrl' in character).toBe(false);
    expect('sourceStoryId' in character).toBe(false);
  });
});

describe('findCharacterNameConflicts', () => {
  it('flags selections that normalize to the same name', () => {
    const conflicts = findCharacterNameConflicts([
      { name: 'Tara' },
      { name: ' tara ' },
      { name: 'Milo' },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].normalizedName).toBe('tara');
    expect(conflicts[0].names).toEqual(['Tara', ' tara ']);
  });

  it('returns empty for distinct names and ignores blanks', () => {
    expect(findCharacterNameConflicts([{ name: 'Tara' }, { name: 'Milo' }, { name: '  ' }])).toEqual([]);
  });
});

describe('normalizeCharacterName', () => {
  it('lowercases and trims', () => {
    expect(normalizeCharacterName('  Captain Barnaby ')).toBe('captain barnaby');
  });
});
