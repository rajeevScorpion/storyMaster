import type { Character, StoryAspectRatio } from '@/lib/types/story';
import type { ImageModelSelection } from '@/lib/ai/image-models.shared';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { BeatMediaStatus } from '@/lib/types/beat-media';
import type { ImageContinuityRuntimeOptions, StoryModelOverrides } from '@/app/actions/story-runtime';

export type ImageGenerationJobKind = 'beat_image' | 'reel_image';

export type ImageGenerationJobStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'cancelled';

/** Mirrors the private StoryboardImagePromptOptions shape in story-runtime. */
export interface BeatImageJobPromptOptions {
  visualStyleDefiner?: string;
  noFaceRule?: string;
  textOverlayMode?: string;
}

/**
 * Serializable reference image. Data URLs are staged to private R2 at enqueue
 * time and carried as r2://bucket/key in `r2Reference`; plain URLs pass
 * through untouched.
 */
export interface BeatImageJobReference {
  type: 'character' | 'scene';
  url?: string;
  r2Reference?: string;
}

/**
 * The full generateImage() argument set, minus anything non-serializable.
 * The worker replays this against the same story-runtime entry point the
 * interactive flow uses, so results are identical across modes.
 */
export interface BeatImageJobRequestPayload {
  prompt: string;
  characters: Character[];
  visualStyle: string;
  /** Snapshot taken at enqueue so worker retries are deterministic. */
  modelOverrides?: StoryModelOverrides;
  beatNumber?: number;
  aspectRatio: StoryAspectRatio;
  imageTask: 'image_generation' | 'reel_image_generation';
  imagePromptOptions: BeatImageJobPromptOptions;
  imageModelSelection?: ImageModelSelection | null;
  imageContinuity?: ImageContinuityRuntimeOptions | null;
  costTelemetry?: CostTelemetryContext;
  references: BeatImageJobReference[];
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
