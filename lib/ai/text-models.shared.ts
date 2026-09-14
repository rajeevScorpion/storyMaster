// Pure, isomorphic half of the text model registry. See migration 119 and
// docs/text-model-gateway-plan.md section 3.2 for the resolution rules this encodes.

import { DEFAULT_MODELS, type TaskKey } from '@/lib/ai/model-config.shared';

export type TextProviderKey = 'gemini' | 'openai' | 'openrouter';

export type TextStructuredOutputSupport = 'native' | 'json' | 'none';

export interface TextModelCapabilities {
  structuredOutput: TextStructuredOutputSupport;
  vision: boolean;
  temperature: boolean;
}

export interface TextModelDefaultParams {
  maxOutputTokens?: number;
  reasoningEffort?: string;
  reasoningEnabled?: boolean;
}

export interface TextModelRecord {
  id: string;
  modelKey: string;
  providerKey: TextProviderKey;
  providerModelId: string;
  displayName: string;
  description: string;
  isEnabled: boolean;
  capabilities: TextModelCapabilities;
  defaultParams: TextModelDefaultParams;
  timeoutMs: number | null;
  inputCostPerMtokUsd: number | null;
  outputCostPerMtokUsd: number | null;
  cachedInputCostPerMtokUsd: number | null;
  requiredEnvVars: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

/** Raw `text_model_registry` row shape, as PostgREST returns it (snake_case, untyped JSONB). */
export interface TextModelRow {
  id: string;
  model_key: string;
  provider_key: string;
  provider_model_id: string;
  display_name: string;
  description: string | null;
  is_enabled: boolean;
  capabilities: unknown;
  default_params: unknown;
  timeout_ms: number | null;
  input_cost_per_mtok_usd: number | string | null;
  output_cost_per_mtok_usd: number | string | null;
  cached_input_cost_per_mtok_usd: number | string | null;
  required_env_vars: string[] | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export type TextModelResolutionSource = 'registry' | 'legacy' | 'fallback';
export type TextModelFallbackReason = 'unknown_model' | 'disabled' | 'missing_capability';

export interface TextModelResolution {
  record: TextModelRecord;
  source: TextModelResolutionSource;
  fallbackReason?: TextModelFallbackReason;
}

/** Admin-facing only. Never send provider identity to the browser (mirrors IMAGE_PROVIDER_LABELS). */
export const TEXT_PROVIDER_LABELS: Record<TextProviderKey, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
};

export const TEXT_PROVIDER_ENV_VARS: Record<TextProviderKey, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/** Provider label recorded on ai_cost_events, distinct from TEXT_PROVIDER_LABELS' display text. */
export const TEXT_PROVIDER_TELEMETRY_KEYS: Record<TextProviderKey, string> = {
  gemini: 'google_gemini',
  openai: 'openai',
  openrouter: 'openrouter',
};

const TEXT_PROVIDER_KEYS: readonly TextProviderKey[] = ['gemini', 'openai', 'openrouter'];

/** A bare Gemini id, as every model_config row predates this registry. Must stay identical to
 * resolveTextModel's legacy branch below -- it is the only thing standing between "no registry"
 * and a client-supplied id reaching a paid non-Gemini provider. */
export const LEGACY_GEMINI_MODEL_ID_PATTERN = /^gemini-[a-z0-9.-]+$/;

/** Same character classes as the SQL CHECK text_model_registry_model_key_format -- keep in sync. */
export const TEXT_MODEL_KEY_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,119}$/;

export const VISION_TEXT_TASKS: readonly TaskKey[] = [
  'graphic_style_extraction',
  'reference_character_analysis',
  'reference_world_analysis',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Garbage in, safe legacy-shaped defaults out -- a malformed admin edit must never crash resolution. */
function normalizeCapabilities(value: unknown): TextModelCapabilities {
  const source = isPlainObject(value) ? value : {};
  const structuredOutput: TextStructuredOutputSupport =
    source.structuredOutput === 'native' || source.structuredOutput === 'json' || source.structuredOutput === 'none'
      ? source.structuredOutput
      : 'none';
  return {
    structuredOutput,
    vision: typeof source.vision === 'boolean' ? source.vision : false,
    temperature: typeof source.temperature === 'boolean' ? source.temperature : true,
  };
}

function normalizeDefaultParams(value: unknown): TextModelDefaultParams {
  const source = isPlainObject(value) ? value : {};
  const params: TextModelDefaultParams = {};
  if (typeof source.maxOutputTokens === 'number' && Number.isFinite(source.maxOutputTokens)) {
    params.maxOutputTokens = Math.max(0, Math.floor(source.maxOutputTokens));
  }
  if (typeof source.reasoningEffort === 'string' && source.reasoningEffort.trim()) {
    params.reasoningEffort = source.reasoningEffort.trim();
  }
  if (typeof source.reasoningEnabled === 'boolean') {
    params.reasoningEnabled = source.reasoningEnabled;
  }
  return params;
}

function normalizeProviderKey(value: string): TextProviderKey {
  return (TEXT_PROVIDER_KEYS as readonly string[]).includes(value) ? (value as TextProviderKey) : 'gemini';
}

function toNullableNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

export function mapTextModelRow(row: TextModelRow): TextModelRecord {
  return {
    id: row.id,
    modelKey: row.model_key,
    providerKey: normalizeProviderKey(row.provider_key),
    providerModelId: row.provider_model_id,
    displayName: row.display_name,
    description: row.description ?? '',
    isEnabled: Boolean(row.is_enabled),
    capabilities: normalizeCapabilities(row.capabilities),
    defaultParams: normalizeDefaultParams(row.default_params),
    timeoutMs: row.timeout_ms ?? null,
    inputCostPerMtokUsd: toNullableNumber(row.input_cost_per_mtok_usd),
    outputCostPerMtokUsd: toNullableNumber(row.output_cost_per_mtok_usd),
    cachedInputCostPerMtokUsd: toNullableNumber(row.cached_input_cost_per_mtok_usd),
    requiredEnvVars: Array.isArray(row.required_env_vars) ? row.required_env_vars : [],
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? null,
  };
}

/**
 * A row for a Gemini id that has no registry row -- either migration 119 is absent (legacy mode)
 * or the id is the task's code default and was never seeded. Every code-default Gemini id is
 * assumed to have vision + native structured output + temperature, matching every seeded Gemini row.
 */
export function buildSyntheticGeminiRecord(modelId: string): TextModelRecord {
  const now = new Date().toISOString();
  return {
    id: `synthetic:${modelId}`,
    modelKey: modelId,
    providerKey: 'gemini',
    providerModelId: modelId,
    displayName: modelId,
    description: '',
    isEnabled: true,
    capabilities: { structuredOutput: 'native', vision: true, temperature: true },
    defaultParams: {},
    timeoutMs: null,
    inputCostPerMtokUsd: null,
    outputCostPerMtokUsd: null,
    cachedInputCostPerMtokUsd: null,
    requiredEnvVars: [TEXT_PROVIDER_ENV_VARS.gemini],
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  };
}

function fallbackResolution(
  taskKey: TaskKey,
  requestedKey: string,
  registry: TextModelRecord[] | null,
  reason: TextModelFallbackReason
): TextModelResolution {
  const defaultModelId = DEFAULT_MODELS[taskKey].modelId;
  // The emergency path uses the default's own row even if an admin disabled it -- disabling a
  // task's code default should not also delete the process's only way back to a working model.
  const record =
    registry?.find((candidate) => candidate.modelKey === defaultModelId) ?? buildSyntheticGeminiRecord(defaultModelId);
  console.warn('[text-gateway] fallback', { taskKey, requestedKey, reason });
  return { record, source: 'fallback', fallbackReason: reason };
}

export function resolveTextModel(input: {
  taskKey: TaskKey;
  requestedKey: string;
  registry: TextModelRecord[] | null;
  requireVision?: boolean;
}): TextModelResolution {
  const { taskKey, requestedKey, registry, requireVision } = input;

  if (registry === null) {
    // Legacy mode (migration 119 absent, or its read failed): only a bare Gemini id may run.
    // This is the one line standing between a client-supplied id and a paid non-Gemini call.
    if (LEGACY_GEMINI_MODEL_ID_PATTERN.test(requestedKey)) {
      return { record: buildSyntheticGeminiRecord(requestedKey), source: 'legacy' };
    }
    return fallbackResolution(taskKey, requestedKey, null, 'unknown_model');
  }

  const found = registry.find((record) => record.modelKey === requestedKey);
  if (!found) return fallbackResolution(taskKey, requestedKey, registry, 'unknown_model');
  if (!found.isEnabled) return fallbackResolution(taskKey, requestedKey, registry, 'disabled');
  if (requireVision && !found.capabilities.vision) {
    return fallbackResolution(taskKey, requestedKey, registry, 'missing_capability');
  }
  return { record: found, source: 'registry' };
}

/**
 * Codes only, deliberately -- classified by which query ran (this table's), never by the error
 * text, per GOTCHAS.md "Column-availability latches are per migration group". PGRST205 is
 * PostgREST's "table not in schema cache" variant of 42P01.
 */
export function isMissingTextModelRegistrySchemaError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === '42703' ||
    error.code === 'PGRST200' ||
    error.code === 'PGRST204' ||
    error.code === 'PGRST205'
  );
}

export function suggestModelKey(providerKey: TextProviderKey, providerModelId: string): string {
  return providerKey === 'gemini' ? providerModelId : `${providerKey}:${providerModelId}`;
}

/** Fields an admin create/update may supply. Every field optional so the same validator covers
 * both a full create payload and a partial patch (model_key is create-only; see plan 3.1). */
export interface TextModelInput {
  modelKey?: string;
  providerKey?: string;
  providerModelId?: string;
  displayName?: string;
  description?: string;
  capabilities?: Partial<TextModelCapabilities>;
  timeoutMs?: number | null;
  inputCostPerMtokUsd?: number | null;
  outputCostPerMtokUsd?: number | null;
  cachedInputCostPerMtokUsd?: number | null;
}

/** Mirrors the SQL CHECK constraints so a bad admin write fails in TypeScript, not at INSERT time. */
export function validateTextModelInput(input: TextModelInput): string[] {
  const issues: string[] = [];

  if (input.modelKey !== undefined && !TEXT_MODEL_KEY_PATTERN.test(input.modelKey)) {
    issues.push('model_key must match ^[a-z0-9][a-z0-9._:/-]{0,119}$');
  }
  if (input.providerKey !== undefined && !(TEXT_PROVIDER_KEYS as readonly string[]).includes(input.providerKey)) {
    issues.push(`provider_key must be one of ${TEXT_PROVIDER_KEYS.join(', ')}`);
  }
  if (input.providerModelId !== undefined) {
    const length = input.providerModelId.trim().length;
    if (length < 1 || length > 200) issues.push('provider_model_id must be 1-200 characters');
  }
  if (input.displayName !== undefined) {
    const length = input.displayName.trim().length;
    if (length < 1 || length > 120) issues.push('display_name must be 1-120 characters');
  }
  if (input.description !== undefined && input.description.length > 500) {
    issues.push('description must be at most 500 characters');
  }
  if (input.timeoutMs !== undefined && input.timeoutMs !== null) {
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 300000) {
      issues.push('timeout_ms must be between 1000 and 300000');
    }
  }
  for (const [field, value] of [
    ['input_cost_per_mtok_usd', input.inputCostPerMtokUsd],
    ['output_cost_per_mtok_usd', input.outputCostPerMtokUsd],
    ['cached_input_cost_per_mtok_usd', input.cachedInputCostPerMtokUsd],
  ] as const) {
    if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0)) {
      issues.push(`${field} must be a non-negative number`);
    }
  }
  if (input.capabilities) {
    const { structuredOutput, vision, temperature } = input.capabilities;
    if (structuredOutput !== undefined && structuredOutput !== 'native' && structuredOutput !== 'json' && structuredOutput !== 'none') {
      issues.push('capabilities.structuredOutput must be native, json, or none');
    }
    if (vision !== undefined && typeof vision !== 'boolean') issues.push('capabilities.vision must be a boolean');
    if (temperature !== undefined && typeof temperature !== 'boolean') issues.push('capabilities.temperature must be a boolean');
  }

  return issues;
}
