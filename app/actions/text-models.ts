'use server';

import { revalidatePath } from 'next/cache';
import { verifyAdmin } from '@/lib/supabase/admin';
import { getAllModelConfigs, isReasoningLevelColumnAvailable, updateModelConfig, updateTaskReasoningLevel } from '@/lib/ai/model-config';
import { DEFAULT_MODELS, KNOWN_MODELS, TASK_DEFINITIONS, type TaskKey } from '@/lib/ai/model-config.shared';
import {
  createTextModelRecord,
  getMissingEnvVars,
  getTextModelRegistry,
  invalidateTextModelRegistryCache,
  updateTextModelRecord,
  type CreateTextModelInput,
  type TextModelPatch,
} from '@/lib/ai/text-models';
import {
  TEXT_PROVIDER_LABELS,
  TEXT_REASONING_LEVELS,
  isTextModelTask,
  validateTaskReasoningLevel,
  validateTextModelSelection,
  type TextProviderKey,
  type TextReasoningLevel,
  type TextModelRecord,
} from '@/lib/ai/text-models.shared';
import { testTextModel } from '@/lib/ai/text-gateway/router';
import { computeTextCostUsd } from '@/lib/ai/text-gateway/cost.shared';
import { TextGatewayError, errorDetail } from '@/lib/ai/text-gateway/types.shared';

// Admin-only. Every export re-checks verifyAdmin: provider identity and env status never reach
// a non-admin browser.

export interface AdminTextModelRecord extends TextModelRecord {
  missingEnvVars: string[];
}

export interface TextTaskModelStatus {
  taskKey: TaskKey;
  label: string;
  configuredKey: string;
  /** null when the configured key runs as-is; otherwise why the runtime falls back to the task default. */
  problem: string | null;
  /** The task's thinking-level override, or null when it has none (or migration 120 is absent). */
  reasoningLevel: TextReasoningLevel | null;
}

export interface AdminTextModelRegistryState {
  available: boolean;
  records: AdminTextModelRecord[];
  taskStatus: TextTaskModelStatus[];
  /** Whether model_config.reasoning_level (migration 120) can be read/written in this process. */
  reasoningOverridesAvailable: boolean;
}

export interface TextModelOption {
  value: string;
  label: string;
  vision: boolean;
  temperature: boolean;
  providerKey: TextProviderKey;
}

export interface AdminTextModelTestResult {
  ok: boolean;
  text?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number | null;
  error?: string;
  category?: string;
}

const TEXT_MODELS_PATH = '/admin/text-models';

async function freshRegistry(): Promise<TextModelRecord[] | null> {
  invalidateTextModelRegistryCache();
  return getTextModelRegistry();
}

async function buildTaskStatus(registry: TextModelRecord[] | null): Promise<TextTaskModelStatus[]> {
  const configs = await getAllModelConfigs();
  const byTask = new Map(configs.map((config) => [config.taskKey, config]));
  return TASK_DEFINITIONS.filter((task) => isTextModelTask(task.key)).map((task) => {
    const config = byTask.get(task.key);
    const configuredKey = config?.modelId ?? DEFAULT_MODELS[task.key].modelId;
    return {
      taskKey: task.key,
      label: task.label,
      configuredKey,
      problem: validateTextModelSelection(task.key, configuredKey, registry),
      reasoningLevel: config?.reasoningLevel ?? null,
    };
  });
}

export async function getAdminTextModelRegistry(): Promise<AdminTextModelRegistryState> {
  await verifyAdmin();
  const registry = await freshRegistry();
  return {
    available: registry !== null,
    records: (registry ?? []).map((record) => ({ ...record, missingEnvVars: getMissingEnvVars(record) })),
    taskStatus: await buildTaskStatus(registry),
    reasoningOverridesAvailable: await isReasoningLevelColumnAvailable(),
  };
}

/** Points any text task -- including the five agentic tasks, which have no dedicated picker --
 * at any enabled registry model. Runtime-validated because the studio calls this with a taskKey
 * that only TypeScript, not the browser, promises is a real TaskKey. */
export async function assignTextModelToTask(taskKey: TaskKey, modelKey: string): Promise<void> {
  await verifyAdmin();
  if (!isTextModelTask(taskKey)) {
    throw new Error(`"${taskKey}" is not a text task and cannot be assigned a text model here.`);
  }
  const registry = await freshRegistry();
  if (registry === null) {
    throw new Error('Migration 119 is not applied — assign models in the Story Playground.');
  }
  const problem = validateTextModelSelection(taskKey, modelKey, registry);
  if (problem) throw new Error(problem);

  const configs = await getAllModelConfigs();
  const current = configs.find((config) => config.taskKey === taskKey);
  const temperature = current?.temperature ?? DEFAULT_MODELS[taskKey].temperature;
  await updateModelConfig(taskKey, modelKey, temperature);

  // A thinking override belongs to the model it was set for. If the newly assigned model
  // doesn't list that level, it would silently stop applying (resolveReasoningLevel checks
  // record.modelKey === taskConfiguredKey) -- clear it explicitly instead of leaving a dead
  // override behind.
  if (current?.reasoningLevel) {
    const newRecord = registry.find((record) => record.modelKey === modelKey);
    const acceptedLevels = newRecord?.capabilities.reasoningLevels ?? [];
    if (!acceptedLevels.includes(current.reasoningLevel) && (await isReasoningLevelColumnAvailable())) {
      await updateTaskReasoningLevel(taskKey, null);
    }
  }

  revalidatePath(TEXT_MODELS_PATH);
  revalidatePath('/admin/agents/routing');
}

/** Sets (or clears, with `null`) a task's thinking-level override. Runtime-validated because the
 * browser is untrusted: neither `taskKey` nor `level` is guaranteed to be real by the time this
 * runs. `null` always clears the override; a concrete level must be one the task's currently
 * configured model actually lists. */
export async function setTaskReasoningLevel(taskKey: TaskKey, level: TextReasoningLevel | null): Promise<void> {
  await verifyAdmin();
  if (!isTextModelTask(taskKey)) {
    throw new Error(`"${taskKey}" is not a text task and cannot have a thinking override.`);
  }
  if (level !== null && !(TEXT_REASONING_LEVELS as readonly string[]).includes(level)) {
    throw new Error(`"${level}" is not a known thinking level.`);
  }

  if (level !== null) {
    const registry = await freshRegistry();
    const configs = await getAllModelConfigs();
    const configuredKey = configs.find((config) => config.taskKey === taskKey)?.modelId ?? DEFAULT_MODELS[taskKey].modelId;
    const configuredRecord = registry?.find((record) => record.modelKey === configuredKey);
    if (!configuredRecord) throw new Error(`"${configuredKey}" is not a known text model.`);
    const problem = validateTaskReasoningLevel(level, configuredRecord);
    if (problem) throw new Error(problem);
  }

  await updateTaskReasoningLevel(taskKey, level);
  revalidatePath(TEXT_MODELS_PATH);
}

export async function createAdminTextModel(input: CreateTextModelInput): Promise<void> {
  const { user } = await verifyAdmin();
  if (input.isEnabled && getMissingEnvVars({ providerKey: input.providerKey, requiredEnvVars: input.requiredEnvVars ?? [] }).length > 0) {
    throw new Error('Set the provider API key on the server before enabling this model.');
  }
  await createTextModelRecord(input, user.id);
  revalidatePath(TEXT_MODELS_PATH);
}

export async function updateAdminTextModel(id: string, patch: TextModelPatch): Promise<void> {
  const { user } = await verifyAdmin();
  if (patch.isEnabled) {
    const record = (await freshRegistry())?.find((candidate) => candidate.id === id);
    if (!record) throw new Error('Text model not found, or migration 119 is not applied.');
    const missing = getMissingEnvVars({ providerKey: record.providerKey, requiredEnvVars: patch.requiredEnvVars ?? record.requiredEnvVars });
    if (missing.length > 0) throw new Error(`Cannot enable: missing environment variable(s) ${missing.join(', ')}.`);
  }
  await updateTextModelRecord(id, patch, user.id);
  revalidatePath(TEXT_MODELS_PATH);
}

export async function testAdminTextModel(id: string): Promise<AdminTextModelTestResult> {
  await verifyAdmin();
  const record = (await freshRegistry())?.find((candidate) => candidate.id === id);
  if (!record) return { ok: false, latencyMs: 0, error: 'Text model not found.' };

  const startedAt = Date.now();
  try {
    const result = await testTextModel(record);
    return {
      ok: true,
      text: result.text.slice(0, 200),
      latencyMs: Date.now() - startedAt,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: computeTextCostUsd(record, result.usage),
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: errorDetail(error),
      category: error instanceof TextGatewayError ? error.category : undefined,
    };
  }
}

/** Model picker options for a text task. Legacy Gemini list when migration 119 is absent. */
export async function getTextModelOptions(taskKey: TaskKey): Promise<TextModelOption[]> {
  await verifyAdmin();
  const registry = await getTextModelRegistry();
  if (!registry) {
    return KNOWN_MODELS.text.map((id) => ({ value: id, label: id, vision: true, temperature: true, providerKey: 'gemini' as const }));
  }
  return registry
    .filter((record) => record.isEnabled && validateTextModelSelection(taskKey, record.modelKey, registry) === null)
    .map((record) => ({
      value: record.modelKey,
      label: `${record.displayName} — ${TEXT_PROVIDER_LABELS[record.providerKey]}`,
      vision: record.capabilities.vision,
      temperature: record.capabilities.temperature,
      providerKey: record.providerKey,
    }));
}
