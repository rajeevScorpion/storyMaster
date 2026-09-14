import 'server-only';

import type { TextModelRecord } from '@/lib/ai/text-models.shared';
import { TEXT_PROVIDER_LABELS } from '@/lib/ai/text-models.shared';
import { TextGatewayError, type TextGenerationRequest } from './types.shared';
import { buildChatCompletionsBody, classifyHttpError, parseChatCompletionsResponse, type ParsedChatCompletionsResponse } from './openai-compatible.shared';

const BASE_URL: Record<'openai' | 'openrouter', string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

/** Only `error.message`, truncated -- never the raw body, which on some hosts can echo the
 * request. Without this a 400 like "Unsupported parameter: temperature" is undiagnosable. */
async function readProviderErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    const message = typeof body?.error?.message === 'string' ? body.error.message.trim() : '';
    return message ? `: ${message.slice(0, 300)}` : '';
  } catch {
    return '';
  }
}

function describeCall(record: TextModelRecord, taskKey: string): string {
  return `${TEXT_PROVIDER_LABELS[record.providerKey]} model "${record.modelKey}" (task ${taskKey})`;
}

/**
 * fetch, not the `openai` SDK -- the SDK defaults to maxRetries: 2, which would silently
 * multiply a failed paid call. Zero retries here, matching the OpenAI image provider's own
 * fetch precedent (lib/ai/image-providers/openai-provider.ts).
 */
export async function callOpenAiCompatible(
  record: TextModelRecord,
  request: TextGenerationRequest,
  apiKey: string,
  timeoutMs: number
): Promise<ParsedChatCompletionsResponse> {
  const providerKey = record.providerKey as 'openai' | 'openrouter';
  const body = buildChatCompletionsBody(record, request);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (providerKey === 'openrouter') {
    headers['HTTP-Referer'] = process.env.APP_URL || 'https://kissago.cc';
    headers['X-Title'] = 'Kissago';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL[providerKey]}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new TextGatewayError({
      category: aborted ? 'timeout' : 'provider_error',
      providerKey,
      modelKey: record.modelKey,
      retryable: false,
      message: aborted
        ? `${describeCall(record, request.taskKey)} timed out after ${timeoutMs}ms.`
        : `${describeCall(record, request.taskKey)} request failed before a response was received.`,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const { category, retryable } = classifyHttpError(response.status);
    throw new TextGatewayError({
      category,
      providerKey,
      modelKey: record.modelKey,
      status: response.status,
      retryable,
      message: `${describeCall(record, request.taskKey)} failed with HTTP ${response.status}${await readProviderErrorMessage(response)}.`,
    });
  }

  const json = (await response.json()) as Record<string, unknown>;
  const parsed = parseChatCompletionsResponse(json, response.headers);
  if (parsed.refusal) {
    throw new TextGatewayError({
      category: 'bad_request',
      providerKey,
      modelKey: record.modelKey,
      retryable: false,
      message: `${describeCall(record, request.taskKey)} was refused by the provider.`,
    });
  }
  return parsed;
}
