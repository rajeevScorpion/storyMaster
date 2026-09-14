// Pure Chat Completions request/response shaping, shared by the OpenAI and OpenRouter
// adapters (openai-compatible.ts). See docs/text-model-gateway-plan.md section 3.3.

import type { TextModelRecord } from '@/lib/ai/text-models.shared';
import type { TextGatewayErrorCategory, TextGenerationRequest, TextUsage } from './types.shared';
import { geminiSchemaToJsonSchema, type GeminiSchemaNode } from './json-schema.shared';

export function buildChatCompletionsBody(record: TextModelRecord, request: TextGenerationRequest): Record<string, unknown> {
  const wantsJson = Boolean(request.schema) || Boolean(request.expectJson);
  let systemText = request.systemInstruction ?? '';
  let responseFormat: Record<string, unknown> | undefined;

  if (wantsJson) {
    const support = record.capabilities.structuredOutput;
    if (request.schema && support === 'native') {
      responseFormat = {
        type: 'json_schema',
        json_schema: {
          name: request.schemaName ?? 'response',
          schema: geminiSchemaToJsonSchema(request.schema as GeminiSchemaNode, { strict: true }),
          strict: true,
        },
      };
    } else if (support === 'native' || support === 'json') {
      // Native without a schema (nothing to enforce) and 'json' capability both use
      // JSON mode; a schema, if given, is only described in the prompt.
      responseFormat = { type: 'json_object' };
      systemText = appendJsonInstruction(systemText, request.schema, 'Respond with JSON matching this schema');
    } else {
      // 'none': no response_format the provider would reject; describe the shape instead.
      systemText = appendJsonInstruction(systemText, request.schema, 'Return ONLY valid JSON matching this schema, no markdown or commentary');
    }
  }

  const messages: Array<Record<string, unknown>> = [];
  if (systemText) messages.push({ role: 'system', content: systemText });

  const images = request.images ?? [];
  messages.push(
    images.length > 0
      ? {
          role: 'user',
          content: [
            { type: 'text', text: request.prompt },
            ...images.map((image) => ({
              type: 'image_url',
              image_url: { url: `data:${image.mimeType};base64,${image.data}` },
            })),
          ],
        }
      : { role: 'user', content: request.prompt }
  );

  const body: Record<string, unknown> = {
    model: record.providerModelId,
    messages,
  };

  if (record.capabilities.temperature && typeof request.temperature === 'number') {
    body.temperature = request.temperature;
  }

  // Only send an output cap when one is actually configured -- 0/unset means "no cap".
  if (typeof record.defaultParams.maxOutputTokens === 'number' && record.defaultParams.maxOutputTokens > 0) {
    body.max_completion_tokens = record.defaultParams.maxOutputTokens;
  }

  if (record.providerKey === 'openai' && record.defaultParams.reasoningEffort) {
    body.reasoning_effort = record.defaultParams.reasoningEffort;
  }
  if (record.providerKey === 'openrouter') {
    if (record.defaultParams.reasoningEnabled === false) {
      body.reasoning = { enabled: false };
    } else if (record.defaultParams.reasoningEffort) {
      body.reasoning = { effort: record.defaultParams.reasoningEffort };
    }
  }

  if (responseFormat) {
    body.response_format = responseFormat;
    // require_parameters routes only to hosts that honour response_format -- never send
    // the top-level `models` fallback array, which would let OpenRouter silently swap models.
    if (record.providerKey === 'openrouter') body.provider = { require_parameters: true };
  }

  return body;
}

function appendJsonInstruction(systemText: string, schema: unknown, prefix: string): string {
  const instruction = schema
    ? `${prefix}: ${JSON.stringify(geminiSchemaToJsonSchema(schema as GeminiSchemaNode, { strict: false }))}`
    : 'Respond with a single valid JSON object, no markdown or commentary.';
  return [systemText, instruction].filter(Boolean).join('\n\n');
}

export interface ParsedChatCompletionsResponse {
  text: string;
  refusal: boolean;
  finishReason?: 'length';
  usage: TextUsage;
  actualModel?: string;
  requestId?: string;
}

interface HeaderLike {
  get(name: string): string | null;
}

function readHeader(headers: HeaderLike | Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as HeaderLike).get === 'function') {
    return (headers as HeaderLike).get(name) ?? undefined;
  }
  return (headers as Record<string, string>)[name];
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseChatCompletionsResponse(
  json: Record<string, unknown>,
  headers?: HeaderLike | Record<string, string>
): ParsedChatCompletionsResponse {
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const choice = (choices[0] ?? {}) as Record<string, unknown>;
  const message = (choice.message ?? {}) as Record<string, unknown>;
  const finishReason = choice.finish_reason;
  const usage = (json.usage ?? {}) as Record<string, unknown>;
  const promptTokenDetails = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const completionTokenDetails = (usage.completion_tokens_details ?? {}) as Record<string, unknown>;

  return {
    text: typeof message.content === 'string' ? message.content : '',
    refusal: Boolean(message.refusal) || finishReason === 'content_filter',
    finishReason: finishReason === 'length' ? 'length' : undefined,
    usage: {
      inputTokens: numberOrUndefined(usage.prompt_tokens) ?? 0,
      outputTokens: numberOrUndefined(usage.completion_tokens) ?? 0,
      cachedInputTokens: numberOrUndefined(promptTokenDetails.cached_tokens),
      reasoningTokens: numberOrUndefined(completionTokenDetails.reasoning_tokens),
      costUsd: numberOrUndefined(usage.cost) ?? null,
    },
    actualModel: typeof json.model === 'string' ? json.model : undefined,
    requestId: (typeof json.id === 'string' ? json.id : undefined) ?? readHeader(headers, 'x-request-id'),
  };
}

const HTTP_STATUS_CATEGORY: Array<{ test: (status: number) => boolean; category: TextGatewayErrorCategory; retryable: boolean }> = [
  { test: (s) => s === 400, category: 'bad_request', retryable: false },
  { test: (s) => s === 401 || s === 403, category: 'auth_failed', retryable: false },
  { test: (s) => s === 402, category: 'insufficient_credits', retryable: false },
  { test: (s) => s === 404, category: 'model_unavailable', retryable: false },
  { test: (s) => s === 408 || s === 504, category: 'timeout', retryable: false },
  { test: (s) => s === 429, category: 'rate_limited', retryable: true },
  { test: (s) => s === 502 || s === 503, category: 'model_unavailable', retryable: true },
];

export function classifyHttpError(status: number): { category: TextGatewayErrorCategory; retryable: boolean } {
  const match = HTTP_STATUS_CATEGORY.find((entry) => entry.test(status));
  if (match) return { category: match.category, retryable: match.retryable };
  return { category: 'provider_error', retryable: false };
}
