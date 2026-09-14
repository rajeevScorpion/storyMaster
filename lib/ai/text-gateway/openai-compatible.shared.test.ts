import { describe, it, expect } from 'vitest';
import type { TextModelRecord } from '@/lib/ai/text-models.shared';
import { optionsRegenerationSchema, storylineDiscoveryMetadataSchema } from '@/lib/ai/generation-schemas';
import { buildChatCompletionsBody, classifyHttpError, parseChatCompletionsResponse } from './openai-compatible.shared';
import type { TextGenerationRequest } from './types.shared';

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

function makeRequest(overrides: Partial<TextGenerationRequest> = {}): TextGenerationRequest {
  return {
    taskKey: 'story_generation',
    modelKey: 'openrouter:qwen/qwen3.7-flash',
    prompt: 'Write a beat.',
    ...overrides,
  };
}

describe('buildChatCompletionsBody', () => {
  it('omits temperature for a model whose capabilities reject it (Luna)', () => {
    const luna = makeRecord({
      providerKey: 'openai',
      modelKey: 'openai:gpt-5.6-luna',
      providerModelId: 'gpt-5.6-luna',
      capabilities: { structuredOutput: 'native', vision: true, temperature: false },
    });
    const body = buildChatCompletionsBody(luna, makeRequest({ temperature: 0.7 }));
    expect('temperature' in body).toBe(false);
  });

  it('includes temperature when the model supports it and a value is given', () => {
    const record = makeRecord();
    const body = buildChatCompletionsBody(record, makeRequest({ temperature: 0.5 }));
    expect(body.temperature).toBe(0.5);
  });

  it('json-mode capability (Qwen) uses json_object and appends the schema to the system message', () => {
    const record = makeRecord({ capabilities: { structuredOutput: 'json', vision: true, temperature: true } });
    const body = buildChatCompletionsBody(record, makeRequest({ schema: optionsRegenerationSchema, systemInstruction: 'Guardrail.' }));
    expect(body.response_format).toEqual({ type: 'json_object' });
    const messages = body.messages as Array<{ role: string; content: string }>;
    const system = messages.find((m) => m.role === 'system');
    expect(system?.content).toContain('Guardrail.');
    expect(system?.content).toContain('"options"');
  });

  it('native capability with a schema uses strict json_schema', () => {
    const record = makeRecord({ providerKey: 'openai', capabilities: { structuredOutput: 'native', vision: true, temperature: true } });
    const body = buildChatCompletionsBody(record, makeRequest({ schema: optionsRegenerationSchema, schemaName: 'options_regen' }));
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'options_regen', strict: true },
    });
    const jsonSchema = (body.response_format as any).json_schema.schema;
    expect(jsonSchema.additionalProperties).toBe(false);
  });

  it('OpenRouter adds provider.require_parameters and never a top-level models array when response_format is set', () => {
    const record = makeRecord();
    const body = buildChatCompletionsBody(record, makeRequest({ schema: optionsRegenerationSchema }));
    expect(body.provider).toEqual({ require_parameters: true });
    expect('models' in body).toBe(false);
  });

  it('OpenAI does not get provider.require_parameters', () => {
    const record = makeRecord({ providerKey: 'openai', capabilities: { structuredOutput: 'native', vision: true, temperature: true } });
    const body = buildChatCompletionsBody(record, makeRequest({ schema: optionsRegenerationSchema }));
    expect('provider' in body).toBe(false);
  });

  it('turns reference images into data URL content parts', () => {
    const record = makeRecord();
    const body = buildChatCompletionsBody(record, makeRequest({ images: [{ mimeType: 'image/png', data: 'AAA=' }] }));
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const user = messages.find((m) => m.role === 'user');
    expect(user?.content).toEqual([
      { type: 'text', text: 'Write a beat.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA=' } },
    ]);
  });

  it('sends max_completion_tokens only when defaultParams.maxOutputTokens is greater than 0', () => {
    const zero = makeRecord({ defaultParams: { maxOutputTokens: 0 } });
    expect('max_completion_tokens' in buildChatCompletionsBody(zero, makeRequest())).toBe(false);

    const unset = makeRecord({ defaultParams: {} });
    expect('max_completion_tokens' in buildChatCompletionsBody(unset, makeRequest())).toBe(false);

    const positive = makeRecord({ defaultParams: { maxOutputTokens: 512 } });
    expect(buildChatCompletionsBody(positive, makeRequest()).max_completion_tokens).toBe(512);
  });

  it('OpenAI reasoningLevel becomes reasoning_effort; OpenRouter becomes reasoning.effort, including "none"', () => {
    const openaiRecord = makeRecord({ providerKey: 'openai', defaultParams: { reasoningLevel: 'low' } });
    expect(buildChatCompletionsBody(openaiRecord, makeRequest()).reasoning_effort).toBe('low');

    const openrouterRecord = makeRecord({ defaultParams: { reasoningLevel: 'low' } });
    expect(buildChatCompletionsBody(openrouterRecord, makeRequest()).reasoning).toEqual({ effort: 'low' });

    const openrouterNone = makeRecord({ defaultParams: { reasoningLevel: 'none' } });
    expect(buildChatCompletionsBody(openrouterNone, makeRequest()).reasoning).toEqual({ effort: 'none' });
  });

  it('neither provider sends a reasoning field when the model has no default level', () => {
    const openaiRecord = makeRecord({ providerKey: 'openai', defaultParams: {} });
    expect('reasoning_effort' in buildChatCompletionsBody(openaiRecord, makeRequest())).toBe(false);

    const openrouterRecord = makeRecord({ defaultParams: {} });
    expect('reasoning' in buildChatCompletionsBody(openrouterRecord, makeRequest())).toBe(false);
  });

  it('a "none" structuredOutput model gets no response_format, and the schema shape is described in the prompt instead', () => {
    const record = makeRecord({ capabilities: { structuredOutput: 'none', vision: false, temperature: true } });
    const body = buildChatCompletionsBody(record, makeRequest({ schema: storylineDiscoveryMetadataSchema }));
    expect('response_format' in body).toBe(false);
    expect('provider' in body).toBe(false);
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages.find((m) => m.role === 'system')?.content).toContain('valid JSON');
  });
});

describe('parseChatCompletionsResponse', () => {
  it('parses text, usage, cached/reasoning tokens, cost, model and request id', () => {
    const parsed = parseChatCompletionsResponse({
      id: 'req-123',
      model: 'qwen/qwen3.7-flash',
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        cost: 0.0042,
        prompt_tokens_details: { cached_tokens: 10 },
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    });
    expect(parsed.text).toBe('{"ok":true}');
    expect(parsed.refusal).toBe(false);
    expect(parsed.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 10,
      reasoningTokens: 5,
      costUsd: 0.0042,
    });
    expect(parsed.actualModel).toBe('qwen/qwen3.7-flash');
    expect(parsed.requestId).toBe('req-123');
  });

  it('treats message.refusal as a refusal', () => {
    const parsed = parseChatCompletionsResponse({ choices: [{ message: { refusal: 'blocked' } }] });
    expect(parsed.refusal).toBe(true);
  });

  it('treats finish_reason content_filter as a refusal', () => {
    const parsed = parseChatCompletionsResponse({ choices: [{ message: {}, finish_reason: 'content_filter' }] });
    expect(parsed.refusal).toBe(true);
  });

  it('reports finishReason "length" only for that finish reason', () => {
    const truncated = parseChatCompletionsResponse({ choices: [{ message: { content: 'x' }, finish_reason: 'length' }] });
    expect(truncated.finishReason).toBe('length');
    const stopped = parseChatCompletionsResponse({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] });
    expect(stopped.finishReason).toBeUndefined();
  });

  it('falls back to the x-request-id header when the body has no id', () => {
    const parsed = parseChatCompletionsResponse(
      { choices: [{ message: { content: 'x' } }] },
      { get: (name: string) => (name === 'x-request-id' ? 'hdr-1' : null) }
    );
    expect(parsed.requestId).toBe('hdr-1');
  });
});

describe('classifyHttpError', () => {
  const cases: Array<[number, string, boolean]> = [
    [400, 'bad_request', false],
    [401, 'auth_failed', false],
    [403, 'auth_failed', false],
    [402, 'insufficient_credits', false],
    [404, 'model_unavailable', false],
    [408, 'timeout', false],
    [504, 'timeout', false],
    [429, 'rate_limited', true],
    [502, 'model_unavailable', true],
    [503, 'model_unavailable', true],
    [500, 'provider_error', false],
  ];

  it.each(cases)('status %i -> %s (retryable: %s)', (status, category, retryable) => {
    expect(classifyHttpError(status)).toEqual({ category, retryable });
  });
});
