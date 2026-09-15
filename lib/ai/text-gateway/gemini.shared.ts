// Pure Gemini request/response shaping, split out of gemini.ts so it can be unit-tested
// without the @google/genai SDK or a live network call. See
// docs/text-model-thinking-plan.md sections 2.2 (thinking) and 2.3 (temperature).

import type { TextModelRecord, TextReasoningLevel } from '@/lib/ai/text-models.shared';
import type { TextGenerationRequest, TextUsage } from './types.shared';

/** Thinking levels @google/genai's `ThinkingConfig.thinkingLevel` actually accepts (the Gemini
 * 3 family). A model's own `capabilities.reasoningLevels` is validated to be a subset of this
 * already (validateReasoningConfig), so resolveReasoningLevel should never hand back anything
 * outside this set for a Gemini record -- the check here is a last-line defense, not the
 * primary guard. `thinkingLevel` and `thinkingBudget` cannot be sent together, so
 * `thinkingBudget` is never sent here at all. */
const GEMINI_THINKING_LEVELS: readonly TextReasoningLevel[] = ['minimal', 'low', 'medium', 'high'];

/**
 * Builds the `config` object for `ai.models.generateContent`.
 *
 * Temperature is always 1, regardless of `request.temperature` or the task's configured
 * temperature -- Google's Gemini 3 guidance is to keep temperature at its default of 1.0
 * ("lower values may lead to unexpected behavior, such as looping or degraded performance"),
 * and the owner (docs/text-model-thinking-plan.md O-T4) chose to apply that to every Gemini
 * text call. `request.temperature` is intentionally never read in this function.
 */
export function buildGeminiConfig(
  record: TextModelRecord,
  request: TextGenerationRequest,
  reasoningLevel: TextReasoningLevel | undefined
): Record<string, unknown> {
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

  // O-T4 / Gemini 3 guidance -- see doc comment above. Deliberately not `request.temperature`.
  config.temperature = 1;

  if (typeof record.defaultParams.maxOutputTokens === 'number' && record.defaultParams.maxOutputTokens > 0) {
    config.maxOutputTokens = record.defaultParams.maxOutputTokens;
  }

  if (reasoningLevel) {
    if ((GEMINI_THINKING_LEVELS as readonly string[]).includes(reasoningLevel)) {
      config.thinkingConfig = { thinkingLevel: reasoningLevel.toUpperCase() };
    } else {
      // Unreachable in practice: a Gemini row's reasoningLevels is validated to be a subset of
      // GEMINI_THINKING_LEVELS. Omit rather than send a value Gemini would reject outright.
      console.warn('[text-gateway] gemini thinking level unsupported, omitting thinkingConfig', {
        modelKey: record.modelKey,
        reasoningLevel,
      });
    }
  }

  return config;
}

/** Structural subset of @google/genai's GenerateContentResponseUsageMetadata this module
 * actually reads -- kept local (rather than importing the SDK type) so this file stays free of
 * any @google/genai dependency, consistent with the rest of *.shared.ts being pure/isomorphic. */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

/**
 * Gemini bills thinking as output tokens: `candidatesTokenCount` alone under-counts a
 * thinking-enabled call, so `thoughtsTokenCount` is folded into `outputTokens`. This matches
 * OpenAI, whose `completion_tokens` already includes reasoning tokens, so cost/usage rows stay
 * comparable across providers. `reasoningTokens` is still reported separately for the
 * thinking-specific breakdown, mirroring OpenAI's `completion_tokens_details.reasoning_tokens`.
 */
export function parseGeminiUsage(usageMetadata: GeminiUsageMetadata | undefined): TextUsage {
  const inputTokens = usageMetadata?.promptTokenCount ?? 0;
  const candidatesTokens = usageMetadata?.candidatesTokenCount ?? 0;
  const thoughtsTokens = usageMetadata?.thoughtsTokenCount ?? 0;

  return {
    inputTokens,
    outputTokens: candidatesTokens + thoughtsTokens,
    reasoningTokens: thoughtsTokens > 0 ? thoughtsTokens : undefined,
    cachedInputTokens: usageMetadata?.cachedContentTokenCount ?? undefined,
    costUsd: null,
  };
}

/** `candidates[0].finishReason` values that mean the model refused to produce content on
 * content-safety grounds, as opposed to a mundane stop (STOP, MAX_TOKENS, LANGUAGE, OTHER,
 * etc). Mirrors @google/genai's `FinishReason` enum -- kept as a plain string list (rather than
 * importing the SDK enum) so this file stays free of any @google/genai dependency. */
export const GEMINI_CONTENT_FINISH_REASONS = [
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
] as const;

/**
 * Classifies a Gemini response that came back with no text. `blockReason` and `finishReason`
 * are read from `response.promptFeedback.blockReason` and `response.candidates[0].finishReason`
 * respectively -- see gemini.ts. A block reason (other than the unspecified placeholder) means
 * the prompt itself was refused before generation started; a content finish reason means
 * generation started and was cut short on safety grounds. Anything else -- MAX_TOKENS, LANGUAGE,
 * OTHER, or genuinely nothing -- is an ordinary `provider_error`, not a content block.
 */
export function classifyGeminiEmptyResponse(input: {
  blockReason?: string;
  finishReason?: string;
}): { category: 'content_blocked' | 'provider_error'; providerReason?: string } {
  if (input.blockReason && input.blockReason !== 'BLOCKED_REASON_UNSPECIFIED') {
    return { category: 'content_blocked', providerReason: `prompt_blocked:${input.blockReason}` };
  }
  if (input.finishReason && (GEMINI_CONTENT_FINISH_REASONS as readonly string[]).includes(input.finishReason)) {
    return { category: 'content_blocked', providerReason: `finish:${input.finishReason}` };
  }
  return {
    category: 'provider_error',
    providerReason: input.finishReason ? `finish:${input.finishReason}` : undefined,
  };
}
