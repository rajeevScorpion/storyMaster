import { loadEnv } from 'vite';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Type } from '@google/genai';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import { mapTextModelRow, type TextModelRow } from '@/lib/ai/text-models.shared';

/**
 * Live smoke test for the text gateway (lib/ai/text-gateway/router.ts) against all three
 * real providers -- Gemini, OpenAI and OpenRouter. Unlike router.test.ts, nothing about the
 * provider call itself is mocked: only the text model registry (so the run doesn't depend on
 * migration 119 being applied or on any particular admin state), the timeout flag, and cost
 * telemetry are stubbed. A real API key and a real paid call happen for every provider whose
 * key is set.
 *
 * Gated behind TEXT_GATEWAY_SMOKE=1 so it never runs (and never spends) as part of `npm test`
 * or `npm run test:character-novelty-smoke`, both of which pick up every scripts/**\/*.smoke.ts
 * file via vitest.smoke.config.ts. Run explicitly:
 *
 *   TEXT_GATEWAY_SMOKE=1 npm run test:text-gateway-smoke
 *
 * Never print, log or assert on the raw key values -- only presence/absence.
 */

const SHOULD_RUN = process.env.TEXT_GATEWAY_SMOKE === '1';

vi.mock('server-only', () => ({}));

// lib/ai/text-models.ts (the module we importOriginal below, to keep its real
// getMissingEnvVars) imports createAdminClient from here at module scope. It is never
// actually called -- getTextModelRegistry is stubbed below -- but importing the real
// @/lib/supabase/admin would drag in @/lib/supabase/server's next/headers usage, which
// throws outside a Next.js request. Stub it out before it's ever reached.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('text-gateway smoke: createAdminClient should never be called (getTextModelRegistry is stubbed)');
  },
}));

const { getTextModelRegistryMock, getFeatureFlagValueMock, recordModelCostEventMock } = vi.hoisted(() => ({
  getTextModelRegistryMock: vi.fn(),
  getFeatureFlagValueMock: vi.fn(),
  recordModelCostEventMock: vi.fn(),
}));

vi.mock('@/lib/ai/text-models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/text-models')>();
  return {
    ...actual,
    // Keep the real getMissingEnvVars (credential gate) -- only the registry read is stubbed.
    getTextModelRegistry: getTextModelRegistryMock,
  };
});

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlagValue: getFeatureFlagValueMock,
}));

vi.mock('@/lib/ai/cost-telemetry', () => ({
  recordModelCostEvent: recordModelCostEventMock,
}));

import { generateText } from '@/lib/ai/text-gateway/router';

// Same .env.local loading convention as scripts/character-novelty.smoke.ts.
const fileEnv = loadEnv('development', process.cwd(), '');
function ensureEnv(name: string): string {
  const value = process.env[name] || fileEnv[name] || '';
  if (value) process.env[name] = value;
  return value;
}
const GEMINI_KEY = ensureEnv('GEMINI_API_KEY');
const OPENAI_KEY = ensureEnv('OPENAI_API_KEY');
const OPENROUTER_KEY = ensureEnv('OPENROUTER_API_KEY');

const NOW = new Date().toISOString();

function buildRow(overrides: Partial<TextModelRow>): TextModelRow {
  return {
    id: 'smoke-row',
    model_key: 'placeholder',
    provider_key: 'gemini',
    provider_model_id: 'placeholder',
    display_name: 'Placeholder',
    description: '',
    is_enabled: true,
    capabilities: {},
    default_params: {},
    timeout_ms: null,
    input_cost_per_mtok_usd: null,
    output_cost_per_mtok_usd: null,
    cached_input_cost_per_mtok_usd: null,
    required_env_vars: [],
    sort_order: 0,
    created_at: NOW,
    updated_at: NOW,
    updated_by: null,
    ...overrides,
  };
}

// The three records the plan (docs/text-model-gateway-plan.md section 3.3/P5) asks for,
// enabled, mirroring migration 119's seed shape but forced on regardless of the registry's
// live admin state.
const GEMINI_RECORD = mapTextModelRow(
  buildRow({
    id: 'smoke-gemini',
    model_key: 'gemini-2.5-flash-lite',
    provider_key: 'gemini',
    provider_model_id: 'gemini-2.5-flash-lite',
    display_name: 'Gemini 2.5 Flash-Lite (smoke)',
    capabilities: { structuredOutput: 'native', vision: true, temperature: true },
    required_env_vars: ['GEMINI_API_KEY'],
  })
);

const OPENAI_RECORD = mapTextModelRow(
  buildRow({
    id: 'smoke-openai',
    model_key: 'openai:gpt-5.6-luna',
    provider_key: 'openai',
    provider_model_id: 'gpt-5.6-luna',
    display_name: 'GPT-5.6 Luna (smoke)',
    capabilities: { structuredOutput: 'native', vision: true, temperature: false },
    default_params: { reasoningEffort: 'low' },
    timeout_ms: 120000,
    input_cost_per_mtok_usd: 0.2,
    output_cost_per_mtok_usd: 1.2,
    cached_input_cost_per_mtok_usd: 0.02,
    required_env_vars: ['OPENAI_API_KEY'],
  })
);

const OPENROUTER_RECORD = mapTextModelRow(
  buildRow({
    id: 'smoke-openrouter',
    model_key: 'openrouter:qwen/qwen3.7-flash',
    provider_key: 'openrouter',
    provider_model_id: 'qwen/qwen3.7-flash',
    display_name: 'Qwen 3.7 Flash (smoke)',
    capabilities: { structuredOutput: 'json', vision: true, temperature: true },
    timeout_ms: 60000,
    input_cost_per_mtok_usd: 0.03,
    output_cost_per_mtok_usd: 0.13,
    cached_input_cost_per_mtok_usd: 0.006,
    required_env_vars: ['OPENROUTER_API_KEY'],
  })
);

const SMOKE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    ok: { type: Type.BOOLEAN },
    word: { type: Type.STRING },
  },
  required: ['ok', 'word'],
};

async function runProviderSmoke(modelKey: string, providerTelemetryKey: string): Promise<void> {
  recordModelCostEventMock.mockClear();
  const telemetry: CostTelemetryContext = { activityKey: 'agentic_creator', metadata: { smokeTest: true } };

  const startedAt = Date.now();
  const result = await generateText({
    taskKey: 'story_generation',
    modelKey,
    prompt: 'Reply with a JSON object where "ok" is true and "word" is any single English word.',
    schema: SMOKE_SCHEMA,
    schemaName: 'smoke',
    temperature: 0.2,
    telemetry,
  });
  const latencyMs = Date.now() - startedAt;

  const parsed = JSON.parse(result.text) as { ok: unknown; word: unknown };
  expect(typeof parsed.ok).toBe('boolean');
  expect(typeof parsed.word).toBe('string');
  expect(result.usage.inputTokens).toBeGreaterThan(0);
  expect(result.usage.outputTokens).toBeGreaterThan(0);
  expect(result.resolution.source).toBe('registry');

  expect(recordModelCostEventMock).toHaveBeenCalledTimes(1);
  const telemetryCall = recordModelCostEventMock.mock.calls[0]![0] as {
    provider?: string;
    modelId?: string;
    estimatedCostUsdOverride?: number | null;
    metadata?: { actualModel?: string };
  };
  expect(telemetryCall.provider).toBe(providerTelemetryKey);
  expect(telemetryCall.modelId).toBe(modelKey);

  console.info(
    `[text-gateway smoke] ${modelKey}: latencyMs=${Math.round(latencyMs)} `
    + `inputTokens=${result.usage.inputTokens} outputTokens=${result.usage.outputTokens} `
    + `estimatedCostUsdOverride=${telemetryCall.estimatedCostUsdOverride ?? 'null'} `
    + `actualModel=${telemetryCall.metadata?.actualModel ?? 'unknown'}`
  );
}

describe.skipIf(!SHOULD_RUN)('text gateway live smoke (TEXT_GATEWAY_SMOKE=1)', () => {
  beforeAll(() => {
    getTextModelRegistryMock.mockResolvedValue([GEMINI_RECORD, OPENAI_RECORD, OPENROUTER_RECORD]);
    getFeatureFlagValueMock.mockResolvedValue(null);
    recordModelCostEventMock.mockResolvedValue(undefined);
  });

  it.skipIf(!GEMINI_KEY)('Gemini: gemini-2.5-flash-lite answers with a valid structured JSON reply', async () => {
    await runProviderSmoke('gemini-2.5-flash-lite', 'google_gemini');
  });

  it.skipIf(!OPENAI_KEY)('OpenAI: openai:gpt-5.6-luna answers with a valid structured JSON reply', async () => {
    await runProviderSmoke('openai:gpt-5.6-luna', 'openai');
  });

  it.skipIf(!OPENROUTER_KEY)('OpenRouter: openrouter:qwen/qwen3.7-flash answers with a valid structured JSON reply', async () => {
    await runProviderSmoke('openrouter:qwen/qwen3.7-flash', 'openrouter');
  });
});
