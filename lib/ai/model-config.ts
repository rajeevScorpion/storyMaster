import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Re-export shared types and constants for server-side consumers
export {
  type TaskKey,
  type ModelConfig,
  TASK_DEFINITIONS,
  DEFAULT_MODELS,
  KNOWN_MODELS,
  DEFAULT_TEXT_MODEL_ID,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_TTS_MODEL_ID,
} from './model-config.shared';
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

/**
 * Batched sibling of {@link getFeatureFlag}: resolves many flags with a single
 * `.in()` query for cache misses (instead of one round-trip per flag). Warm
 * cache hits short-circuit; only real rows are cached, mirroring getFeatureFlag.
 */
export async function getFeatureFlags(
  flagKeys: readonly string[],
  fallback = false
): Promise<Record<string, boolean>> {
  const now = Date.now();
  const result: Record<string, boolean> = {};
  const missing: string[] = [];

  for (const key of flagKeys) {
    const cached = flagCache.get(key);
    if (cached && now - cached.ts < CACHE_TTL) {
      result[key] = cached.data;
    } else {
      missing.push(key);
    }
  }
  if (missing.length === 0) return result;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .select('flag_key, enabled')
      .in('flag_key', missing);

    if (error || !data) {
      for (const key of missing) result[key] = fallback;
      return result;
    }

    const found = new Map(data.map((row) => [row.flag_key, Boolean(row.enabled)]));
    for (const key of missing) {
      if (found.has(key)) {
        const enabled = found.get(key)!;
        result[key] = enabled;
        flagCache.set(key, { data: enabled, ts: now });
      } else {
        result[key] = fallback;
      }
    }
    return result;
  } catch (err) {
    console.error('model-config: getFeatureFlags failed, using fallback:', err);
    for (const key of missing) if (!(key in result)) result[key] = fallback;
    return result;
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

/**
 * Best-effort cache warmer for callers (e.g. the admin settings page) that read
 * many flags at once via getFeatureFlag/getFeatureFlagValue. A single `.in()`
 * query populates BOTH caches with exactly what those single-key getters would
 * have cached — `row.enabled` and `row.value ?? null` — so subsequent getter
 * calls short-circuit to the cache instead of doing one round-trip per key.
 *
 * Rows that don't exist are intentionally NOT cached, mirroring the getters
 * (which cache only real rows and otherwise apply their per-call fallback). It
 * follows that this warmer can never change a read result: warmed keys hold the
 * same value the getter would have fetched, and un-warmed keys fall through to
 * the getter unchanged. Failures are swallowed so warming stays best-effort.
 */
export async function warmFeatureFlagCaches(flagKeys: readonly string[]): Promise<void> {
  const now = Date.now();
  const missing = flagKeys.filter((key) => {
    const flagHit = flagCache.get(key);
    const valueHit = flagValueCache.get(key);
    return !(flagHit && now - flagHit.ts < CACHE_TTL && valueHit && now - valueHit.ts < CACHE_TTL);
  });
  if (missing.length === 0) return;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .select('flag_key, enabled, value')
      .in('flag_key', missing);

    if (error || !data) return;
    for (const row of data) {
      flagCache.set(row.flag_key, { data: row.enabled, ts: now });
      flagValueCache.set(row.flag_key, { data: row.value ?? null, ts: now });
    }
  } catch (err) {
    console.error('model-config: warmFeatureFlagCaches failed (non-fatal):', err);
  }
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
