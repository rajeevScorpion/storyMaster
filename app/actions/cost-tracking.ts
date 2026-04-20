'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export interface LinkCostEventsInput {
  storySessionId: string;
  storyId: string;
  nodeId: string;
  beatId?: string | null;
  storylineId?: string | null;
}

export async function linkCostEventsToBeat(input: LinkCostEventsInput): Promise<void> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;

    const admin = createAdminClient();
    const updateData: Record<string, unknown> = {
      story_id: input.storyId,
      node_id: input.nodeId,
    };
    if (input.beatId) updateData.beat_id = input.beatId;
    if (input.storylineId) updateData.storyline_id = input.storylineId;

    const { error } = await admin
      .from('ai_cost_events')
      .update(updateData)
      .eq('user_id', userId)
      .eq('story_session_id', input.storySessionId)
      .eq('node_id', input.nodeId);

    if (error) {
      console.error('Failed to link AI cost events to beat:', error.message);
    }
  } catch (error) {
    console.error('Failed to link AI cost events to beat:', error);
  }
}
