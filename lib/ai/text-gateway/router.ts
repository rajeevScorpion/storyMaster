import 'server-only';

import { getFeatureFlagValue } from '@/lib/ai/model-config';
import { getMissingEnvVars, getTextModelRegistry } from '@/lib/ai/text-models';
import {
  TEXT_PROVIDER_ENV_VARS,
  TEXT_PROVIDER_LABELS,
  TEXT_PROVIDER_TELEMETRY_KEYS,
  resolveTextModel,
  type TextModelRecord,
  type TextModelResolution,
} from '@/lib/ai/text-models.shared';
import { recordModelCostEvent } from '@/lib/ai/cost-telemetry';
import { computeTextCostUsd } from './cost.shared';
import { extractJsonText, stripNullOptionals, validateAgainstGeminiSchema, type GeminiSchemaNode } from './json-schema.shared';
import { callGemini } from './gemini';
import { callOpenAiCompatible } from './openai-compatible';
import type { ParsedChatCompletionsResponse } from './openai-compatible.shared';
import { TextGatewayError, errorDetail, type TextGenerationRequest, type TextGenerationResult } from './types.shared';

const DEFAULT_TEXT_GATEWAY_TIMEOUT_MS = 30_000;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

async function resolveTimeoutMs(record: TextModelRecord): Promise<number> {
  if (typeof record.timeoutMs === 'number') return record.timeoutMs;
  // Same flag and parse semantics as the pre-gateway gemini-proxy.ts, now shared by every
  // provider until a per-model timeout_ms is set.
  const flagVal = await getFeatureFlagValue('gemini_text_timeout_ms');
  return (flagVal ? parseInt(flagVal, 10) : 0) || DEFAULT_TEXT_GATEWAY_TIMEOUT_MS;
}

function assertCredentials(record: TextModelRecord): void {
  const missing = getMissingEnvVars(record);
  if (missing.length > 0) {
    throw new TextGatewayError({
      category: 'auth_missing',
      providerKey: record.providerKey,
      modelKey: record.modelKey,
      retryable: false,
      // Names only, never values -- see lib/ai/text-models.ts's getMissingEnvVars.
      detail: `${TEXT_PROVIDER_LABELS[record.providerKey]} model "${record.modelKey}" is missing environment variable(s): ${missing.join(', ')}.`,
    });
  }
}

function apiKeyFor(record: TextModelRecord): string {
  return process.env[TEXT_PROVIDER_ENV_VARS[record.providerKey]] ?? '';
}

async function callProvider(
  record: TextModelRecord,
  request: TextGenerationRequest,
  timeoutMs: number
): Promise<ParsedChatCompletionsResponse> {
  return record.providerKey === 'gemini'
    ? callGemini(record, request, apiKeyFor(record), timeoutMs)
    : callOpenAiCompatible(record, request, apiKeyFor(record), timeoutMs);
}

/** Parses provider output, validates it against request.schema per model provider, and
 * returns the final text. Gemini is observe-only (plan 3.3: tightening it would change
 * live behaviour this change promises not to change); OpenAI/OpenRouter throw. */
function finalizeOutputText(
  rawText: string,
  record: TextModelRecord,
  request: TextGenerationRequest
): { text: string; schemaIssueCount: number } {
  const wantsJson = Boolean(request.schema) || Boolean(request.expectJson);
  if (!wantsJson) return { text: rawText, schemaIssueCount: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(rawText));
  } catch {
    parsed = undefined;
  }

  if (record.providerKey === 'gemini') {
    if (parsed === undefined) {
      console.warn('[text-gateway] gemini output was not valid JSON', { taskKey: request.taskKey, modelKey: record.modelKey });
      return { text: rawText, schemaIssueCount: -1 };
    }
    if (!request.schema) return { text: rawText, schemaIssueCount: 0 };
    const issues = validateAgainstGeminiSchema(parsed, request.schema as GeminiSchemaNode);
    if (issues.length > 0) {
      console.warn('[text-gateway] gemini schema mismatch', { taskKey: request.taskKey, modelKey: record.modelKey, issueCount: issues.length });
    }
    return { text: rawText, schemaIssueCount: issues.length };
  }

  if (parsed === undefined) {
    throw new TextGatewayError({
      category: 'malformed_output',
      providerKey: record.providerKey,
      modelKey: record.modelKey,
      retryable: false,
      detail: `${TEXT_PROVIDER_LABELS[record.providerKey]} model "${record.modelKey}" returned unparsable JSON for task ${request.taskKey}.`,
    });
  }
  if (!request.schema) return { text: JSON.stringify(parsed), schemaIssueCount: 0 };

  const issues = validateAgainstGeminiSchema(parsed, request.schema as GeminiSchemaNode);
  if (issues.length > 0) {
    throw new TextGatewayError({
      category: 'malformed_output',
      providerKey: record.providerKey,
      modelKey: record.modelKey,
      retryable: false,
      detail: `${TEXT_PROVIDER_LABELS[record.providerKey]} model "${record.modelKey}" output failed schema validation for task ${request.taskKey}: ${issues.slice(0, 3).join('; ')}`,
    });
  }
  return { text: JSON.stringify(stripNullOptionals(parsed, request.schema as GeminiSchemaNode)), schemaIssueCount: 0 };
}

export async function generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
  const registry = await getTextModelRegistry();
  const resolution = resolveTextModel({
    taskKey: request.taskKey,
    requestedKey: request.modelKey,
    registry,
    requireVision: request.requireVision ?? (request.images?.length ?? 0) > 0,
  });

  if (request.strictModel && resolution.source === 'fallback') {
    throw new TextGatewayError({
      category: 'model_unavailable',
      providerKey: resolution.record.providerKey,
      modelKey: request.modelKey,
      retryable: false,
      detail: `Model "${request.modelKey}" is not available for task ${request.taskKey}${resolution.fallbackReason ? ` (${resolution.fallbackReason})` : ''}.`,
    });
  }

  const { record } = resolution;
  // Credential check before any network call -- resolveTextModel only picks the row,
  // it never touches process.env.
  assertCredentials(record);

  const timeoutMs = await resolveTimeoutMs(record);
  const startedAt = nowMs();
  let providerResult: ParsedChatCompletionsResponse;
  try {
    providerResult = await callProvider(record, request, timeoutMs);
  } catch (error) {
    logTiming(request.taskKey, record, nowMs() - startedAt, false, error);
    throw error;
  }
  const latencyMs = nowMs() - startedAt;
  logTiming(request.taskKey, record, latencyMs, true);

  const { text, schemaIssueCount } = finalizeOutputText(providerResult.text.trim(), record, request);
  const costUsd = computeTextCostUsd(record, providerResult.usage);

  if (request.telemetry) {
    await recordModelCostEvent({
      context: request.telemetry,
      taskKey: request.taskKey,
      modelId: record.modelKey,
      provider: TEXT_PROVIDER_TELEMETRY_KEYS[record.providerKey],
      inputTokens: providerResult.usage.inputTokens,
      outputTokens: providerResult.usage.outputTokens,
      latencyMs,
      estimatedCostUsdOverride: costUsd ?? undefined,
      metadata: {
        ...(request.telemetryMetadata ?? {}),
        providerModelId: record.providerModelId,
        actualModel: providerResult.actualModel,
        requestId: providerResult.requestId,
        cachedTokens: providerResult.usage.cachedInputTokens,
        reasoningTokens: providerResult.usage.reasoningTokens,
        finishReason: providerResult.finishReason,
        temperatureApplied: record.capabilities.temperature && typeof request.temperature === 'number',
        resolutionSource: resolution.source,
        fallbackReason: resolution.fallbackReason,
        requestedModelKey: request.modelKey,
        schemaIssueCount,
        costUnknown: costUsd === null,
      },
    });
  }

  return { text, usage: providerResult.usage, resolution };
}

function logTiming(taskKey: string, record: TextModelRecord, durationMs: number, success: boolean, error?: unknown): void {
  console.info(`[timing:text_gateway.${taskKey}]`, {
    durationMs: Math.round(durationMs),
    success,
    provider: record.providerKey,
    modelKey: record.modelKey,
    ...(error ? { message: errorDetail(error) } : {}),
  });
}

/** Admin "Test" button (P4b): runs one tiny prompt against a specific row, bypassing task
 * resolution entirely since the admin already picked the exact record to test. No telemetry. */
export async function testTextModel(record: TextModelRecord, prompt?: string): Promise<TextGenerationResult> {
  assertCredentials(record);
  const timeoutMs = await resolveTimeoutMs(record);
  const request: TextGenerationRequest = {
    taskKey: 'story_generation',
    modelKey: record.modelKey,
    prompt: prompt ?? 'Reply with the single word "ok".',
  };
  const providerResult = await callProvider(record, request, timeoutMs);
  return {
    text: providerResult.text.trim(),
    usage: providerResult.usage,
    resolution: { record, source: 'registry' } as TextModelResolution,
  };
}
