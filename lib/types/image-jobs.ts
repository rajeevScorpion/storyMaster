import type { StoryAspectRatio } from '@/lib/types/story';
import type { ImageModelSelection } from '@/lib/ai/image-models.shared';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { BeatMediaStatus } from '@/lib/types/beat-media';
import type { PlanKey } from '@/lib/types/pricing';
import type { ImageContinuityRuntimeOptions } from '@/app/actions/story-runtime';

export type ImageGenerationJobKind = 'beat_image' | 'reel_image';

export type ImageGenerationJobStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'cancelled';

/**
 * Serializable reference image. Data URLs are staged to private R2 at enqueue
 * time and carried as r2://bucket/key in `r2Reference`; plain URLs pass
 * through untouched.
 */
export interface BeatImageJobReference {
  type: 'character' | 'scene';
  url?: string;
  r2Reference?: string;
  /** Character name for identity binding in the worker's final prompt. */
  name?: string;
}

/**
 * Pack 1 user-driven regeneration metadata. Present only when the job was
 * created from the regenerate-image dialog; its fields are recorded on the
 * resulting image version entry.
 */
export interface BeatImageRegenerationMeta {
  mode: 'refine' | 'reimagine';
  overallSuggestion?: string;
  /** Keyed by storyboard frame: topLeft | topRight | bottomLeft | bottomRight. */
  panelSuggestions?: Record<string, string>;
  source: 'user';
}

/**
 * Everything the worker needs to call generateSelectedImage() exactly as the
 * interactive request would have. The final prompt is built client-side at
 * enqueue time (the prompt-building orchestrator lives in the 'use client'
 * story-runtime module), so worker retries are deterministic.
 */
export interface BeatImageJobRequestPayload {
  /** Fully-built final image prompt (buildFinalStoryboardImagePrompt output). */
  finalPrompt: string;
  beatNumber?: number;
  aspectRatio: StoryAspectRatio;
  imageTask: 'image_generation' | 'reel_image_generation';
  /** Storyboard quality setting snapshot (e.g. '1K', '2K'). */
  imageSize?: string;
  imageModelSelection?: ImageModelSelection | null;
  imageContinuity?: ImageContinuityRuntimeOptions | null;
  costTelemetry?: CostTelemetryContext;
  references: BeatImageJobReference[];
  /** Owner's plan at enqueue time — the worker has no cookie session, so
   *  tier-gated model access and retention are resolved from this snapshot. */
  currentPlanKey?: PlanKey;
  /** Pack 1: set when the user requested this generation from the
   *  regenerate-image dialog; recorded on the resulting version entry. */
  regeneration?: BeatImageRegenerationMeta | null;
}

export interface ImageGenerationJobRow {
  id: string;
  user_id: string;
  story_id: string;
  node_id: string;
  kind: ImageGenerationJobKind;
  status: ImageGenerationJobStatus;
  processing_mode: string;
  requested_mode: string | null;
  request_payload_json: BeatImageJobRequestPayload;
  reference_keys: string[];
  media_group_id: string | null;
  reservation_id: string | null;
  attempt_count: number;
  max_attempts: number;
  error: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Owner-facing polling status for one node's active/recent job. */
export interface StoryImageJobStatus {
  jobId: string;
  nodeId: string;
  status: ImageGenerationJobStatus;
  /** Beat-media status the client store should reflect for this node. */
  beatImageStatus: BeatMediaStatus;
  error: string | null;
  updatedAt: string;
}
