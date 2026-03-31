import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  type PromptTaskKey,
  type PromptTestRunRecord,
  PROMPT_TASK_DEFINITIONS,
  getDefaultPromptBody,
  validatePromptTemplate,
} from './prompt-config.shared';

export interface PublishedPromptConfig {
  taskKey: PromptTaskKey;
  promptBody: string;
  updatedAt: string | null;
  publishedBy: string | null;
  publishedNote: string | null;
  source: 'database' | 'default';
}

export interface PromptDraftRecord {
  taskKey: PromptTaskKey;
  adminUserId: string;
  promptBody: string;
  updatedAt: string;
}

export interface PromptHistoryEntry {
  id: string;
  taskKey: PromptTaskKey;
  promptBody: string;
  publishedAt: string;
  publishedBy: string | null;
  note: string | null;
}

export interface PromptPlaygroundState {
  taskKey: PromptTaskKey;
  published: PublishedPromptConfig;
  draft: {
    promptBody: string;
    updatedAt: string | null;
    source: 'draft' | 'published';
  };
  history: PromptHistoryEntry[];
  recentRuns: PromptTestRunRecord[];
}

interface PublishedPromptCacheEntry {
  prompt: PublishedPromptConfig;
  ts: number;
}

const CACHE_TTL = 60_000;
const publishedPromptCache = new Map<PromptTaskKey, PublishedPromptCacheEntry>();

function getCachedPublishedPrompt(taskKey: PromptTaskKey): PublishedPromptConfig | null {
  const entry = publishedPromptCache.get(taskKey);
  if (entry && Date.now() - entry.ts < CACHE_TTL) {
    return entry.prompt;
  }
  return null;
}

function setCachedPublishedPrompt(prompt: PublishedPromptConfig) {
  publishedPromptCache.set(prompt.taskKey, { prompt, ts: Date.now() });
}

function invalidatePublishedPrompt(taskKey: PromptTaskKey) {
  publishedPromptCache.delete(taskKey);
}

export async function getPublishedPromptRecord(taskKey: PromptTaskKey): Promise<PublishedPromptConfig> {
  const cached = getCachedPublishedPrompt(taskKey);
  if (cached) return cached;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('prompt_configs')
    .select('task_key, prompt_body, updated_at, published_by, published_note')
    .eq('task_key', taskKey)
    .maybeSingle();

  if (error || !data) {
    const fallback: PublishedPromptConfig = {
      taskKey,
      promptBody: getDefaultPromptBody(taskKey),
      updatedAt: null,
      publishedBy: null,
      publishedNote: null,
      source: 'default',
    };
    setCachedPublishedPrompt(fallback);
    return fallback;
  }

  const record: PublishedPromptConfig = {
    taskKey: data.task_key as PromptTaskKey,
    promptBody: data.prompt_body,
    updatedAt: data.updated_at,
    publishedBy: data.published_by,
    publishedNote: data.published_note,
    source: 'database',
  };
  setCachedPublishedPrompt(record);
  return record;
}

export async function getPublishedPrompt(taskKey: PromptTaskKey): Promise<string> {
  const record = await getPublishedPromptRecord(taskKey);
  return record.promptBody;
}

export async function getPromptPlaygroundState(taskKey: PromptTaskKey, adminUserId: string): Promise<PromptPlaygroundState> {
  const supabase = createAdminClient();
  const published = await getPublishedPromptRecord(taskKey);

  const [{ data: draft }, { data: history }, { data: runs }] = await Promise.all([
    supabase
      .from('prompt_drafts')
      .select('task_key, admin_user_id, prompt_body, updated_at')
      .eq('task_key', taskKey)
      .eq('admin_user_id', adminUserId)
      .maybeSingle(),
    supabase
      .from('prompt_history')
      .select('id, task_key, prompt_body, published_at, published_by, note')
      .eq('task_key', taskKey)
      .order('published_at', { ascending: false })
      .limit(12),
    supabase
      .from('prompt_test_runs')
      .select('id, task_key, created_by, prompt_body, model_id, temperature, inputs, output, output_type, latency_ms, input_tokens, output_tokens, estimated_cost_usd, created_at')
      .eq('task_key', taskKey)
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  return {
    taskKey,
    published,
    draft: draft
      ? {
          promptBody: draft.prompt_body,
          updatedAt: draft.updated_at,
          source: 'draft',
        }
      : {
          promptBody: published.promptBody,
          updatedAt: published.updatedAt,
          source: 'published',
        },
    history: (history || []).map((entry) => ({
      id: entry.id,
      taskKey: entry.task_key as PromptTaskKey,
      promptBody: entry.prompt_body,
      publishedAt: entry.published_at,
      publishedBy: entry.published_by,
      note: entry.note,
    })),
    recentRuns: (runs || []).map((run) => ({
      id: run.id,
      taskKey: run.task_key as PromptTaskKey,
      createdBy: run.created_by,
      promptBody: run.prompt_body,
      modelId: run.model_id,
      temperature: run.temperature,
      inputs: (run.inputs as Record<string, string>) || {},
      output: run.output,
      outputType: run.output_type as PromptTestRunRecord['outputType'],
      latencyMs: run.latency_ms,
      tokenCounts: typeof run.input_tokens === 'number' || typeof run.output_tokens === 'number'
        ? {
            input: run.input_tokens || 0,
            output: run.output_tokens || 0,
          }
        : undefined,
      estimatedCostUsd: run.estimated_cost_usd ?? undefined,
      createdAt: run.created_at,
    })),
  };
}

export async function savePromptDraft(taskKey: PromptTaskKey, adminUserId: string, promptBody: string): Promise<void> {
  const validation = validatePromptTemplate(taskKey, promptBody);
  if (!validation.isValid) {
    throw new Error(buildPromptValidationMessage(taskKey, validation.unknownPlaceholders, validation.missingRequiredPlaceholders));
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('prompt_drafts')
    .upsert({
      task_key: taskKey,
      admin_user_id: adminUserId,
      prompt_body: promptBody,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Failed to save prompt draft: ${error.message}`);
  }
}

export async function publishPromptDraft(taskKey: PromptTaskKey, adminUserId: string, note?: string | null): Promise<void> {
  const supabase = createAdminClient();
  const { data: draft, error: draftError } = await supabase
    .from('prompt_drafts')
    .select('prompt_body')
    .eq('task_key', taskKey)
    .eq('admin_user_id', adminUserId)
    .maybeSingle();

  if (draftError) {
    throw new Error(`Failed to load prompt draft: ${draftError.message}`);
  }

  const promptBody = draft?.prompt_body || getDefaultPromptBody(taskKey);
  const validation = validatePromptTemplate(taskKey, promptBody);
  if (!validation.isValid) {
    throw new Error(buildPromptValidationMessage(taskKey, validation.unknownPlaceholders, validation.missingRequiredPlaceholders));
  }

  const timestamp = new Date().toISOString();

  const { error: publishError } = await supabase
    .from('prompt_configs')
    .upsert({
      task_key: taskKey,
      prompt_body: promptBody,
      updated_at: timestamp,
      published_by: adminUserId,
      published_note: note || null,
    });

  if (publishError) {
    throw new Error(`Failed to publish prompt: ${publishError.message}`);
  }

  const { error: historyError } = await supabase
    .from('prompt_history')
    .insert({
      task_key: taskKey,
      prompt_body: promptBody,
      published_at: timestamp,
      published_by: adminUserId,
      note: note || null,
    });

  if (historyError) {
    throw new Error(`Failed to save prompt history: ${historyError.message}`);
  }

  invalidatePublishedPrompt(taskKey);
}

export async function restorePublishedVersionToDraft(taskKey: PromptTaskKey, versionId: string, adminUserId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('prompt_history')
    .select('prompt_body')
    .eq('id', versionId)
    .eq('task_key', taskKey)
    .single();

  if (error || !data) {
    throw new Error('Failed to load prompt history entry');
  }

  await savePromptDraft(taskKey, adminUserId, data.prompt_body);
}

export async function recordPromptTestRun(run: Omit<PromptTestRunRecord, 'id' | 'createdAt'>): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('prompt_test_runs')
    .insert({
      task_key: run.taskKey,
      created_by: run.createdBy,
      prompt_body: run.promptBody,
      model_id: run.modelId,
      temperature: run.temperature,
      inputs: run.inputs,
      output: run.output,
      output_type: run.outputType,
      latency_ms: run.latencyMs,
      input_tokens: run.tokenCounts?.input ?? null,
      output_tokens: run.tokenCounts?.output ?? null,
      estimated_cost_usd: run.estimatedCostUsd ?? null,
    });

  if (error) {
    throw new Error(`Failed to save prompt test run: ${error.message}`);
  }
}

function buildPromptValidationMessage(
  taskKey: PromptTaskKey,
  unknownPlaceholders: string[],
  missingRequiredPlaceholders: string[]
): string {
  const taskLabel = PROMPT_TASK_DEFINITIONS[taskKey].label;
  const parts: string[] = [`${taskLabel} template is invalid.`];

  if (unknownPlaceholders.length > 0) {
    parts.push(`Unknown placeholders: ${unknownPlaceholders.join(', ')}.`);
  }

  if (missingRequiredPlaceholders.length > 0) {
    parts.push(`Missing required placeholders: ${missingRequiredPlaceholders.join(', ')}.`);
  }

  return parts.join(' ');
}
