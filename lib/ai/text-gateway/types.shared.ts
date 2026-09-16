// Pure types for the text gateway. See docs/text-model-gateway-plan.md section 3.3.
// Isomorphic on purpose: TextGatewayError is thrown by server-only adapters but callers
// on either side may want to `instanceof` it.

import type { TaskKey } from '@/lib/ai/model-config.shared';
import type { TextModelResolution, TextProviderKey } from '@/lib/ai/text-models.shared';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';

/** Image input shape shared with gemini-proxy.ts's InlineImagePart (structurally compatible
 * by design -- callers pass InlineImagePart[] straight through without importing it here). */
export interface TextGenerationImagePart {
  mimeType: string;
  data: string;
}

export interface TextGenerationRequest {
  taskKey: TaskKey;
  /** A text_model_registry key (or a bare Gemini id in legacy mode). Never trust this
   * across a client boundary without going through resolveTextModel first. */
  modelKey: string;
  prompt: string;
  systemInstruction?: string;
  images?: TextGenerationImagePart[];
  temperature?: number;
  /** A generation-schemas.ts Gemini `Type`-based schema. Presence implies JSON output. */
  schema?: unknown;
  /** response_format.json_schema.name for native structured output. */
  schemaName?: string;
  /** JSON output wanted with no schema to validate against (agentic/reference-analysis tasks). */
  expectJson?: boolean;
  /** Defaults to `images.length > 0` when omitted. */
  requireVision?: boolean;
  /** Admin playground only: throw instead of silently running the task's fallback model. */
  strictModel?: boolean;
  telemetry?: CostTelemetryContext;
  /** Extra telemetry metadata fields (promptChars, temperature, referenceCount, ...) from the
   * caller. Merged into the router's own metadata with the router's keys winning on collision --
   * see generateText in router.ts. */
  telemetryMetadata?: Record<string, unknown>;
}

export interface TextUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  /** Provider-reported real charge (OpenRouter `usage.cost`). Null when the provider
   * doesn't report one -- computeTextCostUsd then falls back to row prices. */
  costUsd?: number | null;
}

export interface TextGenerationResult {
  text: string;
  usage: TextUsage;
  resolution: TextModelResolution;
}

export type TextGatewayErrorCategory =
  | 'auth_missing'
  | 'auth_failed'
  | 'bad_request'
  | 'insufficient_credits'
  | 'model_unavailable'
  | 'timeout'
  | 'rate_limited'
  | 'provider_error'
  | 'malformed_output'
  | 'content_blocked';

export interface TextGatewayErrorInput {
  category: TextGatewayErrorCategory;
  providerKey: TextProviderKey;
  modelKey: string;
  detail: string;
  status?: number;
  retryable?: boolean;
  /** Short machine reason, e.g. `prompt_blocked:PROHIBITED_CONTENT`, `finish:SAFETY`,
   * `refusal`, `finish:content_filter`, `moderation`. Admin-only, like `detail`. */
  providerReason?: string;
  /** Tokens the failed call still consumed, when the provider reported any before failing. */
  usage?: TextUsage;
}

export const TEXT_FAILURE_MESSAGE = 'Something went wrong while generating this. Please try again.';
export const TEXT_BUSY_MESSAGE = 'This is taking longer than usual. Please try again in a moment.';
export const TEXT_CONTENT_BLOCKED_MESSAGE =
  "This part couldn't be created because it ran into content safety guidelines. Try a different choice or wording.";

/** Reader-safe: never contains a provider, model or task name. */
export function readerSafeTextFailureMessage(category: TextGatewayErrorCategory): string {
  if (category === 'content_blocked') return TEXT_CONTENT_BLOCKED_MESSAGE;
  return category === 'timeout' || category === 'rate_limited' ? TEXT_BUSY_MESSAGE : TEXT_FAILURE_MESSAGE;
}

/** Full failure text for server logs and admin screens only. */
export function errorDetail(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof TextGatewayError) return error.detail;
  return error instanceof Error && error.message ? error.message : fallback;
}

/** `message` is always the fixed reader-safe sentence from `readerSafeTextFailureMessage` --
 * never includes headers, API keys, full prompts, or the provider/model/task names. The full
 * failure text (which does name provider and model, per plan section 3.3's HTTP mapping rules)
 * lives in `detail`, for server logs and admin screens only -- read it via `errorDetail`. */
export class TextGatewayError extends Error {
  category: TextGatewayErrorCategory;
  providerKey: TextProviderKey;
  modelKey: string;
  status?: number;
  retryable: boolean;
  detail: string;
  providerReason?: string;
  usage?: TextUsage;

  constructor(input: TextGatewayErrorInput) {
    super(readerSafeTextFailureMessage(input.category));
    this.name = 'TextGatewayError';
    this.category = input.category;
    this.providerKey = input.providerKey;
    this.modelKey = input.modelKey;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.detail = input.detail;
    this.providerReason = input.providerReason;
    this.usage = input.usage;
  }
}

/** Result of a text call that treats expected gateway failures as data instead of a thrown
 * error -- see callTextModelOutcome in app/actions/text-model-proxy.ts and Next.js's guidance
 * to return, not throw, expected errors from Server Functions. */
export type TextCallOutcome =
  | { ok: true; text: string }
  | { ok: false; category: TextGatewayErrorCategory; message: string };
