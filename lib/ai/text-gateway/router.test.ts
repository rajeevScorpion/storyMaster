import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TextModelRecord } from '@/lib/ai/text-models.shared';
import { optionsRegenerationSchema } from '@/lib/ai/generation-schemas';

vi.mock('server-only', () => ({}));

const { generateContentMock, getTextModelRegistryMock, getMissingEnvVarsMock, getFeatureFlagValueMock, recordModelCostEventMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  getTextModelRegistryMock: vi.fn(),
  getMissingEnvVarsMock: vi.fn(),
  getFeatureFlagValueMock: vi.fn(),
  recordModelCostEventMock: vi.fn(),
}));

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: { generateContent: generateContentMock },
    })),
  };
});

vi.mock('@/lib/ai/text-models', () => ({
  getTextModelRegistry: getTextModelRegistryMock,
  getMissingEnvVars: getMissingEnvVarsMock,
}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlagValue: getFeatureFlagValueMock,
}));

vi.mock('@/lib/ai/cost-telemetry', () => ({
  recordModelCostEvent: recordModelCostEventMock,
}));

import { generateText } from './router';
import { TextGatewayError } from './types.shared';

const NOW = new Date().toISOString();

function makeRecord(overrides: Partial<TextModelRecord> = {}): TextModelRecord {
  return {
    id: 'row-1',
    modelKey: 'openrouter:qwen/qwen3.7-flash',
    providerKey: 'openrouter',
    providerModelId: 'qwen/qwen3.7-flash',
    displayName: 'Qwen 3.7 Flash',
    description: '',
    isEnabled: true,
    capabilities: { structuredOutput: 'json', vision: true, temperature: true },
    defaultParams: {},
    timeoutMs: null,
    inputCostPerMtokUsd: 0.03,
    outputCostPerMtokUsd: 0.13,
    cachedInputCostPerMtokUsd: 0.006,
    requiredEnvVars: ['OPENROUTER_API_KEY'],
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: null,
    ...overrides,
  };
}

const GEMINI_DEFAULT_RECORD = makeRecord({
  id: 'row-gemini-default',
  modelKey: 'gemini-3.5-flash',
  providerKey: 'gemini',
  providerModelId: 'gemini-3.5-flash',
  capabilities: { structuredOutput: 'native', vision: true, temperature: true },
  requiredEnvVars: ['GEMINI_API_KEY'],
});

function fetchOk(json: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => json, headers: { get: () => null } };
}

function fetchFail(status: number) {
  return { ok: false, status, json: async () => ({}), headers: { get: () => null } };
}

beforeEach(() => {
  vi.clearAllMocks();
  getMissingEnvVarsMock.mockReturnValue([]);
  getFeatureFlagValueMock.mockResolvedValue(null);
  recordModelCostEventMock.mockResolvedValue(undefined);
});

describe('generateText', () => {
  it('calls OpenRouter with the provider model id for a task configured to an OpenRouter key', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })));

    const result = await generateText({ taskKey: 'story_generation', modelKey: 'openrouter:qwen/qwen3.7-flash', prompt: 'hi' });

    expect(result.text).toBe('hello');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('qwen/qwen3.7-flash');
  });

  it('falls back to the task default Gemini model when the requested key is disabled, and records why', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getTextModelRegistryMock.mockResolvedValue([makeRecord({ isEnabled: false }), GEMINI_DEFAULT_RECORD]);
    generateContentMock.mockResolvedValue({
      text: '{"ok":true}',
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
    });
    vi.stubGlobal('fetch', vi.fn());

    const result = await generateText({
      taskKey: 'story_generation',
      modelKey: 'openrouter:qwen/qwen3.7-flash',
      prompt: 'hi',
      telemetry: { activityKey: 'continue_story_new_beat' },
    });

    expect(result.resolution.source).toBe('fallback');
    expect(result.resolution.fallbackReason).toBe('disabled');
    expect(fetch).not.toHaveBeenCalled();
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    expect(recordModelCostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'gemini-3.5-flash',
        provider: 'google_gemini',
        metadata: expect.objectContaining({
          resolutionSource: 'fallback',
          fallbackReason: 'disabled',
          requestedModelKey: 'openrouter:qwen/qwen3.7-flash',
        }),
      })
    );
  });

  it('throws auth_missing and never calls fetch when a required env var is absent', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    getMissingEnvVarsMock.mockReturnValue(['OPENROUTER_API_KEY']);
    vi.stubGlobal('fetch', vi.fn());

    await expect(generateText({ taskKey: 'story_generation', modelKey: 'openrouter:qwen/qwen3.7-flash', prompt: 'hi' }))
      .rejects.toMatchObject({ category: 'auth_missing' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws malformed_output on unparsable JSON from a non-Gemini provider', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'not json' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })));

    await expect(generateText({
      taskKey: 'story_generation',
      modelKey: 'openrouter:qwen/qwen3.7-flash',
      prompt: 'hi',
      schema: optionsRegenerationSchema,
    })).rejects.toMatchObject({ category: 'malformed_output' });
  });

  it('on Gemini, a schema mismatch only warns and returns the text unchanged', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD]);
    generateContentMock.mockResolvedValue({
      text: '{"wrong":"shape"}',
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
    });

    const result = await generateText({
      taskKey: 'story_generation',
      modelKey: 'gemini-3.5-flash',
      prompt: 'hi',
      schema: optionsRegenerationSchema,
    });

    expect(result.text).toBe('{"wrong":"shape"}');
    expect(result.resolution.source).toBe('registry');
    expect(warnSpy).toHaveBeenCalledWith('[text-gateway] gemini schema mismatch', expect.anything());
  });

  it('records the OpenRouter provider and its reported usage.cost as the telemetry cost override', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0012 },
    })));

    await generateText({
      taskKey: 'story_generation',
      modelKey: 'openrouter:qwen/qwen3.7-flash',
      prompt: 'hi',
      telemetry: { activityKey: 'continue_story_new_beat' },
    });

    expect(recordModelCostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openrouter', estimatedCostUsdOverride: 0.0012 })
    );
  });

  it('merges request.telemetryMetadata into telemetry metadata, with router keys winning on collision', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })));

    await generateText({
      taskKey: 'story_generation',
      modelKey: 'openrouter:qwen/qwen3.7-flash',
      prompt: 'hi',
      telemetry: { activityKey: 'continue_story_new_beat' },
      telemetryMetadata: { promptChars: 2, temperature: 0.7, requestedModelKey: 'stale-caller-value' },
    });

    expect(recordModelCostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          promptChars: 2,
          temperature: 0.7,
          // Router-computed fields win over a same-named caller field.
          requestedModelKey: 'openrouter:qwen/qwen3.7-flash',
        }),
      })
    );
  });

  it('does not retry on a 429 -- fetch is called exactly once', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    const fetchMock = vi.fn().mockResolvedValue(fetchFail(429));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateText({ taskKey: 'story_generation', modelKey: 'openrouter:qwen/qwen3.7-flash', prompt: 'hi' }))
      .rejects.toMatchObject({ category: 'rate_limited', retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('legacy mode (registry unavailable) never calls fetch, even for a non-Gemini requested key', async () => {
    getTextModelRegistryMock.mockResolvedValue(null);
    generateContentMock.mockResolvedValue({
      text: 'plain text',
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateText({ taskKey: 'story_generation', modelKey: 'openrouter:qwen/qwen3.7-flash', prompt: 'hi' });

    expect(result.resolution.source).toBe('fallback');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('strictModel throws model_unavailable instead of running the fallback, and calls no provider', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateText({
      taskKey: 'story_generation',
      modelKey: 'openrouter:unknown-model',
      prompt: 'hi',
      strictModel: true,
    })).rejects.toMatchObject({ category: 'model_unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('does not send max_completion_tokens when the resolved record has maxOutputTokens: 0', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord({ defaultParams: { maxOutputTokens: 0 } })]);
    const fetchMock = vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await generateText({ taskKey: 'story_generation', modelKey: 'openrouter:qwen/qwen3.7-flash', prompt: 'hi' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect('max_completion_tokens' in body).toBe(false);
  });
});

describe('TextGatewayError', () => {
  it('is the class instance thrown for auth_missing', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    getMissingEnvVarsMock.mockReturnValue(['OPENROUTER_API_KEY']);
    try {
      await generateText({ taskKey: 'story_generation', modelKey: 'openrouter:qwen/qwen3.7-flash', prompt: 'hi' });
      throw new Error('expected generateText to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TextGatewayError);
    }
  });
});
