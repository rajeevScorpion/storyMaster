import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS } from '@/lib/ai/model-config.shared';
import {
  TEXT_MODEL_KEY_PATTERN,
  TEXT_PROVIDER_ENV_VARS,
  buildSyntheticGeminiRecord,
  isMissingTextModelRegistrySchemaError,
  mapTextModelRow,
  resolveTextModel,
  suggestModelKey,
  validateTextModelInput,
  validateTextModelSelection,
  type TextModelRecord,
  type TextModelRow,
} from './text-models.shared';

function makeRow(overrides: Partial<TextModelRow> = {}): TextModelRow {
  return {
    id: 'row-1',
    model_key: 'openrouter:qwen/qwen3.7-flash',
    provider_key: 'openrouter',
    provider_model_id: 'qwen/qwen3.7-flash',
    display_name: 'Qwen 3.7 Flash (OpenRouter)',
    description: '',
    is_enabled: true,
    capabilities: { structuredOutput: 'json', vision: true, temperature: true },
    default_params: {},
    timeout_ms: 60000,
    input_cost_per_mtok_usd: 0.03,
    output_cost_per_mtok_usd: 0.13,
    cached_input_cost_per_mtok_usd: 0.006,
    required_env_vars: ['OPENROUTER_API_KEY'],
    sort_order: 120,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    updated_by: null,
    ...overrides,
  };
}

describe('mapTextModelRow', () => {
  it('maps a well-formed row', () => {
    const record = mapTextModelRow(makeRow());
    expect(record).toMatchObject({
      id: 'row-1',
      modelKey: 'openrouter:qwen/qwen3.7-flash',
      providerKey: 'openrouter',
      providerModelId: 'qwen/qwen3.7-flash',
      displayName: 'Qwen 3.7 Flash (OpenRouter)',
      isEnabled: true,
      capabilities: { structuredOutput: 'json', vision: true, temperature: true },
      timeoutMs: 60000,
      inputCostPerMtokUsd: 0.03,
      requiredEnvVars: ['OPENROUTER_API_KEY'],
      sortOrder: 120,
    });
  });

  it('falls back to safe defaults for garbage capabilities and default_params JSONB', () => {
    const record = mapTextModelRow(makeRow({
      capabilities: 'not-an-object',
      default_params: ['also', 'not', 'an', 'object'],
      required_env_vars: null,
      description: null,
      provider_key: 'not-a-real-provider',
      timeout_ms: null,
      input_cost_per_mtok_usd: null,
      output_cost_per_mtok_usd: null,
      cached_input_cost_per_mtok_usd: null,
      sort_order: null,
    }));

    expect(record.capabilities).toEqual({ structuredOutput: 'none', vision: false, temperature: true });
    expect(record.defaultParams).toEqual({});
    expect(record.requiredEnvVars).toEqual([]);
    expect(record.description).toBe('');
    expect(record.providerKey).toBe('gemini');
    expect(record.sortOrder).toBe(0);
  });

  it('coerces numeric-string costs and rejects unparsable ones', () => {
    const record = mapTextModelRow(makeRow({
      input_cost_per_mtok_usd: '0.5',
      output_cost_per_mtok_usd: 'not-a-number',
    }));
    expect(record.inputCostPerMtokUsd).toBe(0.5);
    expect(record.outputCostPerMtokUsd).toBeNull();
  });

  it('keeps only known capability values, discarding unrecognised ones', () => {
    const record = mapTextModelRow(makeRow({
      capabilities: { structuredOutput: 'strict-json-please', vision: 'yes', temperature: 1 },
    }));
    expect(record.capabilities).toEqual({ structuredOutput: 'none', vision: false, temperature: true });
  });
});

describe('buildSyntheticGeminiRecord', () => {
  it('builds an enabled, vision-capable Gemini record requiring only GEMINI_API_KEY', () => {
    const record = buildSyntheticGeminiRecord('gemini-3.5-flash');
    expect(record.providerKey).toBe('gemini');
    expect(record.modelKey).toBe('gemini-3.5-flash');
    expect(record.providerModelId).toBe('gemini-3.5-flash');
    expect(record.isEnabled).toBe(true);
    expect(record.capabilities).toEqual({ structuredOutput: 'native', vision: true, temperature: true });
    expect(record.requiredEnvVars).toEqual([TEXT_PROVIDER_ENV_VARS.gemini]);
  });
});

describe('resolveTextModel', () => {
  const TASK = 'story_generation' as const;
  const registryRow = mapTextModelRow(makeRow({
    model_key: 'openrouter:qwen/qwen3.7-flash',
    is_enabled: true,
    capabilities: { structuredOutput: 'json', vision: true, temperature: true },
  }));
  const disabledRow = mapTextModelRow(makeRow({
    model_key: 'openai:gpt-5.6-luna',
    provider_key: 'openai',
    provider_model_id: 'gpt-5.6-luna',
    is_enabled: false,
  }));
  const noVisionRow = mapTextModelRow(makeRow({
    model_key: 'openrouter:deepseek/deepseek-v4-flash-0731',
    provider_key: 'openrouter',
    provider_model_id: 'deepseek/deepseek-v4-flash-0731',
    is_enabled: true,
    capabilities: { structuredOutput: 'native', vision: false, temperature: true },
  }));
  const geminiDefaultRow = mapTextModelRow(makeRow({
    model_key: DEFAULT_MODELS[TASK].modelId,
    provider_key: 'gemini',
    provider_model_id: DEFAULT_MODELS[TASK].modelId,
    is_enabled: true,
    capabilities: { structuredOutput: 'native', vision: true, temperature: true },
  }));

  it('legacy mode: a bare Gemini id runs as-is', () => {
    const result = resolveTextModel({
      taskKey: TASK,
      requestedKey: 'gemini-2.5-flash',
      registry: null,
    });
    expect(result.source).toBe('legacy');
    expect(result.record.providerKey).toBe('gemini');
    expect(result.record.modelKey).toBe('gemini-2.5-flash');
  });

  it('legacy mode: a non-Gemini id can never reach a paid provider -- it falls back to the task default', () => {
    const result = resolveTextModel({
      taskKey: TASK,
      requestedKey: 'openrouter:qwen/qwen3.7-flash',
      registry: null,
    });
    expect(result.source).toBe('fallback');
    expect(result.fallbackReason).toBe('unknown_model');
    expect(result.record.providerKey).toBe('gemini');
    expect(result.record.modelKey).toBe(DEFAULT_MODELS[TASK].modelId);
  });

  it('registry hit: an enabled, capable row resolves directly', () => {
    const result = resolveTextModel({
      taskKey: TASK,
      requestedKey: registryRow.modelKey,
      registry: [registryRow, geminiDefaultRow],
    });
    expect(result).toEqual({ record: registryRow, source: 'registry' });
  });

  it('unknown key falls back with reason unknown_model', () => {
    const result = resolveTextModel({
      taskKey: TASK,
      requestedKey: 'no-such-model',
      registry: [registryRow, geminiDefaultRow],
    });
    expect(result.source).toBe('fallback');
    expect(result.fallbackReason).toBe('unknown_model');
    expect(result.record.modelKey).toBe(geminiDefaultRow.modelKey);
  });

  it('disabled key falls back with reason disabled', () => {
    const result = resolveTextModel({
      taskKey: TASK,
      requestedKey: disabledRow.modelKey,
      registry: [disabledRow, geminiDefaultRow],
    });
    expect(result.source).toBe('fallback');
    expect(result.fallbackReason).toBe('disabled');
    expect(result.record.modelKey).toBe(geminiDefaultRow.modelKey);
  });

  it('a vision task on a non-vision model falls back with reason missing_capability', () => {
    const result = resolveTextModel({
      taskKey: TASK,
      requestedKey: noVisionRow.modelKey,
      registry: [noVisionRow, geminiDefaultRow],
      requireVision: true,
    });
    expect(result.source).toBe('fallback');
    expect(result.fallbackReason).toBe('missing_capability');
  });

  it('does not require vision when the task does not', () => {
    const result = resolveTextModel({
      taskKey: TASK,
      requestedKey: noVisionRow.modelKey,
      registry: [noVisionRow, geminiDefaultRow],
      requireVision: false,
    });
    expect(result.source).toBe('registry');
    expect(result.record.modelKey).toBe(noVisionRow.modelKey);
  });

  it('fallback uses the default row from the registry even if that row is disabled', () => {
    const disabledDefault = { ...geminiDefaultRow, isEnabled: false };
    const result = resolveTextModel({
      taskKey: TASK,
      requestedKey: 'no-such-model',
      registry: [disabledDefault],
    });
    expect(result.source).toBe('fallback');
    // The emergency path returns the disabled row itself, not a synthetic stand-in.
    expect(result.record).toBe(disabledDefault);
  });

  it('synthesizes a Gemini record when the default row is absent from the registry entirely', () => {
    const result = resolveTextModel({
      taskKey: TASK,
      requestedKey: 'no-such-model',
      registry: [registryRow],
    });
    expect(result.source).toBe('fallback');
    expect(result.record.id).toBe(`synthetic:${DEFAULT_MODELS[TASK].modelId}`);
    expect(result.record.providerKey).toBe('gemini');
  });
});

describe('suggestModelKey', () => {
  it('keeps Gemini keys bare and prefixes every other provider', () => {
    expect(suggestModelKey('gemini', 'gemini-3.5-flash')).toBe('gemini-3.5-flash');
    expect(suggestModelKey('openai', 'gpt-5.6-luna')).toBe('openai:gpt-5.6-luna');
    expect(suggestModelKey('openrouter', 'qwen/qwen3.7-flash')).toBe('openrouter:qwen/qwen3.7-flash');
  });
});

describe('TEXT_MODEL_KEY_PATTERN', () => {
  // Must stay byte-for-byte equivalent to the SQL CHECK
  // text_model_registry_model_key_format: ^[a-z0-9][a-z0-9._:/-]{0,119}$
  it('accepts every seeded model_key shape', () => {
    for (const key of [
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite-preview',
      'openai:gpt-5.6-luna',
      'openrouter:openai/gpt-5.6-luna',
      'openrouter:qwen/qwen3.7-flash',
      'openrouter:deepseek/deepseek-v4-flash-0731',
    ]) {
      expect(TEXT_MODEL_KEY_PATTERN.test(key)).toBe(true);
    }
  });

  it('rejects an empty string, an uppercase key, a key starting with a separator, and an oversized key', () => {
    expect(TEXT_MODEL_KEY_PATTERN.test('')).toBe(false);
    expect(TEXT_MODEL_KEY_PATTERN.test('Gemini-3.5-Flash')).toBe(false);
    expect(TEXT_MODEL_KEY_PATTERN.test('-gemini-3.5-flash')).toBe(false);
    expect(TEXT_MODEL_KEY_PATTERN.test(':gemini-3.5-flash')).toBe(false);
    expect(TEXT_MODEL_KEY_PATTERN.test('a'.repeat(121))).toBe(false);
  });

  it('accepts the maximum length of 120 characters', () => {
    expect(TEXT_MODEL_KEY_PATTERN.test('a'.repeat(120))).toBe(true);
  });
});

describe('isMissingTextModelRegistrySchemaError', () => {
  it('matches every accepted schema-absence code', () => {
    for (const code of ['42P01', '42703', 'PGRST200', 'PGRST204', 'PGRST205']) {
      expect(isMissingTextModelRegistrySchemaError({ code })).toBe(true);
    }
  });

  it('does not match an unrelated error code, and does not match on message text', () => {
    expect(isMissingTextModelRegistrySchemaError({ code: '23505', message: 'text_model_registry duplicate key' })).toBe(false);
    expect(isMissingTextModelRegistrySchemaError({ message: 'relation "text_model_registry" does not exist' })).toBe(false);
    expect(isMissingTextModelRegistrySchemaError(null)).toBe(false);
    expect(isMissingTextModelRegistrySchemaError(undefined)).toBe(false);
  });
});

describe('validateTextModelInput', () => {
  it('accepts a fully valid input with no issues', () => {
    expect(validateTextModelInput({
      modelKey: 'openrouter:qwen/qwen3.7-flash',
      providerKey: 'openrouter',
      providerModelId: 'qwen/qwen3.7-flash',
      displayName: 'Qwen 3.7 Flash (OpenRouter)',
      description: '',
      capabilities: { structuredOutput: 'json', vision: true, temperature: true },
      timeoutMs: 60000,
      inputCostPerMtokUsd: 0.03,
      outputCostPerMtokUsd: 0.13,
      cachedInputCostPerMtokUsd: 0.006,
    })).toEqual([]);
  });

  it('accepts an empty patch (nothing to validate)', () => {
    expect(validateTextModelInput({})).toEqual([]);
  });

  it('flags a malformed model_key', () => {
    expect(validateTextModelInput({ modelKey: 'Bad Key!' })).toContain(
      'model_key must match ^[a-z0-9][a-z0-9._:/-]{0,119}$'
    );
  });

  it('flags an unknown provider_key', () => {
    expect(validateTextModelInput({ providerKey: 'anthropic' })).toEqual([
      'provider_key must be one of gemini, openai, openrouter',
    ]);
  });

  it('flags an out-of-range timeout', () => {
    expect(validateTextModelInput({ timeoutMs: 500 })).toContain('timeout_ms must be between 1000 and 300000');
    expect(validateTextModelInput({ timeoutMs: 400000 })).toContain('timeout_ms must be between 1000 and 300000');
    expect(validateTextModelInput({ timeoutMs: null })).toEqual([]);
  });

  it('flags negative prices but allows null (meaning: use the code price table)', () => {
    expect(validateTextModelInput({ inputCostPerMtokUsd: -0.01 })).toContain(
      'input_cost_per_mtok_usd must be a non-negative number'
    );
    expect(validateTextModelInput({ outputCostPerMtokUsd: null })).toEqual([]);
  });

  it('flags an out-of-range display_name and description', () => {
    expect(validateTextModelInput({ displayName: '' })).toContain('display_name must be 1-120 characters');
    expect(validateTextModelInput({ displayName: 'a'.repeat(121) })).toContain('display_name must be 1-120 characters');
    expect(validateTextModelInput({ description: 'a'.repeat(501) })).toContain('description must be at most 500 characters');
  });

  it('flags an invalid capability enum value or type', () => {
    expect(validateTextModelInput({ capabilities: { structuredOutput: 'strict' as never } })).toContain(
      'capabilities.structuredOutput must be native, json, or none'
    );
    expect(validateTextModelInput({ capabilities: { vision: 'yes' as unknown as boolean } })).toContain(
      'capabilities.vision must be a boolean'
    );
  });
});

describe('validateTextModelSelection', () => {
  const TASK = 'story_generation' as const;
  const VISION_TASK = 'graphic_style_extraction' as const;

  const enabledRow: TextModelRecord = mapTextModelRow(makeRow({
    model_key: 'openrouter:qwen/qwen3.7-flash',
    is_enabled: true,
    capabilities: { structuredOutput: 'json', vision: true, temperature: true },
  }));
  const disabledRow: TextModelRecord = mapTextModelRow(makeRow({
    model_key: 'openai:gpt-5.6-luna',
    provider_key: 'openai',
    provider_model_id: 'gpt-5.6-luna',
    is_enabled: false,
  }));
  const noVisionRow: TextModelRecord = mapTextModelRow(makeRow({
    model_key: 'openrouter:deepseek/deepseek-v4-flash-0731',
    provider_key: 'openrouter',
    provider_model_id: 'deepseek/deepseek-v4-flash-0731',
    is_enabled: true,
    capabilities: { structuredOutput: 'native', vision: false, temperature: true },
  }));

  it('is a no-op for image, TTS and alignment tasks regardless of registry state', () => {
    expect(validateTextModelSelection('image_generation', 'anything-goes', null)).toBeNull();
    expect(validateTextModelSelection('tts', 'anything-goes', [])).toBeNull();
    expect(validateTextModelSelection('story_text_overlay_alignment', 'anything-goes', [enabledRow])).toBeNull();
  });

  it('legacy mode (registry unavailable): accepts only a bare Gemini id', () => {
    expect(validateTextModelSelection(TASK, 'gemini-3.5-flash', null)).toBeNull();
    expect(validateTextModelSelection(TASK, 'openrouter:qwen/qwen3.7-flash', null)).toMatch(/not a valid Gemini model id/);
  });

  it('registry present: accepts an enabled row', () => {
    expect(validateTextModelSelection(TASK, enabledRow.modelKey, [enabledRow])).toBeNull();
  });

  it('rejects an unknown key', () => {
    expect(validateTextModelSelection(TASK, 'no-such-model', [enabledRow])).toMatch(/not a known text model/);
  });

  it('rejects a disabled row', () => {
    expect(validateTextModelSelection(TASK, disabledRow.modelKey, [disabledRow])).toMatch(/disabled/);
  });

  it('rejects a non-vision model for a vision task', () => {
    expect(validateTextModelSelection(VISION_TASK, noVisionRow.modelKey, [noVisionRow])).toMatch(/does not support vision/);
  });

  it('accepts a non-vision model for a non-vision task', () => {
    expect(validateTextModelSelection(TASK, noVisionRow.modelKey, [noVisionRow])).toBeNull();
  });
});
