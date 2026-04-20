import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { estimateCost } from '@/lib/ai/pricing';
import type { ModelCostEventInput } from '@/lib/ai/cost-telemetry.shared';

function finiteNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function resolveCurrentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function recordModelCostEvent(input: ModelCostEventInput): Promise<void> {
  try {
    const userId = await resolveCurrentUserId();
    const inputTokens = Math.max(0, Math.round(finiteNumber(input.inputTokens)));
    const outputTokens = Math.max(0, Math.round(finiteNumber(input.outputTokens)));
    const imageCount = Math.max(0, Math.round(finiteNumber(input.imageCount)));
    const estimatedCostUsd = estimateCost(
      input.modelId,
      inputTokens,
      outputTokens,
      imageCount,
      input.imageSize ?? undefined
    );

    const admin = createAdminClient();
    const { error } = await admin
      .from('ai_cost_events')
      .insert({
        user_id: userId,
        story_id: input.context.storyId || null,
        beat_id: input.context.beatId || null,
        storyline_id: input.context.storylineId || null,
        node_id: input.context.nodeId || null,
        story_session_id: input.context.storySessionId || null,
        activity_key: input.context.activityKey,
        task_key: input.taskKey,
        provider: 'google_gemini',
        model_id: input.modelId,
        status: input.status || 'success',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        image_count: imageCount,
        image_size: input.imageSize || null,
        audio_seconds: input.audioSeconds ?? null,
        estimated_cost_usd: Number(estimatedCostUsd.toFixed(6)),
        latency_ms: input.latencyMs == null ? null : Math.max(0, Math.round(input.latencyMs)),
        metadata: {
          ...(input.context.metadata || {}),
          ...(input.context.phase ? { phase: input.context.phase } : {}),
          ...(input.metadata || {}),
        },
      });

    if (error) {
      console.error('Failed to record AI cost event:', error.message);
    }
  } catch (error) {
    console.error('Failed to record AI cost event:', error);
  }
}
