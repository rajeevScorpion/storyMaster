import 'server-only';

import { GoogleGenAI } from '@google/genai';
import type { TextModelRecord } from '@/lib/ai/text-models.shared';
import { TextGatewayError, type TextGenerationRequest } from './types.shared';
import { classifyHttpError, type ParsedChatCompletionsResponse } from './openai-compatible.shared';

/**
 * No httpOptions.retryOptions: @google/genai 2.x only retries a call when that option is
 * passed (dist/node/index.cjs `apiCall` -- no retryOptions means a plain fetch). Leave it
 * out, or a transient failure silently becomes a second billed call.
 */
function getGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

function withTimeout<T>(promise: Promise<T>, ms: number, record: TextModelRecord): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new TextGatewayError({
            category: 'timeout',
            providerKey: 'gemini',
            modelKey: record.modelKey,
            retryable: false,
            message: `Gemini model "${record.modelKey}" timed out after ${ms}ms.`,
          })
        ),
      ms
    );
  });
  // Clear the timer on either outcome -- an un-cleared 30s+ handle otherwise keeps every
  // test (and every real request) holding an open timer long after the call finished.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function callGemini(
  record: TextModelRecord,
  request: TextGenerationRequest,
  apiKey: string,
  timeoutMs: number
): Promise<ParsedChatCompletionsResponse> {
  const ai = getGeminiClient(apiKey);

  const images = request.images ?? [];
  const contents = images.length > 0
    ? [{
        role: 'user',
        parts: [
          { text: request.prompt },
          ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } })),
        ],
      }]
    : request.prompt;

  const config: Record<string, unknown> = {};
  if (request.systemInstruction) config.systemInstruction = request.systemInstruction;
  if (request.schema) {
    config.responseMimeType = 'application/json';
    config.responseSchema = request.schema;
  } else if (request.expectJson) {
    config.responseMimeType = 'application/json';
  } else {
    config.responseMimeType = 'text/plain';
  }
  if (typeof request.temperature === 'number') config.temperature = request.temperature;
  if (typeof record.defaultParams.maxOutputTokens === 'number' && record.defaultParams.maxOutputTokens > 0) {
    config.maxOutputTokens = record.defaultParams.maxOutputTokens;
  }

  let response: Awaited<ReturnType<typeof ai.models.generateContent>>;
  try {
    response = await withTimeout(
      ai.models.generateContent({ model: record.providerModelId, contents, config }),
      timeoutMs,
      record
    );
  } catch (err) {
    if (err instanceof TextGatewayError) throw err;
    // Keep the SDK's status and message: before the gateway they reached callers and logs
    // verbatim, and they are the only way to tell a 429 from a bad model id.
    const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : undefined;
    const { category, retryable } = status ? classifyHttpError(status) : { category: 'provider_error' as const, retryable: false };
    const upstream = err instanceof Error && err.message ? `: ${err.message.slice(0, 300)}` : '';
    throw new TextGatewayError({
      category,
      providerKey: 'gemini',
      modelKey: record.modelKey,
      status,
      retryable,
      message: `Gemini model "${record.modelKey}" request failed for task ${request.taskKey}${upstream}`,
    });
  }

  const text = response.text;
  if (!text) {
    throw new TextGatewayError({
      category: 'provider_error',
      providerKey: 'gemini',
      modelKey: record.modelKey,
      retryable: false,
      message: `Empty response from Gemini model "${record.modelKey}" for task ${request.taskKey}.`,
    });
  }

  return {
    text,
    refusal: false,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      cachedInputTokens: response.usageMetadata?.cachedContentTokenCount ?? undefined,
      costUsd: null,
    },
    actualModel: record.providerModelId,
  };
}
