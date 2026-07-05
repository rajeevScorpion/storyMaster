import type { TaskKey } from '@/lib/ai/model-config.shared';
import type { GeminiImageSize } from '@/lib/ai/pricing';

// How an image (or other asset) was delivered, for cost attribution:
//  - 'regular'  : rendered live at full interactive price
//  - 'batch'    : provider batch API (~50% cheaper, ~24h)
//  - 'stateful' : fast server-side sequential stateful job (regular price)
export type CostGenerationMode = 'regular' | 'batch' | 'stateful';

export type CostActivityKey =
  | 'start_story_initial_beat'
  | 'start_story_initial_beat_prompt_only'
  | 'start_reel_full_generation'
  | 'start_reel_full_generation_prompt_only'
  | 'continue_story_new_beat'
  | 'continue_story_new_beat_prompt_only'
  | 'preview_seed_plan'
  | 'regenerate_image'
  | 'regenerate_narration'
  | 'generate_social_share_cover'
  | 'generate_audio_story_cover'
  | 'generate_reel_thumbnail'
  | 'generate_story_text_overlay'
  | 'batch_image_generation'
  | 'stateful_image_generation';

export interface CostTelemetryContext {
  activityKey: CostActivityKey;
  generationMode?: CostGenerationMode;
  storySessionId?: string | null;
  storyId?: string | null;
  beatId?: string | null;
  nodeId?: string | null;
  storylineId?: string | null;
  beatNumber?: number | null;
  phase?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ModelCostEventInput {
  context: CostTelemetryContext;
  taskKey: TaskKey;
  modelId: string;
  provider?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  imageCount?: number;
  inputImageCount?: number | null;
  imageSize?: GeminiImageSize | null;
  audioSeconds?: number | null;
  latencyMs?: number | null;
  estimatedCostUsdOverride?: number | null;
  providerUsage?: Record<string, unknown> | null;
  status?: 'success' | 'failed';
  metadata?: Record<string, unknown>;
}
