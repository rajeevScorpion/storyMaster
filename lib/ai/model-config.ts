import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { TEXT_REASONING_LEVELS, type TextReasoningLevel } from '@/lib/ai/text-models.shared';

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

// ── model_config.reasoning_level column-availability latch (migration 120) ───────────────
//
// Per GOTCHAS.md "Column-availability latches are per migration group": classify by which
// query ran, never by the error text alone. 42703 ("column does not exist") and PGRST204
// (PostgREST's schema-cache variant of the same thing) are generic codes that could in
// principle come from any missing column on any table -- but every query in this module that
// can raise them selects `reasoning_level` as its one migration-120 column, so either code
// from one of THOSE selects unambiguously means migration 120 is absent. getModelConfig's
// `.single()` also raises PGRST116 for "no row for this task_key", which is not a missing
// column and must NOT latch -- it already falls through to the DEFAULT_MODELS fallback the
// same way it did before this migration existed.
let reasoningLevelColumnUnavailable = false;
let reasoningLevelColumnChecked = false;

function isMissingReasoningLevelColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

function markReasoningLevelColumnAvailable() {
  reasoningLevelColumnChecked = true;
}

function markReasoningLevelColumnUnavailable() {
  reasoningLevelColumnUnavailable = true;
  reasoningLevelColumnChecked = true;
}

function normalizeStoredReasoningLevel(value: unknown): TextReasoningLevel | null {
  return typeof value === 'string' && (TEXT_REASONING_LEVELS as readonly string[]).includes(value)
    ? (value as TextReasoningLevel)
    : null;
}

type ModelConfigWideRow = { task_key: string; model_id: string; temperature: number | null; reasoning_level?: unknown; updated_at: string };
type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

/** One task's row, trying the wide (reasoning_level-including) select first and falling back
 * to the narrow, pre-120 column list on a missing-column error. A real error either way
 * (including PGRST116 "no row") is returned as-is for the caller to treat as "use defaults". */
async function selectModelConfigRow(
  supabase: SupabaseAdminClient,
  task: TaskKey
): Promise<{ data: ModelConfigWideRow | null; error: { code?: string; message?: string } | null }> {
  if (!reasoningLevelColumnUnavailable) {
    const wide = await supabase
      .from('model_config')
      .select('task_key, model_id, temperature, reasoning_level, updated_at')
      .eq('task_key', task)
      .single();
    if (!wide.error) {
      markReasoningLevelColumnAvailable();
      return wide;
    }
    if (isMissingReasoningLevelColumnError(wide.error)) {
      markReasoningLevelColumnUnavailable();
      // Fall through to the narrow retry below.
    } else {
      return wide;
    }
  }

  const narrow = await supabase
    .from('model_config')
    .select('task_key, model_id, temperature, updated_at')
    .eq('task_key', task)
    .single();
  return narrow;
}

/** All rows, same wide-then-narrow strategy as selectModelConfigRow. */
async function selectAllModelConfigRows(
  supabase: SupabaseAdminClient
): Promise<{ data: ModelConfigWideRow[] | null; error: { code?: string; message?: string } | null }> {
  if (!reasoningLevelColumnUnavailable) {
    const wide = await supabase
      .from('model_config')
      .select('task_key, model_id, temperature, reasoning_level, updated_at')
      .order('task_key');
    if (!wide.error) {
      markReasoningLevelColumnAvailable();
      return wide;
    }
    if (isMissingReasoningLevelColumnError(wide.error)) {
      markReasoningLevelColumnUnavailable();
      // Fall through to the narrow retry below.
    } else {
      return wide;
    }
  }

  const narrow = await supabase
    .from('model_config')
    .select('task_key, model_id, temperature, updated_at')
    .order('task_key');
  return narrow;
}

/** Whether model_config.reasoning_level can be read/written in this process. Probes once (via
 * getAllModelConfigs) if this process has not yet determined it either way; otherwise returns
 * the latched/known state without another round-trip. */
export async function isReasoningLevelColumnAvailable(): Promise<boolean> {
  if (!reasoningLevelColumnChecked) {
    await getAllModelConfigs();
  }
  return !reasoningLevelColumnUnavailable;
}

// ── Public API ─────────────────────────────────────────────────

export async function getModelConfig(
  task: TaskKey
): Promise<{ model: string; temperature: number | null; reasoningLevel: TextReasoningLevel | null }> {
  const cached = getCached(task);
  if (cached) return { model: cached.modelId, temperature: cached.temperature, reasoningLevel: cached.reasoningLevel };

  try {
    const supabase = createAdminClient();
    const { data, error } = await selectModelConfigRow(supabase, task);

    if (error?.code === 'PGRST116') {
      // No row for this task_key -- this is the ordinary DEFAULT_MODELS fallback (most agent_*
      // tasks, story bible, discovery metadata never get an explicit row), not a migration or
      // connectivity problem, so it is safe -- and worth doing -- to cache like any other
      // resolved config. Without this, a task with no row hits the database on every single
      // call the router makes for it, defeating the point of the 60s TTL cache below.
      const fallback = DEFAULT_MODELS[task];
      setCache({ taskKey: task, modelId: fallback.modelId, temperature: fallback.temperature, reasoningLevel: null, updatedAt: new Date().toISOString() });
      return { model: fallback.modelId, temperature: fallback.temperature, reasoningLevel: null };
    }

    if (error || !data) {
      // Any other error (missing column already handled inside selectModelConfigRow, transient
      // DB errors, etc.) falls back to defaults WITHOUT caching -- a real problem should be
      // retried on the very next call, not papered over for a minute.
      const fallback = DEFAULT_MODELS[task];
      return { model: fallback.modelId, temperature: fallback.temperature, reasoningLevel: null };
    }

    const config: ModelConfig = {
      taskKey: data.task_key as TaskKey,
      modelId: data.model_id,
      temperature: data.temperature,
      reasoningLevel: normalizeStoredReasoningLevel(data.reasoning_level),
      updatedAt: data.updated_at,
    };
    setCache(config);
    return { model: config.modelId, temperature: config.temperature, reasoningLevel: config.reasoningLevel };
  } catch (err) {
    console.error('model-config: getModelConfig failed, using defaults:', err);
    const fallback = DEFAULT_MODELS[task];
    return { model: fallback.modelId, temperature: fallback.temperature, reasoningLevel: null };
  }
}

export async function getAllModelConfigs(): Promise<ModelConfig[]> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await selectAllModelConfigRows(supabase);

    if (error || !data) {
      return Object.entries(DEFAULT_MODELS).map(([key, val]) => ({
        taskKey: key as TaskKey,
        modelId: val.modelId,
        temperature: val.temperature,
        reasoningLevel: null,
        updatedAt: new Date().toISOString(),
      }));
    }

    const configs = data.map((row) => ({
      taskKey: row.task_key as TaskKey,
      modelId: row.model_id,
      temperature: row.temperature,
      reasoningLevel: normalizeStoredReasoningLevel(row.reasoning_level),
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
      reasoningLevel: null,
      updatedAt: new Date().toISOString(),
    }));
  }
}

/**
 * Sets (or clears, with `null`) a task's per-task thinking-level override. Throws when
 * migration 120 is absent rather than silently writing nothing -- a write path must know its
 * write didn't happen, unlike a read path, which is expected to fail closed to defaults.
 * Upserts the full row so an update never blanks model_id/temperature: it carries forward the
 * existing row's values, or this task's code defaults when no row exists yet.
 */
export async function updateTaskReasoningLevel(taskKey: TaskKey, level: TextReasoningLevel | null): Promise<void> {
  const available = await isReasoningLevelColumnAvailable();
  if (!available) {
    throw new Error('Migration 120 is not applied.');
  }

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('model_config')
    .select('model_id, temperature')
    .eq('task_key', taskKey)
    .single();

  const fallback = DEFAULT_MODELS[taskKey];
  const modelId = existing?.model_id ?? fallback.modelId;
  const temperature = existing ? existing.temperature : fallback.temperature;

  const { error } = await supabase.from('model_config').upsert({
    task_key: taskKey,
    model_id: modelId,
    temperature,
    reasoning_level: level,
    updated_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Failed to update task reasoning level: ${error.message}`);
  invalidateCache();
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
