import 'server-only';

import { getFeatureFlagValue, getModelConfig } from '@/lib/ai/model-config';
import { getMissingEnvVars, getTextModelRegistry } from '@/lib/ai/text-models';
import {
  TEXT_PROVIDER_ENV_VARS,
  TEXT_PROVIDER_LABELS,
  TEXT_PROVIDER_TELEMETRY_KEYS,
  resolveReasoningLevel,
  resolveTextModel,
  type TextModelRecord,
  type TextModelResolution,
  type TextReasoningLevel,
} from '@/lib/ai/text-models.shared';
import { recordModelCostEvent } from '@/lib/ai/cost-telemetry';
import { computeTextCostUsd } from './cost.shared';
import { extractJsonText, stripNullOptionals, validateAgainstGeminiSchema, type GeminiSchemaNode } from './json-schema.shared';
import { callGemini } from './gemini';
import { callOpenAiCompatible } from './openai-compatible';
import type { ParsedChatCompletionsResponse } from './openai-compatible.shared';
import { TextGatewayError, errorDetail, type TextGenerationRequest, type TextGenerationResult, type TextUsage } from './types.shared';

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
  timeoutMs: number,
  reasoningLevel: TextReasoningLevel | undefined
): Promise<ParsedChatCompletionsResponse> {
  return record.providerKey === 'gemini'
    ? callGemini(record, request, apiKeyFor(record), timeoutMs, reasoningLevel)
    : callOpenAiCompatible(record, request, apiKeyFor(record), timeoutMs, reasoningLevel);
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

  // getModelConfig already fails closed to DEFAULT_MODELS (reasoningLevel: null) on any error --
  // a lookup failure here must never fail the call, and it doesn't. taskConfig.model is the
  // model the task is CURRENTLY configured to run on, which resolveReasoningLevel (inside
  // runTextAttempt) compares against the resolved record's own key so a task override never
  // leaks onto a persona override's model or the emergency fallback record (both of which can
  // legitimately differ). Resolved once here so a Phase B fallback attempt reuses the same
  // task-level config rather than re-reading it for a record it doesn't describe.
  const taskConfig = await getModelConfig(request.taskKey);

  return runTextAttempt(resolution.record, resolution, request, taskConfig);
}

/**
 * Runs one attempt against a resolved model record: credential check, thinking-level
 * resolution, the timed provider call, output finalization, and cost-event recording for
 * either outcome. Split out of generateText so a content-safety block can retry once on a
 * fallback model (Phase B) without duplicating any of this.
 */
async function runTextAttempt(
  record: TextModelRecord,
  resolution: TextModelResolution,
  request: TextGenerationRequest,
  taskConfig: { model: string; temperature: number | null; reasoningLevel: TextReasoningLevel | null },
  extraMetadata?: Record<string, unknown>
): Promise<TextGenerationResult> {
  const { level: reasoningLevel, source: reasoningSource } = resolveReasoningLevel({
    record,
    taskReasoningLevel: taskConfig.reasoningLevel,
    taskConfiguredKey: taskConfig.model,
  });

  const startedAt = nowMs();
  let providerResult: ParsedChatCompletionsResponse | undefined;

  try {
    // Credential check before any network call -- resolveTextModel only picks the row,
    // it never touches process.env.
    assertCredentials(record);
    const timeoutMs = await resolveTimeoutMs(record);

    try {
      providerResult = await callProvider(record, request, timeoutMs, reasoningLevel);
    } catch (error) {
      logTiming(request.taskKey, record, nowMs() - startedAt, false, error);
      throw error;
    }
    const latencyMs = nowMs() - startedAt;
    logTiming(request.taskKey, record, latencyMs, true);

    const { text, schemaIssueCount } = finalizeOutputText(providerResult.text.trim(), record, request);
    const costUsd = computeTextCostUsd(record, providerResult.usage);
    const temperatureApplied = record.capabilities.temperature && typeof request.temperature === 'number';
    // Gemini always sends 1 regardless of capabilities.temperature/request.temperature (O-T4);
    // every other provider sends the same value temperatureApplied describes, or nothing.
    const temperatureSent = record.providerKey === 'gemini' ? 1 : temperatureApplied ? (request.temperature as number) : null;

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
          temperatureApplied,
          temperatureSent,
          reasoningLevel: reasoningLevel ?? null,
          reasoningSource,
          resolutionSource: resolution.source,
          fallbackReason: resolution.fallbackReason,
          requestedModelKey: request.modelKey,
          schemaIssueCount,
          costUnknown: costUsd === null,
          ...(extraMetadata ?? {}),
        },
      });
    }

    return { text, usage: providerResult.usage, resolution };
  } catch (error) {
    await recordFailedAttempt({
      error,
      record,
      request,
      resolution,
      reasoningLevel,
      reasoningSource,
      latencyMs: nowMs() - startedAt,
      // finalizeOutputText can throw after a real response came back -- its TextGatewayError
      // carries no usage of its own, so the tokens that response already spent come from the
      // provider result instead.
      fallbackUsage: providerResult?.usage,
      extraMetadata,
    });
    throw error;
  }
}

/**
 * Writes a `status: 'failed'` cost event for one failed attempt, when the request carries
 * telemetry. Never throws -- a broken cost recorder must not replace the original error the
 * caller is about to (re)throw, so every failure here is swallowed and logged instead.
 */
async function recordFailedAttempt(input: {
  error: unknown;
  record: TextModelRecord;
  request: TextGenerationRequest;
  resolution: TextModelResolution;
  reasoningLevel: TextReasoningLevel | undefined;
  reasoningSource: string;
  latencyMs: number;
  fallbackUsage?: TextUsage;
  extraMetadata?: Record<string, unknown>;
}): Promise<void> {
  const { error, record, request, resolution, reasoningLevel, reasoningSource, latencyMs, fallbackUsage, extraMetadata } = input;
  const telemetry = request.telemetry;
  if (!telemetry) return;

  try {
    const gatewayError = error instanceof TextGatewayError ? error : undefined;
    const usage = gatewayError?.usage ?? fallbackUsage;

    await recordModelCostEvent({
      context: telemetry,
      taskKey: request.taskKey,
      modelId: record.modelKey,
      provider: TEXT_PROVIDER_TELEMETRY_KEYS[record.providerKey],
      status: 'failed',
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      latencyMs,
      estimatedCostUsdOverride: usage ? computeTextCostUsd(record, usage) ?? 0 : 0,
      metadata: {
        ...(request.telemetryMetadata ?? {}),
        providerModelId: record.providerModelId,
        errorCategory: gatewayError?.category ?? 'provider_error',
        errorDetail: errorDetail(error).slice(0, 500),
        providerReason: gatewayError?.providerReason,
        reasoningLevel: reasoningLevel ?? null,
        reasoningSource,
        resolutionSource: resolution.source,
        requestedModelKey: request.modelKey,
        ...(extraMetadata ?? {}),
      },
    });
  } catch (recordError) {
    console.error('[text-gateway] failed to record failed text-call cost event', errorDetail(recordError));
  }
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
 * resolution entirely since the admin already picked the exact record to test. No telemetry.
 * Thinking uses the model's own default only -- there is no task in play to have an override,
 * so both resolveReasoningLevel inputs that key off a task are null. */
export async function testTextModel(record: TextModelRecord, prompt?: string): Promise<TextGenerationResult> {
  assertCredentials(record);
  const timeoutMs = await resolveTimeoutMs(record);
  const request: TextGenerationRequest = {
    taskKey: 'story_generation',
    modelKey: record.modelKey,
    prompt: prompt ?? 'Reply with the single word "ok".',
  };
  const { level: reasoningLevel } = resolveReasoningLevel({ record, taskReasoningLevel: null, taskConfiguredKey: null });
  const providerResult = await callProvider(record, request, timeoutMs, reasoningLevel);
  return {
    text: providerResult.text.trim(),
    usage: providerResult.usage,
    resolution: { record, source: 'registry' } as TextModelResolution,
  };
}
