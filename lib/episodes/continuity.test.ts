import { describe, expect, it } from 'vitest';
import {
  appendEpisodeTitleImageInstruction,
  buildEpisodeConfig,
  filterCarriedPortraitTasks,
} from './continuity';
import { DEFAULT_STORY_CONFIG, normalizeStoryConfig } from '@/lib/ai/story-config';
import type { Character, PortraitTask, StoryboardPlan, StoryConfig } from '@/lib/types/story';

function makeParentConfig(): StoryConfig {
  return normalizeStoryConfig({
    ...DEFAULT_STORY_CONFIG,
    language: 'hindi',
    ageGroup: 'kids_8_12',
    settingCountry: 'india',
    maxBeats: 8,
    visualSettings: {
      preset: 'watercolor_fable',
      theme: 'mysterious',
      palette: 'moody',
      detail: 'lush',
    },
    authoring: {
      mode: 'seeded',
      workingTitle: 'The Lantern Orchard',
      sourceText: 'A long source text…',
      guidanceText: 'Keep it gentle.',
      sourceFidelity: 'preserve_closely',
    },
  } as StoryConfig);
}

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

function makeFrame(label: string) {
  return {
    description: `${label} description`,
    prompt: `${label} prompt`,
    cameraAngle: 'wide',
    visualFocus: [label],
    emotion: 'warm',
    continuityAnchor: `${label} anchor`,
  };
}

function makePlan(portraitTasks: PortraitTask[]): StoryboardPlan {
  return {
    sharedVisualInvariants: ['same art style'],
    portraitTasks,
    topLeft: makeFrame('topLeft'),
    topRight: makeFrame('topRight'),
    bottomLeft: makeFrame('bottomLeft'),
    bottomRight: makeFrame('bottomRight'),
    negativeConstraints: ['no text inside image'],
  };
}

describe('buildEpisodeConfig', () => {
  it('inherits the parent universe settings', () => {
    const config = buildEpisodeConfig(makeParentConfig());
    expect(config.language).toBe('hindi');
    expect(config.ageGroup).toBe('kids_8_12');
    expect(config.settingCountry).toBe('india');
    expect(config.maxBeats).toBe(8);
    expect(config.visualSettings.preset).toBe('watercolor_fable');
    expect(config.visualSettings.theme).toBe('mysterious');
    expect(config.visualSettings.palette).toBe('moody');
    expect(config.visualSettings.detail).toBe('lush');
  });

  it('resets authoring to a fresh premise prompt', () => {
    const config = buildEpisodeConfig(makeParentConfig());
    expect(config.authoring.mode).toBe('prompt');
    expect(config.authoring.sourceText).toBeUndefined();
    expect(config.authoring.seedPlan).toBeUndefined();
    expect(config.authoring.workingTitle).toBeUndefined();
  });

  it('always produces a story (never a reel) and survives a null parent', () => {
    const reelParent = normalizeStoryConfig({ ...DEFAULT_STORY_CONFIG, storyKind: 'reel' } as StoryConfig);
    expect(buildEpisodeConfig(reelParent).storyKind).toBe('story');
    expect(buildEpisodeConfig(null).storyKind).toBe('story');
    expect(buildEpisodeConfig(undefined).authoring.mode).toBe('prompt');
  });
});

describe('appendEpisodeTitleImageInstruction', () => {
  it('appends the exact episode caption as an explicit text exception', () => {
    const result = appendEpisodeTitleImageInstruction('Base storyboard prompt.', 2);
    expect(result).toContain('Base storyboard prompt.');
    expect(result).toContain('"Episode 2"');
    expect(result).toContain('EXCEPTION');
  });

  it('is idempotent', () => {
    const once = appendEpisodeTitleImageInstruction('Base prompt.', 3);
    const twice = appendEpisodeTitleImageInstruction(once, 3);
    expect(twice).toBe(once);
  });

  it('leaves an empty prompt untouched', () => {
    expect(appendEpisodeTitleImageInstruction('', 2)).toBe('');
  });
});

describe('filterCarriedPortraitTasks', () => {
  const carried = makeCharacter('Milo', { portraitUrl: 'https://assets/milo.webp' });
  const sheetOnly = makeCharacter('Tara', { referenceSheetUrl: 'https://assets/tara.webp' });
  const fresh = makeCharacter('Nia');

  it('drops new_character tasks for characters with an existing visual reference', () => {
    const plan = makePlan([
      { characterId: carried.id, characterName: 'Milo', reason: 'new_character', prompt: 'p' },
      { characterId: sheetOnly.id, characterName: 'Tara', reason: 'new_character', prompt: 'p' },
      { characterId: fresh.id, characterName: 'Nia', reason: 'new_character', prompt: 'p' },
    ]);
    const filtered = filterCarriedPortraitTasks(plan, [carried, sheetOnly, fresh]);
    expect(filtered.portraitTasks.map((task) => task.characterName)).toEqual(['Nia']);
  });

  it('keeps visual_change tasks even for carried characters', () => {
    const plan = makePlan([
      { characterId: carried.id, characterName: 'Milo', reason: 'visual_change', prompt: 'p' },
    ]);
    const filtered = filterCarriedPortraitTasks(plan, [carried]);
    expect(filtered.portraitTasks).toHaveLength(1);
  });

  it('matches by name when the task carries an unknown id', () => {
    const plan = makePlan([
      { characterId: 'llm-minted-id', characterName: 'Milo', reason: 'new_character', prompt: 'p' },
    ]);
    const filtered = filterCarriedPortraitTasks(plan, [carried]);
    expect(filtered.portraitTasks).toHaveLength(0);
  });

  it('returns the plan unchanged when nothing is carried', () => {
    const plan = makePlan([
      { characterId: fresh.id, characterName: 'Nia', reason: 'new_character', prompt: 'p' },
    ]);
    expect(filterCarriedPortraitTasks(plan, [fresh])).toBe(plan);
    expect(filterCarriedPortraitTasks(plan, [])).toBe(plan);
  });
});
