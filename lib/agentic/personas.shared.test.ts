import { describe, expect, it } from 'vitest';
import type { StoryConfig } from '@/lib/types/story';
import {
  applyPersonaOverrides,
  buildClonedPersonaInput,
  clampBeatCount,
  isMissingPersonaSchemaError,
  resolveAllowedSettingKeys,
  resolvePersonaStoryConfig,
  type AgentPersona,
} from './personas.shared';

function persona(overrides: Partial<AgentPersona> = {}): AgentPersona {
  return {
    id: 'persona-1',
    slug: 'test-persona',
    displayName: 'Test Persona',
    bio: null,
    avatarUrl: null,
    language: 'english',
    ageGroup: 'all_ages',
    genres: ['adventure'],
    speciality: null,
    personaPrompt: 'Write warm, adventurous stories.',
    creativeNotes: null,
    restrictedThemes: [],
    defaultStoryConfig: {},
    dynamicSettingKeys: [],
    beatCountMin: 6,
    beatCountMax: 10,
    preferredVoice: null,
    approvedVoicePool: [],
    allowImageGeneration: false,
    allowNarration: false,
    modelOverrides: {},
    status: 'draft',
    scheduleEligible: false,
    isSeed: false,
    clonedFrom: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolvePersonaStoryConfig', () => {
  it('forces prompt_only for an image-off persona even when the override explicitly requests generate', () => {
    const imageOffPersona = persona({
      allowImageGeneration: false,
      dynamicSettingKeys: ['imageGenerationMode'],
    });

    const config = resolvePersonaStoryConfig(imageOffPersona, { imageGenerationMode: 'generate' });

    expect(config.imageGenerationMode).toBe('prompt_only');
  });

  it('also forces prompt_only when defaultStoryConfig itself requests generate', () => {
    const imageOffPersona = persona({
      allowImageGeneration: false,
      defaultStoryConfig: { imageGenerationMode: 'generate' },
    });

    expect(resolvePersonaStoryConfig(imageOffPersona).imageGenerationMode).toBe('prompt_only');
  });

  it('lets an image-on persona resolve to generate', () => {
    const imageOnPersona = persona({
      allowImageGeneration: true,
      dynamicSettingKeys: ['imageGenerationMode'],
    });

    const config = resolvePersonaStoryConfig(imageOnPersona, { imageGenerationMode: 'generate' });

    expect(config.imageGenerationMode).toBe('generate');
  });

  it('carries persona language and age group into the resolved config', () => {
    const config = resolvePersonaStoryConfig(persona({ language: 'hindi', ageGroup: 'kids_5_8' }));

    expect(config.language).toBe('hindi');
    expect(config.ageGroup).toBe('kids_5_8');
  });
});

describe('resolveAllowedSettingKeys', () => {
  it('drops keys that do not exist on StoryConfig', () => {
    const allowed = resolveAllowedSettingKeys({ dynamicSettingKeys: ['genre', 'notARealKey', 'maxBeats'] });
    expect(allowed).toEqual(['genre', 'maxBeats']);
  });
});

describe('applyPersonaOverrides', () => {
  it('rejects a key not in dynamicSettingKeys', () => {
    const result = applyPersonaOverrides(
      { dynamicSettingKeys: ['genre'] },
      { genre: 'mystery', maxBeats: 8 }
    );

    expect(result.applied).toEqual({ genre: 'mystery' });
    expect(result.rejected).toEqual(['maxBeats']);
  });

  it('applies nothing and rejects everything when dynamicSettingKeys is empty', () => {
    const result = applyPersonaOverrides({ dynamicSettingKeys: [] }, { genre: 'mystery' });
    expect(result.applied).toEqual({});
    expect(result.rejected).toEqual(['genre']);
  });
});

describe('clampBeatCount', () => {
  const bounds = { beatCountMin: 6, beatCountMax: 10 };

  it('clamps a value below the minimum up to beatCountMin', () => {
    expect(clampBeatCount(bounds, 2)).toBe(6);
  });

  it('clamps a value above the maximum down to beatCountMax', () => {
    expect(clampBeatCount(bounds, 20)).toBe(10);
  });

  it('passes an in-range value through unchanged', () => {
    expect(clampBeatCount(bounds, 8)).toBe(8);
  });

  it('falls back to the minimum for non-finite input', () => {
    expect(clampBeatCount(bounds, Number.NaN)).toBe(6);
  });

  it('never returns zero beats, even for a persona row configured with zeros', () => {
    expect(clampBeatCount({ beatCountMin: 0, beatCountMax: 0 }, 4)).toBe(1);
  });

  it('collapses an inverted range to its low bound instead of returning the smaller max', () => {
    expect(clampBeatCount({ beatCountMin: 9, beatCountMax: 3 }, 7)).toBe(9);
  });
});

describe('buildClonedPersonaInput', () => {
  it('never carries isSeed, status, or scheduleEligible forward from an active seed persona', () => {
    const seedPersona = persona({
      isSeed: true,
      status: 'active',
      scheduleEligible: true,
    });

    const clone = buildClonedPersonaInput(seedPersona, 'test-persona-2', 'Test Persona II');

    expect(clone.isSeed).toBe(false);
    expect(clone.status).toBe('draft');
    expect(clone.scheduleEligible).toBe(false);
    expect(clone.clonedFrom).toBe(seedPersona.id);
    expect(clone.slug).toBe('test-persona-2');
    expect(clone.displayName).toBe('Test Persona II');
  });

  it('copies array and object fields by value, not by reference', () => {
    const source = persona({ genres: ['adventure', 'mystery'], modelOverrides: { text: 'flash' } });
    const clone = buildClonedPersonaInput(source, 'clone-slug', 'Clone');

    expect(clone.genres).toEqual(source.genres);
    expect(clone.genres).not.toBe(source.genres);
    expect(clone.modelOverrides).toEqual(source.modelOverrides);
    expect(clone.modelOverrides).not.toBe(source.modelOverrides);
  });
});

describe('isMissingPersonaSchemaError', () => {
  it('recognizes undefined_table (42P01)', () => {
    expect(isMissingPersonaSchemaError({ code: '42P01' })).toBe(true);
  });

  it('recognizes undefined_column (42703), for stories.agent_persona_id', () => {
    expect(isMissingPersonaSchemaError({ code: '42703' })).toBe(true);
  });

  it('recognizes the PostgREST schema-cache codes', () => {
    expect(isMissingPersonaSchemaError({ code: 'PGRST200' })).toBe(true);
    expect(isMissingPersonaSchemaError({ code: 'PGRST204' })).toBe(true);
  });

  // The bug this guards: agent_personas is admin-written and slug is UNIQUE, so
  // a duplicate-slug insert is reachable in normal use. Its message names the
  // constraint -- and therefore the table -- so any classifier that matches on
  // the table name would report a fixable admin mistake as "migration 103 has
  // not been applied", which is the most misleading diagnosis available.
  it('does not treat a duplicate-slug violation as a missing schema', () => {
    expect(
      isMissingPersonaSchemaError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "agent_personas_slug_key"',
      })
    ).toBe(false);
  });

  it('does not misclassify an unrelated error that happens to name the table', () => {
    expect(
      isMissingPersonaSchemaError({ code: '23514', message: 'new row for relation "agent_personas" violates check constraint' })
    ).toBe(false);
  });

  it('returns false for a null/undefined error', () => {
    expect(isMissingPersonaSchemaError(null)).toBe(false);
    expect(isMissingPersonaSchemaError(undefined)).toBe(false);
  });
});

describe('StoryConfig type sanity', () => {
  it('resolved config satisfies the StoryConfig shape used elsewhere', () => {
    const config: StoryConfig = resolvePersonaStoryConfig(persona());
    expect(config.storyKind).toBeDefined();
  });
});
