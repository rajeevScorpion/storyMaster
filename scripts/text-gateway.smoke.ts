import { loadEnv } from 'vite';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Type } from '@google/genai';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import { mapTextModelRow, type TextModelRecord, type TextModelRow } from '@/lib/ai/text-models.shared';

/**
 * Live smoke test for the text gateway (lib/ai/text-gateway/router.ts) against all three
 * real providers -- Gemini, OpenAI and OpenRouter. Unlike router.test.ts, nothing about the
 * provider call itself is mocked: only the text model registry (so the run doesn't depend on
 * migration 119 being applied or on any particular admin state), the timeout flag, and cost
 * telemetry are stubbed. A real API key and a real paid call happen for every provider whose
 * key is set.
 *
 * Two things are proved here:
 * 1. The original per-provider structured-output (JSON schema) smoke, via generateText --
 *    kept as-is except the Gemini case now runs gemini-3.8-flash (the old Gemini text models
 *    it used to test, gemini-2.5-flash-lite included, are removed from the product).
 * 2. Thinking control end-to-end (docs/text-model-thinking-plan.md 2.2/2.3), via
 *    testTextModel(record, prompt) against in-memory TextModelRecords -- no database writes --
 *    covering Gemini 3.8/3.5 Flash, Qwen 3.7 Flash (OpenRouter) and GPT-5.6 Luna (OpenAI) at
 *    several thinking levels, printing a results table in afterAll.
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
//
// lib/ai/model-config.ts (also importOriginal'd below, to keep its real getModelConfig) also
// imports createAdminClient at module scope. getModelConfig's own try/catch swallows this
// mock's throw and falls back to DEFAULT_MODELS (reasoningLevel: null) -- the same
// fail-closed path a real missing-migration or connectivity error takes -- so calling the
// real getModelConfig here never reaches the network.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('text-gateway smoke: createAdminClient should never be called (getTextModelRegistry/getModelConfig are stubbed or fail closed)');
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

vi.mock('@/lib/ai/model-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/model-config')>();
  return {
    ...actual,
    // Keep the real getModelConfig (router.ts's generateText now calls it to resolve a task's
    // thinking-level override -- see docs/text-model-thinking-plan.md 2.2). It fails closed to
    // DEFAULT_MODELS via the createAdminClient mock above, exactly like a real un-migrated or
    // unreachable database would. Only the feature-flag lookup is stubbed.
    getFeatureFlagValue: getFeatureFlagValueMock,
  };
});

vi.mock('@/lib/ai/cost-telemetry', () => ({
  recordModelCostEvent: recordModelCostEventMock,
}));

import { generateText, testTextModel } from '@/lib/ai/text-gateway/router';
import { computeTextCostUsd } from '@/lib/ai/text-gateway/cost.shared';
import { TextGatewayError, errorDetail, type TextGenerationResult } from '@/lib/ai/text-gateway/types.shared';
import { estimateCost } from '@/lib/ai/pricing';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Part 1: original structured-output (JSON schema) smoke, kept as-is except the Gemini
// record, which now runs gemini-3.8-flash -- gemini-2.5-flash-lite and every other Gemini
// text model older than 3.5 Flash are removed from the product (O-T3). Capabilities mirror
// migration 120's seed shape for the Gemini row: temperature fixed false, reasoningLevels set.

const GEMINI_RECORD = mapTextModelRow(
  buildRow({
    id: 'smoke-gemini',
    model_key: 'gemini-3.8-flash',
    provider_key: 'gemini',
    provider_model_id: 'gemini-3.8-flash',
    display_name: 'Gemini 3.8 Flash (smoke)',
    capabilities: { structuredOutput: 'native', vision: true, temperature: false, reasoningLevels: ['low', 'medium', 'high'] },
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
    default_params: { reasoningLevel: 'low' },
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

  it.skipIf(!GEMINI_KEY)('Gemini: gemini-3.8-flash answers with a valid structured JSON reply', async () => {
    await runProviderSmoke('gemini-3.8-flash', 'google_gemini');
  });

  it.skipIf(!OPENAI_KEY)('OpenAI: openai:gpt-5.6-luna answers with a valid structured JSON reply', async () => {
    await runProviderSmoke('openai:gpt-5.6-luna', 'openai');
  });

  it.skipIf(!OPENROUTER_KEY)('OpenRouter: openrouter:qwen/qwen3.7-flash answers with a valid structured JSON reply', async () => {
    // Same provider Qwen 429'd on under back-to-back calls (see Part 2) -- a small pre-pause
    // here costs nothing and avoids the two Qwen thinking-level cases below inheriting a
    // still-cooling-down rate limit from this one.
    await sleep(3000);
    await runProviderSmoke('openrouter:qwen/qwen3.7-flash', 'openrouter');
  });
});

// ─── Part 2: thinking control, live (docs/text-model-thinking-plan.md 2.2/2.3). Calls
// testTextModel(record, prompt) directly against in-memory TextModelRecords -- no database
// row is read or written. testTextModel resolves the model's own default reasoning level
// (there is no task in play to carry an override), so each record's defaultParams.reasoningLevel
// is what actually gets sent; a record with no reasoningLevel sends nothing (provider default).

const THINKING_PROMPT =
  "A fox is older than a crow. The crow is older than an owl. The owl is older than the fox's cousin, "
  + 'who is younger than everyone. Who is the second oldest? Answer with one word.';

const OPENROUTER_PRE_PAUSE_MS = 3000;
const RATE_LIMIT_RETRY_DELAY_MS = 10000;

interface ThinkingCaseResult {
  label: string;
  levelLabel: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  latencyMs: number;
  costUsd: number | null;
  costSource: 'provider' | 'row' | 'code_table' | 'unknown';
  answer: string;
  retried: boolean;
}

const thinkingResults: ThinkingCaseResult[] = [];

function resolveCost(record: TextModelRecord, usage: TextGenerationResult['usage']): { value: number | null; source: ThinkingCaseResult['costSource'] } {
  if (typeof usage.costUsd === 'number') return { value: usage.costUsd, source: 'provider' };
  const rowCost = computeTextCostUsd(record, usage);
  if (rowCost !== null) return { value: rowCost, source: 'row' };
  // Gemini rows seed both prices NULL by design (migration 119/120) -- fall back to the code
  // price table the rest of the app uses for Gemini cost estimation (lib/ai/pricing.ts).
  const estimated = estimateCost(record.providerModelId, usage.inputTokens, usage.outputTokens);
  return estimated > 0 ? { value: estimated, source: 'code_table' } : { value: null, source: 'unknown' };
}

function formatUsd(value: number | null): string {
  if (value === null) return '—';
  return value < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(4)}`;
}

async function runThinkingCase(params: {
  label: string;
  record: TextModelRecord;
  levelLabel: string;
  isOpenRouter?: boolean;
}): Promise<void> {
  const { label, record, levelLabel, isOpenRouter } = params;
  if (isOpenRouter) await sleep(OPENROUTER_PRE_PAUSE_MS);

  const attempt = async (): Promise<{ result: TextGenerationResult; latencyMs: number }> => {
    const startedAt = Date.now();
    const result = await testTextModel(record, THINKING_PROMPT);
    return { result, latencyMs: Date.now() - startedAt };
  };

  let retried = false;
  let outcome: { result: TextGenerationResult; latencyMs: number };
  try {
    outcome = await attempt();
  } catch (error) {
    if (error instanceof TextGatewayError && error.category === 'rate_limited') {
      retried = true;
      console.warn(`[text-gateway smoke] ${label}: rate_limited, retrying once after ${RATE_LIMIT_RETRY_DELAY_MS}ms -- detail: ${error.detail}`);
      await sleep(RATE_LIMIT_RETRY_DELAY_MS);
      outcome = await attempt();
    } else {
      console.error(`[text-gateway smoke] ${label}: FAILED -- ${errorDetail(error)}`);
      throw error;
    }
  }

  const { result, latencyMs } = outcome;
  expect(result.text.trim().length).toBeGreaterThan(0);
  expect(result.usage.inputTokens).toBeGreaterThan(0);
  expect(result.usage.outputTokens).toBeGreaterThan(0);

  const { value: costUsd, source: costSource } = resolveCost(record, result.usage);

  thinkingResults.push({
    label,
    levelLabel,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    reasoningTokens: result.usage.reasoningTokens ?? null,
    latencyMs: Math.round(latencyMs),
    costUsd,
    costSource,
    answer: result.text.trim().slice(0, 30),
    retried,
  });
}

const GEMINI_38_LOW = mapTextModelRow(
  buildRow({
    id: 'smoke-gemini-3.8-flash-low',
    model_key: 'gemini-3.8-flash',
    provider_key: 'gemini',
    provider_model_id: 'gemini-3.8-flash',
    display_name: 'Gemini 3.8 Flash (smoke, low)',
    capabilities: { structuredOutput: 'native', vision: true, temperature: false, reasoningLevels: ['low', 'medium', 'high'] },
    default_params: { reasoningLevel: 'low' },
    required_env_vars: ['GEMINI_API_KEY'],
  })
);

const GEMINI_38_PROVIDER_DEFAULT = mapTextModelRow(
  buildRow({
    id: 'smoke-gemini-3.8-flash-default',
    model_key: 'gemini-3.8-flash',
    provider_key: 'gemini',
    provider_model_id: 'gemini-3.8-flash',
    display_name: 'Gemini 3.8 Flash (smoke, no default)',
    capabilities: { structuredOutput: 'native', vision: true, temperature: false, reasoningLevels: ['low', 'medium', 'high'] },
    // No defaultParams.reasoningLevel -- resolveReasoningLevel sends nothing, Gemini's own
    // provider default (medium, per docs/text-model-thinking-plan.md section 1) applies.
    required_env_vars: ['GEMINI_API_KEY'],
  })
);

const GEMINI_35_MINIMAL = mapTextModelRow(
  buildRow({
    id: 'smoke-gemini-3.5-flash-minimal',
    model_key: 'gemini-3.5-flash',
    provider_key: 'gemini',
    provider_model_id: 'gemini-3.5-flash',
    display_name: 'Gemini 3.5 Flash (smoke, minimal)',
    capabilities: { structuredOutput: 'native', vision: true, temperature: false, reasoningLevels: ['minimal', 'low', 'medium', 'high'] },
    default_params: { reasoningLevel: 'minimal' },
    required_env_vars: ['GEMINI_API_KEY'],
  })
);

const QWEN_NONE = mapTextModelRow(
  buildRow({
    id: 'smoke-qwen-none',
    model_key: 'openrouter:qwen/qwen3.7-flash',
    provider_key: 'openrouter',
    provider_model_id: 'qwen/qwen3.7-flash',
    display_name: 'Qwen 3.7 Flash (smoke, none)',
    capabilities: { structuredOutput: 'json', vision: true, temperature: true, reasoningLevels: ['none', 'low', 'medium', 'high'] },
    default_params: { reasoningLevel: 'none' },
    timeout_ms: 60000,
    input_cost_per_mtok_usd: 0.03,
    output_cost_per_mtok_usd: 0.13,
    cached_input_cost_per_mtok_usd: 0.006,
    required_env_vars: ['OPENROUTER_API_KEY'],
  })
);

const QWEN_PROVIDER_DEFAULT = mapTextModelRow(
  buildRow({
    id: 'smoke-qwen-default',
    model_key: 'openrouter:qwen/qwen3.7-flash',
    provider_key: 'openrouter',
    provider_model_id: 'qwen/qwen3.7-flash',
    display_name: 'Qwen 3.7 Flash (smoke, no default)',
    capabilities: { structuredOutput: 'json', vision: true, temperature: true, reasoningLevels: ['none', 'low', 'medium', 'high'] },
    timeout_ms: 60000,
    input_cost_per_mtok_usd: 0.03,
    output_cost_per_mtok_usd: 0.13,
    cached_input_cost_per_mtok_usd: 0.006,
    required_env_vars: ['OPENROUTER_API_KEY'],
  })
);

const LUNA_NONE = mapTextModelRow(
  buildRow({
    id: 'smoke-luna-none',
    model_key: 'openai:gpt-5.6-luna',
    provider_key: 'openai',
    provider_model_id: 'gpt-5.6-luna',
    display_name: 'GPT-5.6 Luna (smoke, none)',
    capabilities: { structuredOutput: 'native', vision: true, temperature: false, reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
    default_params: { reasoningLevel: 'none' },
    timeout_ms: 120000,
    input_cost_per_mtok_usd: 0.2,
    output_cost_per_mtok_usd: 1.2,
    cached_input_cost_per_mtok_usd: 0.02,
    required_env_vars: ['OPENAI_API_KEY'],
  })
);

const LUNA_LOW = mapTextModelRow(
  buildRow({
    id: 'smoke-luna-low',
    model_key: 'openai:gpt-5.6-luna',
    provider_key: 'openai',
    provider_model_id: 'gpt-5.6-luna',
    display_name: 'GPT-5.6 Luna (smoke, low)',
    capabilities: { structuredOutput: 'native', vision: true, temperature: false, reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
    default_params: { reasoningLevel: 'low' },
    timeout_ms: 120000,
    input_cost_per_mtok_usd: 0.2,
    output_cost_per_mtok_usd: 1.2,
    cached_input_cost_per_mtok_usd: 0.02,
    required_env_vars: ['OPENAI_API_KEY'],
  })
);

describe.skipIf(!SHOULD_RUN)('text gateway live smoke — thinking levels (TEXT_GATEWAY_SMOKE=1)', () => {
  beforeAll(() => {
    getFeatureFlagValueMock.mockResolvedValue(null);
  });

  afterAll(() => {
    if (thinkingResults.length === 0) {
      console.info('[text-gateway smoke] thinking levels: no cases ran (all relevant provider keys missing?)');
      return;
    }
    console.info('\n[text-gateway smoke] thinking levels — results:');
    console.table(
      thinkingResults.map((r) => ({
        Case: r.label,
        Level: r.levelLabel,
        InTok: r.inputTokens,
        OutTok: r.outputTokens,
        ReasonTok: r.reasoningTokens ?? '—',
        LatencyMs: r.latencyMs,
        CostUSD: `${formatUsd(r.costUsd)}${r.costSource === 'code_table' ? ' (code table)' : ''}`,
        Retried: r.retried ? 'yes' : 'no',
        Answer: r.answer,
      }))
    );
  });

  it.skipIf(!GEMINI_KEY)('Gemini 3.8 Flash: low', async () => {
    await runThinkingCase({ label: 'Gemini 3.8 Flash', record: GEMINI_38_LOW, levelLabel: 'low' });
  });

  it.skipIf(!GEMINI_KEY)('Gemini 3.8 Flash: no default (provider default, medium)', async () => {
    await runThinkingCase({ label: 'Gemini 3.8 Flash', record: GEMINI_38_PROVIDER_DEFAULT, levelLabel: 'provider default (medium)' });
  });

  it.skipIf(!GEMINI_KEY)('Gemini 3.5 Flash: minimal', async () => {
    await runThinkingCase({ label: 'Gemini 3.5 Flash', record: GEMINI_35_MINIMAL, levelLabel: 'minimal' });
  });

  it.skipIf(!OPENROUTER_KEY)('Qwen 3.7 Flash (OpenRouter): none', async () => {
    await runThinkingCase({ label: 'Qwen 3.7 Flash (OpenRouter)', record: QWEN_NONE, levelLabel: 'none', isOpenRouter: true });
  });

  it.skipIf(!OPENROUTER_KEY)('Qwen 3.7 Flash (OpenRouter): no default (provider default)', async () => {
    await runThinkingCase({ label: 'Qwen 3.7 Flash (OpenRouter)', record: QWEN_PROVIDER_DEFAULT, levelLabel: 'provider default', isOpenRouter: true });
  });

  it.skipIf(!OPENAI_KEY)('GPT-5.6 Luna (OpenAI): none', async () => {
    await runThinkingCase({ label: 'GPT-5.6 Luna (OpenAI)', record: LUNA_NONE, levelLabel: 'none' });
  });

  it.skipIf(!OPENAI_KEY)('GPT-5.6 Luna (OpenAI): low', async () => {
    await runThinkingCase({ label: 'GPT-5.6 Luna (OpenAI)', record: LUNA_LOW, levelLabel: 'low' });
  });
});
