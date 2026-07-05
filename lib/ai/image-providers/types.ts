import type { InlineImagePart } from '@/app/actions/gemini-proxy';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type {
  ImageContinuityProviderState,
  ImageContinuityRequest,
  ResolvedImageContinuityStrategy,
} from '@/lib/ai/image-continuity.shared';
import type { ImageModelSnapshot, ImageTaskKey } from '@/lib/ai/image-models.shared';

export interface ImageProviderRequest {
  task: ImageTaskKey;
  prompt: string;
  referenceParts?: InlineImagePart[];
  aspectRatio?: string;
  imageSize?: string;
  telemetry?: CostTelemetryContext;
  modelSnapshot: ImageModelSnapshot;
  continuity?: ImageContinuityRequest | null;
}

export interface ImageProviderResult {
  dataUrl: string | null;
  fallbackText: string | null;
  metadata: Record<string, unknown>;
  providerUsage?: Record<string, unknown>;
  inputImageCount?: number;
  continuityState?: ImageContinuityProviderState | null;
  resolvedContinuityStrategy?: ResolvedImageContinuityStrategy;
  fallbackReason?: string | null;
}

export interface ImageProviderAdapter {
  generateImage(request: ImageProviderRequest): Promise<ImageProviderResult>;
  /** Present only for providers that expose an async batch endpoint. */
  batch?: ImageBatchAdapter;
}

// ---- Batch (deferred) image generation ----------------------------------

/** One image request within a batch submission. Batch always uses resend_refs
 *  continuity (no stateful chain), so references travel inline per item. */
export interface ImageBatchRequestItem {
  requestKey: string;
  prompt: string;
  referenceParts?: InlineImagePart[];
  aspectRatio?: string;
  imageSize?: string;
}

export interface ImageBatchSubmission {
  task: ImageTaskKey;
  modelSnapshot: ImageModelSnapshot;
  items: ImageBatchRequestItem[];
  displayName?: string;
}

export interface ImageBatchSubmitResult {
  providerBatchName: string;
}

export type ImageBatchProviderState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface ImageBatchItemResult {
  requestKey: string;
  dataUrl: string | null;
  error: string | null;
  providerUsage?: Record<string, unknown>;
}

export interface ImageBatchPollResult {
  state: ImageBatchProviderState;
  /** Populated once the job reaches a terminal state with retrievable results. */
  items: ImageBatchItemResult[];
  error?: string | null;
}

export interface ImageBatchAdapter {
  submitBatch(submission: ImageBatchSubmission): Promise<ImageBatchSubmitResult>;
  pollBatch(providerBatchName: string): Promise<ImageBatchPollResult>;
}
