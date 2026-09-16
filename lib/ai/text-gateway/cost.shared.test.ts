import { describe, it, expect } from 'vitest';
import type { TextModelRecord } from '@/lib/ai/text-models.shared';
import { computeTextCostUsd } from './cost.shared';

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
    requiredEnvVars: [],
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: null,
    ...overrides,
  };
}

describe('computeTextCostUsd', () => {
  it('prefers usage.costUsd (OpenRouter\'s real charge) when present', () => {
    const record = makeRecord();
    const cost = computeTextCostUsd(record, { inputTokens: 1_000_000, outputTokens: 1_000_000, costUsd: 0.0099 });
    expect(cost).toBe(0.0099);
  });

  it('computes from row prices when usage.costUsd is absent', () => {
    const record = makeRecord({ inputCostPerMtokUsd: 1, outputCostPerMtokUsd: 2, cachedInputCostPerMtokUsd: null });
    const cost = computeTextCostUsd(record, { inputTokens: 1_000_000, outputTokens: 1_000_000, costUsd: null });
    expect(cost).toBeCloseTo(3, 6);
  });

  it('bills cached input tokens at the cached rate, not the regular input rate', () => {
    const record = makeRecord({ inputCostPerMtokUsd: 1, outputCostPerMtokUsd: 0, cachedInputCostPerMtokUsd: 0.1 });
    const cost = computeTextCostUsd(record, { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000, costUsd: null });
    expect(cost).toBeCloseTo(0.1, 6);
  });

  it('falls back to the regular input rate when cachedInputCostPerMtokUsd is null', () => {
    const record = makeRecord({ inputCostPerMtokUsd: 1, outputCostPerMtokUsd: 0, cachedInputCostPerMtokUsd: null });
    const cost = computeTextCostUsd(record, { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000, costUsd: null });
    expect(cost).toBeCloseTo(1, 6);
  });

  it('returns null when the row has no prices and no usage.costUsd (Gemini rows) -- caller falls back to estimateCost', () => {
    const record = makeRecord({ inputCostPerMtokUsd: null, outputCostPerMtokUsd: null, cachedInputCostPerMtokUsd: null });
    expect(computeTextCostUsd(record, { inputTokens: 100, outputTokens: 100, costUsd: null })).toBeNull();
  });
});
