import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  TEXT_PROVIDER_ENV_VARS,
  isMissingTextModelRegistrySchemaError,
  mapTextModelRow,
  validateTextModelInput,
  validateTextModelSelection,
  type TextModelCapabilities,
  type TextModelDefaultParams,
  type TextModelRecord,
  type TextModelRow,
  type TextProviderKey,
} from '@/lib/ai/text-models.shared';

// Re-export the shared half so both call sites and tests can import one module per side,
// mirroring lib/ai/model-config.ts's re-export of model-config.shared.
export {
  type TextProviderKey,
  type TextStructuredOutputSupport,
  type TextModelCapabilities,
  type TextModelDefaultParams,
  type TextModelRecord,
  type TextModelRow,
  type TextModelResolution,
  type TextModelResolutionSource,
  type TextModelFallbackReason,
  TEXT_PROVIDER_LABELS,
  TEXT_PROVIDER_ENV_VARS,
  TEXT_PROVIDER_TELEMETRY_KEYS,
  LEGACY_GEMINI_MODEL_ID_PATTERN,
  TEXT_MODEL_KEY_PATTERN,
  VISION_TEXT_TASKS,
  NON_TEXT_MODEL_TASKS,
  mapTextModelRow,
  buildSyntheticGeminiRecord,
  resolveTextModel,
  isMissingTextModelRegistrySchemaError,
  suggestModelKey,
  validateTextModelInput,
  validateTextModelSelection,
} from '@/lib/ai/text-models.shared';

// ── In-process cache (60s TTL), plus a permanent per-process latch ─────────────
//
// The latch is separate from the TTL cache on purpose: a missing-schema error means migration
// 119 is absent, and re-querying a missing table every 60s is pure waste. The cost: applying 119
// by hand does not take effect in a process that already latched -- restart the dev server or
// redeploy. Any OTHER error (network blip) is not latched; the next call tries again.
let cachedRegistry: TextModelRecord[] | null = null;
let cachedAt = 0;
let legacyModeLatched = false;
const CACHE_TTL_MS = 60_000;

export function invalidateTextModelRegistryCache(): void {
  cachedRegistry = null;
  cachedAt = 0;
}

export async function getTextModelRegistry(): Promise<TextModelRecord[] | null> {
  if (legacyModeLatched) return null;
  if (cachedRegistry && Date.now() - cachedAt < CACHE_TTL_MS) return cachedRegistry;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('text_model_registry')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      if (isMissingTextModelRegistrySchemaError(error)) {
        legacyModeLatched = true;
        return null;
      }
      console.error('text-models: getTextModelRegistry failed, treating as unavailable for this call:', error);
      return null;
    }

    const records = ((data ?? []) as TextModelRow[]).map(mapTextModelRow);
    cachedRegistry = records;
    cachedAt = Date.now();
    return records;
  } catch (err) {
    console.error('text-models: getTextModelRegistry threw, treating as unavailable for this call:', err);
    return null;
  }
}

export async function listTextModelRegistryForAdmin(): Promise<{ available: boolean; records: TextModelRecord[] }> {
  const registry = await getTextModelRegistry();
  return { available: registry !== null, records: registry ?? [] };
}

/** Missing env var NAMES only -- never values, never logged. The provider's own key is always
 * required, so a row saved with an empty required_env_vars cannot skip the credential check. */
export function getMissingEnvVars(record: Pick<TextModelRecord, 'requiredEnvVars' | 'providerKey'>): string[] {
  const names = new Set([TEXT_PROVIDER_ENV_VARS[record.providerKey], ...record.requiredEnvVars]);
  return [...names].filter((name) => !process.env[name]);
}

export interface CreateTextModelInput {
  modelKey: string;
  providerKey: TextProviderKey;
  providerModelId: string;
  displayName: string;
  description?: string;
  isEnabled?: boolean;
  capabilities: TextModelCapabilities;
  defaultParams?: TextModelDefaultParams;
  timeoutMs?: number | null;
  inputCostPerMtokUsd?: number | null;
  outputCostPerMtokUsd?: number | null;
  cachedInputCostPerMtokUsd?: number | null;
  requiredEnvVars?: string[];
  sortOrder?: number;
}

/** Allow-listed update fields. model_key, provider_key and provider_model_id are absent by
 * design -- they are the row's identity (plan 3.1: "model_key is immutable after creation").
 * Renaming any of them out from under a live model_config row would silently re-route it. */
export interface TextModelPatch {
  displayName?: string;
  description?: string;
  isEnabled?: boolean;
  capabilities?: TextModelCapabilities;
  defaultParams?: TextModelDefaultParams;
  timeoutMs?: number | null;
  inputCostPerMtokUsd?: number | null;
  outputCostPerMtokUsd?: number | null;
  cachedInputCostPerMtokUsd?: number | null;
  requiredEnvVars?: string[];
  sortOrder?: number;
}

export async function createTextModelRecord(input: CreateTextModelInput, userId: string | null): Promise<TextModelRecord> {
  const issues = validateTextModelInput({
    modelKey: input.modelKey,
    providerKey: input.providerKey,
    providerModelId: input.providerModelId,
    displayName: input.displayName,
    description: input.description,
    capabilities: input.capabilities,
    timeoutMs: input.timeoutMs,
    inputCostPerMtokUsd: input.inputCostPerMtokUsd,
    outputCostPerMtokUsd: input.outputCostPerMtokUsd,
    cachedInputCostPerMtokUsd: input.cachedInputCostPerMtokUsd,
  });
  if (issues.length > 0) throw new Error(`Invalid text model input: ${issues.join('; ')}`);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('text_model_registry')
    .insert({
      model_key: input.modelKey,
      provider_key: input.providerKey,
      provider_model_id: input.providerModelId,
      display_name: input.displayName.trim(),
      description: input.description?.trim() ?? '',
      is_enabled: input.isEnabled ?? false,
      capabilities: input.capabilities,
      default_params: input.defaultParams ?? {},
      timeout_ms: input.timeoutMs ?? null,
      input_cost_per_mtok_usd: input.inputCostPerMtokUsd ?? null,
      output_cost_per_mtok_usd: input.outputCostPerMtokUsd ?? null,
      cached_input_cost_per_mtok_usd: input.cachedInputCostPerMtokUsd ?? null,
      required_env_vars: input.requiredEnvVars ?? [],
      sort_order: input.sortOrder ?? 0,
      updated_by: userId,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create text model: ${error?.message ?? 'unknown error'}`);
  }

  invalidateTextModelRegistryCache();
  return mapTextModelRow(data as TextModelRow);
}

export async function updateTextModelRecord(
  id: string,
  patch: TextModelPatch,
  userId: string | null
): Promise<TextModelRecord> {
  const issues = validateTextModelInput({
    displayName: patch.displayName,
    description: patch.description,
    capabilities: patch.capabilities,
    timeoutMs: patch.timeoutMs,
    inputCostPerMtokUsd: patch.inputCostPerMtokUsd,
    outputCostPerMtokUsd: patch.outputCostPerMtokUsd,
    cachedInputCostPerMtokUsd: patch.cachedInputCostPerMtokUsd,
  });
  if (issues.length > 0) throw new Error(`Invalid text model input: ${issues.join('; ')}`);

  const update: Record<string, unknown> = { updated_by: userId };
  if (typeof patch.displayName === 'string') update.display_name = patch.displayName.trim();
  if (typeof patch.description === 'string') update.description = patch.description.trim();
  if (typeof patch.isEnabled === 'boolean') update.is_enabled = patch.isEnabled;
  if (patch.capabilities) update.capabilities = patch.capabilities;
  if (patch.defaultParams) update.default_params = patch.defaultParams;
  if (patch.timeoutMs !== undefined) update.timeout_ms = patch.timeoutMs;
  if (patch.inputCostPerMtokUsd !== undefined) update.input_cost_per_mtok_usd = patch.inputCostPerMtokUsd;
  if (patch.outputCostPerMtokUsd !== undefined) update.output_cost_per_mtok_usd = patch.outputCostPerMtokUsd;
  if (patch.cachedInputCostPerMtokUsd !== undefined) update.cached_input_cost_per_mtok_usd = patch.cachedInputCostPerMtokUsd;
  if (patch.requiredEnvVars) update.required_env_vars = patch.requiredEnvVars;
  if (typeof patch.sortOrder === 'number' && Number.isFinite(patch.sortOrder)) update.sort_order = Math.round(patch.sortOrder);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('text_model_registry')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to update text model: ${error?.message ?? id}`);
  }

  invalidateTextModelRegistryCache();
  return mapTextModelRow(data as TextModelRow);
}
