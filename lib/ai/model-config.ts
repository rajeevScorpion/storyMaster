import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Re-export shared types and constants for server-side consumers
export { type TaskKey, type ModelConfig, TASK_DEFINITIONS, DEFAULT_MODELS, KNOWN_MODELS } from './model-config.shared';
import { type TaskKey, type ModelConfig, DEFAULT_MODELS } from './model-config.shared';

// ── In-memory cache (60s TTL) ──────────────────────────────────
let cache: Map<string, { data: ModelConfig; ts: number }> = new Map();
const CACHE_TTL = 60_000;

function getCached(key: TaskKey): ModelConfig | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(config: ModelConfig) {
  cache.set(config.taskKey, { data: config, ts: Date.now() });
}

export function invalidateCache() {
  cache.clear();
}

// ── Public API ─────────────────────────────────────────────────

export async function getModelConfig(task: TaskKey): Promise<{ model: string; temperature: number | null }> {
  const cached = getCached(task);
  if (cached) return { model: cached.modelId, temperature: cached.temperature };

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('model_config')
      .select('task_key, model_id, temperature, updated_at')
      .eq('task_key', task)
      .single();

    if (error || !data) {
      const fallback = DEFAULT_MODELS[task];
      return { model: fallback.modelId, temperature: fallback.temperature };
    }

    const config: ModelConfig = {
      taskKey: data.task_key,
      modelId: data.model_id,
      temperature: data.temperature,
      updatedAt: data.updated_at,
    };
    setCache(config);
    return { model: config.modelId, temperature: config.temperature };
  } catch (err) {
    console.error('model-config: getModelConfig failed, using defaults:', err);
    const fallback = DEFAULT_MODELS[task];
    return { model: fallback.modelId, temperature: fallback.temperature };
  }
}

export async function getAllModelConfigs(): Promise<ModelConfig[]> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('model_config')
      .select('task_key, model_id, temperature, updated_at')
      .order('task_key');

    if (error || !data) {
      return Object.entries(DEFAULT_MODELS).map(([key, val]) => ({
        taskKey: key as TaskKey,
        modelId: val.modelId,
        temperature: val.temperature,
        updatedAt: new Date().toISOString(),
      }));
    }

    const configs = data.map((row) => ({
      taskKey: row.task_key as TaskKey,
      modelId: row.model_id,
      temperature: row.temperature,
      updatedAt: row.updated_at,
    }));

    configs.forEach(setCache);
    return configs;
  } catch (err) {
    console.error('model-config: getAllModelConfigs failed, using defaults:', err);
    return Object.entries(DEFAULT_MODELS).map(([key, val]) => ({
      taskKey: key as TaskKey,
      modelId: val.modelId,
      temperature: val.temperature,
      updatedAt: new Date().toISOString(),
    }));
  }
}

// ── Feature Flags ──────────────────────────────────────────────

let flagCache: Map<string, { data: boolean; ts: number }> = new Map();

export async function getFeatureFlag(flagKey: string, fallback = false): Promise<boolean> {
  const cached = flagCache.get(flagKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('flag_key', flagKey)
      .single();

    if (error || !data) return fallback;
    flagCache.set(flagKey, { data: data.enabled, ts: Date.now() });
    return data.enabled;
  } catch (err) {
    console.error('model-config: getFeatureFlag failed, using fallback:', err);
    return fallback;
  }
}

export async function setFeatureFlag(flagKey: string, enabled: boolean): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('feature_flags')
    .upsert({ flag_key: flagKey, enabled, updated_at: new Date().toISOString() });

  if (error) throw new Error(`Failed to set feature flag: ${error.message}`);
  flagCache.delete(flagKey);
}

let flagValueCache: Map<string, { data: string | null; ts: number }> = new Map();

export async function getFeatureFlagValue(flagKey: string): Promise<string | null> {
  const cached = flagValueCache.get(flagKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .select('value')
      .eq('flag_key', flagKey)
      .single();

    if (error || !data) return null;
    flagValueCache.set(flagKey, { data: data.value ?? null, ts: Date.now() });
    return data.value ?? null;
  } catch (err) {
    console.error('model-config: getFeatureFlagValue failed:', err);
    return null;
  }
}

export async function setFeatureFlagValue(flagKey: string, value: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('feature_flags')
    .upsert({ flag_key: flagKey, value, updated_at: new Date().toISOString() });

  if (error) throw new Error(`Failed to set feature flag value: ${error.message}`);
  flagValueCache.delete(flagKey);
}

export interface ConfigAudit {
  changedBy: string;
  experimentId?: string;
  reason?: string;
}

export async function updateModelConfig(
  taskKey: TaskKey,
  modelId: string,
  temperature: number | null,
  audit?: ConfigAudit
): Promise<void> {
  const supabase = createAdminClient();

  // Log to history if audit info provided
  if (audit) {
    const { data: current } = await supabase
      .from('model_config')
      .select('model_id, temperature')
      .eq('task_key', taskKey)
      .single();

    await supabase.from('model_config_history').insert({
      task_key: taskKey,
      old_model_id: current?.model_id ?? null,
      old_temperature: current?.temperature ?? null,
      new_model_id: modelId,
      new_temperature: temperature,
      changed_by: audit.changedBy,
      experiment_id: audit.experimentId ?? null,
      change_reason: audit.reason ?? null,
    });
  }

  const { error } = await supabase
    .from('model_config')
    .upsert({
      task_key: taskKey,
      model_id: modelId,
      temperature,
      updated_at: new Date().toISOString(),
    });

  if (error) throw new Error(`Failed to update model config: ${error.message}`);
  invalidateCache();
}
