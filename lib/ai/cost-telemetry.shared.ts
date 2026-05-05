import type { TaskKey } from '@/lib/ai/model-config.shared';
import type { GeminiImageSize } from '@/lib/ai/pricing';

export type CostActivityKey =
  | 'start_story_initial_beat'
  | 'start_story_initial_beat_prompt_only'
  | 'continue_story_new_beat'
  | 'continue_story_new_beat_prompt_only'
  | 'preview_seed_plan'
  | 'regenerate_image'
  | 'regenerate_narration'
  | 'generate_social_share_cover'
  | 'generate_audio_story_cover'
  | 'generate_reel_thumbnail';

export interface CostTelemetryContext {
  activityKey: CostActivityKey;
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
  inputTokens?: number | null;
  outputTokens?: number | null;
  imageCount?: number;
  imageSize?: GeminiImageSize | null;
  audioSeconds?: number | null;
  latencyMs?: number | null;
  status?: 'success' | 'failed';
  metadata?: Record<string, unknown>;
}
