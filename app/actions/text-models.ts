'use server';

import { revalidatePath } from 'next/cache';
import { verifyAdmin } from '@/lib/supabase/admin';
import { getAllModelConfigs } from '@/lib/ai/model-config';
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
  NON_TEXT_MODEL_TASKS,
  TEXT_PROVIDER_LABELS,
  validateTextModelSelection,
  type TextModelRecord,
} from '@/lib/ai/text-models.shared';
import { testTextModel } from '@/lib/ai/text-gateway/router';
import { computeTextCostUsd } from '@/lib/ai/text-gateway/cost.shared';
import { TextGatewayError } from '@/lib/ai/text-gateway/types.shared';

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
}

export interface AdminTextModelRegistryState {
  available: boolean;
  records: AdminTextModelRecord[];
  taskStatus: TextTaskModelStatus[];
}

export interface TextModelOption {
  value: string;
  label: string;
  vision: boolean;
  temperature: boolean;
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
  const byTask = new Map(configs.map((config) => [config.taskKey, config.modelId]));
  return TASK_DEFINITIONS.filter((task) => !NON_TEXT_MODEL_TASKS.includes(task.key) && task.key !== 'story_text_overlay_alignment').map(
    (task) => {
      const configuredKey = byTask.get(task.key) ?? DEFAULT_MODELS[task.key].modelId;
      return {
        taskKey: task.key,
        label: task.label,
        configuredKey,
        problem: validateTextModelSelection(task.key, configuredKey, registry),
      };
    }
  );
}

export async function getAdminTextModelRegistry(): Promise<AdminTextModelRegistryState> {
  await verifyAdmin();
  const registry = await freshRegistry();
  return {
    available: registry !== null,
    records: (registry ?? []).map((record) => ({ ...record, missingEnvVars: getMissingEnvVars(record) })),
    taskStatus: await buildTaskStatus(registry),
  };
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
      error: error instanceof Error ? error.message : 'Unknown error',
      category: error instanceof TextGatewayError ? error.category : undefined,
    };
  }
}

/** Model picker options for a text task. Legacy Gemini list when migration 119 is absent. */
export async function getTextModelOptions(taskKey: TaskKey): Promise<TextModelOption[]> {
  await verifyAdmin();
  const registry = await getTextModelRegistry();
  if (!registry) {
    return KNOWN_MODELS.text.map((id) => ({ value: id, label: id, vision: true, temperature: true }));
  }
  return registry
    .filter((record) => record.isEnabled && validateTextModelSelection(taskKey, record.modelKey, registry) === null)
    .map((record) => ({
      value: record.modelKey,
      label: `${record.displayName} — ${TEXT_PROVIDER_LABELS[record.providerKey]}`,
      vision: record.capabilities.vision,
      temperature: record.capabilities.temperature,
    }));
}
