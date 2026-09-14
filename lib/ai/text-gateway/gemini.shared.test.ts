import { describe, it, expect, vi } from 'vitest';
import type { TextModelRecord } from '@/lib/ai/text-models.shared';
import { buildGeminiConfig, parseGeminiUsage } from './gemini.shared';
import type { TextGenerationRequest } from './types.shared';

const NOW = new Date().toISOString();

function makeRecord(overrides: Partial<TextModelRecord> = {}): TextModelRecord {
  return {
    id: 'row-gemini',
    modelKey: 'gemini-3.8-flash',
    providerKey: 'gemini',
    providerModelId: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    description: '',
    isEnabled: true,
    capabilities: { structuredOutput: 'native', vision: true, temperature: false, reasoningLevels: ['low', 'medium', 'high'] },
    defaultParams: {},
    timeoutMs: null,
    inputCostPerMtokUsd: null,
    outputCostPerMtokUsd: null,
    cachedInputCostPerMtokUsd: null,
    requiredEnvVars: ['GEMINI_API_KEY'],
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
    modelKey: 'gemini-3.8-flash',
    prompt: 'Write a beat.',
    ...overrides,
  };
}

describe('buildGeminiConfig', () => {
  it('always sends temperature 1, even when the request asks for 0.2', () => {
    const config = buildGeminiConfig(makeRecord(), makeRequest({ temperature: 0.2 }), undefined);
    expect(config.temperature).toBe(1);
  });

  it('always sends temperature 1 when the request has no temperature at all', () => {
    const config = buildGeminiConfig(makeRecord(), makeRequest(), undefined);
    expect(config.temperature).toBe(1);
  });

  it.each(['minimal', 'low', 'medium', 'high'] as const)('sends thinkingConfig.thinkingLevel %s uppercased', (level) => {
    const config = buildGeminiConfig(makeRecord(), makeRequest(), level);
    expect(config.thinkingConfig).toEqual({ thinkingLevel: level.toUpperCase() });
  });

  it('never sends thinkingBudget alongside thinkingLevel', () => {
    const config = buildGeminiConfig(makeRecord(), makeRequest(), 'medium');
    expect((config.thinkingConfig as Record<string, unknown>).thinkingBudget).toBeUndefined();
  });

  it('omits thinkingConfig when no level is resolved', () => {
    const config = buildGeminiConfig(makeRecord(), makeRequest(), undefined);
    expect('thinkingConfig' in config).toBe(false);
  });

  it.each(['none', 'xhigh', 'max'] as const)('omits thinkingConfig and warns for unsupported level %s', (level) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = buildGeminiConfig(makeRecord(), makeRequest(), level);
    expect('thinkingConfig' in config).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith('[text-gateway] gemini thinking level unsupported, omitting thinkingConfig', expect.objectContaining({ reasoningLevel: level }));
    warnSpy.mockRestore();
  });

  it('a schema request sets responseMimeType application/json and responseSchema', () => {
    const schema = { type: 'OBJECT' };
    const config = buildGeminiConfig(makeRecord(), makeRequest({ schema }), undefined);
    expect(config.responseMimeType).toBe('application/json');
    expect(config.responseSchema).toBe(schema);
  });

  it('expectJson with no schema sets responseMimeType application/json but no responseSchema', () => {
    const config = buildGeminiConfig(makeRecord(), makeRequest({ expectJson: true }), undefined);
    expect(config.responseMimeType).toBe('application/json');
    expect('responseSchema' in config).toBe(false);
  });

  it('plain text requests set responseMimeType text/plain', () => {
    const config = buildGeminiConfig(makeRecord(), makeRequest(), undefined);
    expect(config.responseMimeType).toBe('text/plain');
  });

  it('carries systemInstruction through when present', () => {
    const config = buildGeminiConfig(makeRecord(), makeRequest({ systemInstruction: 'Be terse.' }), undefined);
    expect(config.systemInstruction).toBe('Be terse.');
  });

  it('sends maxOutputTokens only when the record configures a positive value', () => {
    const zero = buildGeminiConfig(makeRecord({ defaultParams: { maxOutputTokens: 0 } }), makeRequest(), undefined);
    expect('maxOutputTokens' in zero).toBe(false);

    const positive = buildGeminiConfig(makeRecord({ defaultParams: { maxOutputTokens: 2048 } }), makeRequest(), undefined);
    expect(positive.maxOutputTokens).toBe(2048);
  });
});

describe('parseGeminiUsage', () => {
  it('adds thoughtsTokenCount into outputTokens and reports it as reasoningTokens', () => {
    const usage = parseGeminiUsage({ promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 25 });
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(65);
    expect(usage.reasoningTokens).toBe(25);
  });

  it('reasoningTokens is undefined when thoughtsTokenCount is 0 or absent', () => {
    expect(parseGeminiUsage({ promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 0 }).reasoningTokens).toBeUndefined();
    expect(parseGeminiUsage({ promptTokenCount: 10, candidatesTokenCount: 5 }).reasoningTokens).toBeUndefined();
  });

  it('carries cachedContentTokenCount through as cachedInputTokens', () => {
    expect(parseGeminiUsage({ promptTokenCount: 10, candidatesTokenCount: 5, cachedContentTokenCount: 3 }).cachedInputTokens).toBe(3);
  });

  it('costUsd is always null -- Gemini cost is computed from row prices, not reported by the provider', () => {
    expect(parseGeminiUsage({ promptTokenCount: 1, candidatesTokenCount: 1 }).costUsd).toBeNull();
  });

  it('handles a fully missing usageMetadata object', () => {
    expect(parseGeminiUsage(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: undefined,
      cachedInputTokens: undefined,
      costUsd: null,
    });
  });
});
