import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TextModelRecord } from '@/lib/ai/text-models.shared';
import { optionsRegenerationSchema } from '@/lib/ai/generation-schemas';

vi.mock('server-only', () => ({}));

const {
  generateContentMock,
  getTextModelRegistryMock,
  getMissingEnvVarsMock,
  getFeatureFlagValueMock,
  getModelConfigMock,
  getContentBlockFallbackModelMock,
  recordModelCostEventMock,
} = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  getTextModelRegistryMock: vi.fn(),
  getMissingEnvVarsMock: vi.fn(),
  getFeatureFlagValueMock: vi.fn(),
  getModelConfigMock: vi.fn(),
  getContentBlockFallbackModelMock: vi.fn(),
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
  getModelConfig: getModelConfigMock,
  getContentBlockFallbackModel: getContentBlockFallbackModelMock,
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
  // A model key that never matches a fixture's modelKey below -- resolveReasoningLevel's task
  // branch then never fires unless a test deliberately configures otherwise, matching
  // getModelConfig's real "no row configured for this task" fallback shape.
  getModelConfigMock.mockResolvedValue({ model: 'unconfigured-task-default', temperature: null, reasoningLevel: null });
  getContentBlockFallbackModelMock.mockResolvedValue(null);
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

describe('thinking level resolution', () => {
  it('sends the task override to the adapter when the resolved record is the model the task is configured to run on', async () => {
    getTextModelRegistryMock.mockResolvedValue([
      makeRecord({ capabilities: { structuredOutput: 'json', vision: true, temperature: true, reasoningLevels: ['low', 'medium'] } }),
    ]);
    getModelConfigMock.mockResolvedValue({ model: 'openrouter:qwen/qwen3.7-flash', temperature: null, reasoningLevel: 'low' });
    const fetchMock = vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await generateText({ taskKey: 'story_generation', modelKey: 'openrouter:qwen/qwen3.7-flash', prompt: 'hi' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning).toEqual({ effort: 'low' });
  });

  it('falls back to the model default level when the task has no override', async () => {
    getTextModelRegistryMock.mockResolvedValue([
      makeRecord({
        defaultParams: { reasoningLevel: 'medium' },
        capabilities: { structuredOutput: 'json', vision: true, temperature: true, reasoningLevels: ['low', 'medium'] },
      }),
    ]);
    getModelConfigMock.mockResolvedValue({ model: 'openrouter:qwen/qwen3.7-flash', temperature: null, reasoningLevel: null });
    const fetchMock = vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await generateText({ taskKey: 'story_generation', modelKey: 'openrouter:qwen/qwen3.7-flash', prompt: 'hi' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning).toEqual({ effort: 'medium' });
  });

  it('sends nothing when the resolved record lists no reasoning levels at all', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]); // no capabilities.reasoningLevels
    getModelConfigMock.mockResolvedValue({ model: 'openrouter:qwen/qwen3.7-flash', temperature: null, reasoningLevel: 'low' });
    const fetchMock = vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await generateText({ taskKey: 'story_generation', modelKey: 'openrouter:qwen/qwen3.7-flash', prompt: 'hi' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect('reasoning' in body).toBe(false);
  });

  it('a fallback resolution does not inherit the thinking level meant for the originally configured (now-disabled) model', async () => {
    const disabledRecord = makeRecord({
      isEnabled: false,
      capabilities: { structuredOutput: 'json', vision: true, temperature: true, reasoningLevels: ['low', 'medium', 'high'] },
    });
    const geminiFallback = {
      ...GEMINI_DEFAULT_RECORD,
      capabilities: { structuredOutput: 'native' as const, vision: true, temperature: true, reasoningLevels: ['minimal', 'low', 'medium', 'high'] as const },
    };
    getTextModelRegistryMock.mockResolvedValue([disabledRecord, geminiFallback]);
    // The task is (still) configured to the now-disabled key, with a 'high' override -- that
    // override belongs to the disabled record, not to whatever fallback record actually runs.
    getModelConfigMock.mockResolvedValue({ model: 'openrouter:qwen/qwen3.7-flash', temperature: null, reasoningLevel: 'high' });
    generateContentMock.mockResolvedValue({
      text: 'plain text',
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await generateText({ taskKey: 'story_generation', modelKey: 'openrouter:qwen/qwen3.7-flash', prompt: 'hi' });

    const callArgs = generateContentMock.mock.calls[0][0] as { config: Record<string, unknown> };
    expect(callArgs.config.thinkingConfig).toBeUndefined();
  });
});

describe('telemetry: reasoning and temperature metadata', () => {
  it('records reasoningLevel and reasoningSource "task" alongside the level actually sent', async () => {
    getTextModelRegistryMock.mockResolvedValue([
      makeRecord({ capabilities: { structuredOutput: 'json', vision: true, temperature: true, reasoningLevels: ['low', 'medium'] } }),
    ]);
    getModelConfigMock.mockResolvedValue({ model: 'openrouter:qwen/qwen3.7-flash', temperature: null, reasoningLevel: 'low' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })));

    await generateText({
      taskKey: 'story_generation',
      modelKey: 'openrouter:qwen/qwen3.7-flash',
      prompt: 'hi',
      temperature: 0.5,
      telemetry: { activityKey: 'continue_story_new_beat' },
    });

    expect(recordModelCostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          reasoningLevel: 'low',
          reasoningSource: 'task',
          temperatureApplied: true,
          temperatureSent: 0.5,
        }),
      })
    );
  });

  it('records reasoningLevel: null and reasoningSource "provider_default" when nothing resolves', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })));

    await generateText({
      taskKey: 'story_generation',
      modelKey: 'openrouter:qwen/qwen3.7-flash',
      prompt: 'hi',
      telemetry: { activityKey: 'continue_story_new_beat' },
    });

    expect(recordModelCostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reasoningLevel: null, reasoningSource: 'provider_default' }),
      })
    );
  });

  it('records temperatureSent: 1 for Gemini regardless of the request temperature, and temperatureApplied: false', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD]);
    generateContentMock.mockResolvedValue({
      text: 'hello',
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
    });

    await generateText({
      taskKey: 'story_generation',
      modelKey: 'gemini-3.5-flash',
      prompt: 'hi',
      temperature: 0.2,
      telemetry: { activityKey: 'continue_story_new_beat' },
    });

    expect(recordModelCostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ temperatureSent: 1 }),
      })
    );
  });

  it('records temperatureSent: null for a non-Gemini provider when no temperature was applied', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })));

    await generateText({
      taskKey: 'story_generation',
      modelKey: 'openrouter:qwen/qwen3.7-flash',
      prompt: 'hi',
      telemetry: { activityKey: 'continue_story_new_beat' },
    });

    expect(recordModelCostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ temperatureApplied: false, temperatureSent: null }),
      })
    );
  });
});

describe('failed-attempt cost logging', () => {
  it('a Gemini content block records one failed cost event with category, providerReason and usage', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD]);
    generateContentMock.mockResolvedValue({
      text: '',
      promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 0 },
    });

    await expect(generateText({
      taskKey: 'story_generation',
      modelKey: 'gemini-3.5-flash',
      prompt: 'hi',
      telemetry: { activityKey: 'continue_story_new_beat' },
    })).rejects.toMatchObject({ category: 'content_blocked' });

    expect(recordModelCostEventMock).toHaveBeenCalledTimes(1);
    expect(recordModelCostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        inputTokens: 8,
        outputTokens: 0,
        metadata: expect.objectContaining({
          errorCategory: 'content_blocked',
          providerReason: 'prompt_blocked:PROHIBITED_CONTENT',
        }),
      })
    );
  });

  it('a non-Gemini malformed_output failure records the tokens the response already spent', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'not json' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 40, completion_tokens: 15 },
    })));

    await expect(generateText({
      taskKey: 'story_generation',
      modelKey: 'openrouter:qwen/qwen3.7-flash',
      prompt: 'hi',
      schema: optionsRegenerationSchema,
      telemetry: { activityKey: 'continue_story_new_beat' },
    })).rejects.toMatchObject({ category: 'malformed_output' });

    expect(recordModelCostEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        inputTokens: 40,
        outputTokens: 15,
        metadata: expect.objectContaining({ errorCategory: 'malformed_output' }),
      })
    );
  });

  it('a throwing cost recorder never replaces the original error', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchFail(429)));
    recordModelCostEventMock.mockRejectedValueOnce(new Error('cost log is down'));

    await expect(generateText({
      taskKey: 'story_generation',
      modelKey: 'openrouter:qwen/qwen3.7-flash',
      prompt: 'hi',
      telemetry: { activityKey: 'continue_story_new_beat' },
    })).rejects.toMatchObject({ category: 'rate_limited' });
  });

  it('no telemetry on the request means no cost event is recorded for a failed attempt', async () => {
    getTextModelRegistryMock.mockResolvedValue([makeRecord()]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchFail(429)));

    await expect(generateText({ taskKey: 'story_generation', modelKey: 'openrouter:qwen/qwen3.7-flash', prompt: 'hi' }))
      .rejects.toMatchObject({ category: 'rate_limited' });
    expect(recordModelCostEventMock).not.toHaveBeenCalled();
  });

  it('a successful attempt still records exactly one event, with no failed status -- success path unchanged', async () => {
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
    });

    expect(recordModelCostEventMock).toHaveBeenCalledTimes(1);
    const call = recordModelCostEventMock.mock.calls[0][0];
    expect(call.status).toBeUndefined();
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

describe('content-block fallback (Phase B)', () => {
  function blockedGeminiResponse() {
    return {
      text: '',
      promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 0 },
    };
  }

  it('a blocked primary retries the configured fallback: two cost events, the second carrying contentBlockFallback', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD, makeRecord()]);
    getContentBlockFallbackModelMock.mockResolvedValue('openrouter:qwen/qwen3.7-flash');
    generateContentMock.mockResolvedValue(blockedGeminiResponse());
    const fetchMock = vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateText({
      taskKey: 'story_generation',
      modelKey: 'gemini-3.5-flash',
      prompt: 'hi',
      telemetry: { activityKey: 'continue_story_new_beat' },
    });

    expect(result.text).toBe('hello');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recordModelCostEventMock).toHaveBeenCalledTimes(2);
    expect(recordModelCostEventMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'failed', modelId: 'gemini-3.5-flash', metadata: expect.objectContaining({ errorCategory: 'content_blocked' }) })
    );
    expect(recordModelCostEventMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        modelId: 'openrouter:qwen/qwen3.7-flash',
        metadata: expect.objectContaining({ contentBlockFallback: true, blockedModelKey: 'gemini-3.5-flash', blockedReason: 'prompt_blocked:PROHIBITED_CONTENT' }),
      })
    );
  });

  it('a fallback that is itself blocked throws that SECOND error, not the original', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD, makeRecord()]);
    getContentBlockFallbackModelMock.mockResolvedValue('openrouter:qwen/qwen3.7-flash');
    generateContentMock.mockResolvedValue(blockedGeminiResponse());
    const fetchMock = vi.fn().mockResolvedValue(fetchOk({
      choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateText({ taskKey: 'story_generation', modelKey: 'gemini-3.5-flash', prompt: 'hi' })
    ).rejects.toMatchObject({ category: 'content_blocked', modelKey: 'openrouter:qwen/qwen3.7-flash' });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a fallback that fails a different way throws the ORIGINAL content-block error', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD, makeRecord()]);
    getContentBlockFallbackModelMock.mockResolvedValue('openrouter:qwen/qwen3.7-flash');
    generateContentMock.mockResolvedValue(blockedGeminiResponse());
    const fetchMock = vi.fn().mockResolvedValue(fetchFail(429));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateText({ taskKey: 'story_generation', modelKey: 'gemini-3.5-flash', prompt: 'hi' })
    ).rejects.toMatchObject({ category: 'content_blocked', modelKey: 'gemini-3.5-flash' });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('no fallback configured -- exactly one provider call, no fetch', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD]);
    getContentBlockFallbackModelMock.mockResolvedValue(null);
    generateContentMock.mockResolvedValue(blockedGeminiResponse());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateText({ taskKey: 'story_generation', modelKey: 'gemini-3.5-flash', prompt: 'hi' })
    ).rejects.toMatchObject({ category: 'content_blocked', modelKey: 'gemini-3.5-flash' });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fallback key equal to the blocked model -- exactly one provider call', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD]);
    getContentBlockFallbackModelMock.mockResolvedValue('gemini-3.5-flash');
    generateContentMock.mockResolvedValue(blockedGeminiResponse());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateText({ taskKey: 'story_generation', modelKey: 'gemini-3.5-flash', prompt: 'hi' })
    ).rejects.toMatchObject({ category: 'content_blocked' });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fallback key disabled -- exactly one provider call', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD, makeRecord({ isEnabled: false })]);
    getContentBlockFallbackModelMock.mockResolvedValue('openrouter:qwen/qwen3.7-flash');
    generateContentMock.mockResolvedValue(blockedGeminiResponse());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateText({ taskKey: 'story_generation', modelKey: 'gemini-3.5-flash', prompt: 'hi' })
    ).rejects.toMatchObject({ category: 'content_blocked' });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fallback key not in the registry (invalid) -- exactly one provider call', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD]);
    getContentBlockFallbackModelMock.mockResolvedValue('openrouter:does-not-exist');
    generateContentMock.mockResolvedValue(blockedGeminiResponse());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateText({ taskKey: 'story_generation', modelKey: 'gemini-3.5-flash', prompt: 'hi' })
    ).rejects.toMatchObject({ category: 'content_blocked' });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fallback missing its required env var -- exactly one provider call', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD, makeRecord()]);
    getContentBlockFallbackModelMock.mockResolvedValue('openrouter:qwen/qwen3.7-flash');
    // First call is the primary attempt's own credential check (must pass); second is the
    // fallback's, inside attemptContentBlockFallback.
    getMissingEnvVarsMock.mockReturnValueOnce([]).mockReturnValueOnce(['OPENROUTER_API_KEY']);
    generateContentMock.mockResolvedValue(blockedGeminiResponse());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateText({ taskKey: 'story_generation', modelKey: 'gemini-3.5-flash', prompt: 'hi' })
    ).rejects.toMatchObject({ category: 'content_blocked' });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('strictModel never attempts a fallback -- exactly one provider call, fallback never even queried', async () => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_DEFAULT_RECORD]);
    generateContentMock.mockResolvedValue(blockedGeminiResponse());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateText({ taskKey: 'story_generation', modelKey: 'gemini-3.5-flash', prompt: 'hi', strictModel: true })
    ).rejects.toMatchObject({ category: 'content_blocked' });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getContentBlockFallbackModelMock).not.toHaveBeenCalled();
  });

  it('images requested but the fallback has no vision -- exactly one provider call', async () => {
    getTextModelRegistryMock.mockResolvedValue([
      GEMINI_DEFAULT_RECORD,
      makeRecord({ capabilities: { structuredOutput: 'json', vision: false, temperature: true } }),
    ]);
    getContentBlockFallbackModelMock.mockResolvedValue('openrouter:qwen/qwen3.7-flash');
    generateContentMock.mockResolvedValue(blockedGeminiResponse());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateText({
        taskKey: 'story_generation',
        modelKey: 'gemini-3.5-flash',
        prompt: 'hi',
        images: [{ mimeType: 'image/png', data: 'abc' }],
      })
    ).rejects.toMatchObject({ category: 'content_blocked' });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
