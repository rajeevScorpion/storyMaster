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
  | 'malformed_output';

export interface TextGatewayErrorInput {
  category: TextGatewayErrorCategory;
  providerKey: TextProviderKey;
  modelKey: string;
  message: string;
  status?: number;
  retryable?: boolean;
}

/** Never includes headers, API keys, or full prompts in `message` -- only provider,
 * model key and task, per plan section 3.3's HTTP mapping rules. */
export class TextGatewayError extends Error {
  category: TextGatewayErrorCategory;
  providerKey: TextProviderKey;
  modelKey: string;
  status?: number;
  retryable: boolean;

  constructor(input: TextGatewayErrorInput) {
    super(input.message);
    this.name = 'TextGatewayError';
    this.category = input.category;
    this.providerKey = input.providerKey;
    this.modelKey = input.modelKey;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
  }
}
