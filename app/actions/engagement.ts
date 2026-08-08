'use server';

import { createClient } from '@/lib/supabase/server';

export async function toggleLike(
  storylineId: string
): Promise<{ liked: boolean; likeCount: number }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  // Check if already liked
  const { data: existing } = await supabase
    .from('storyline_likes')
    .select('id')
    .eq('user_id', user.id)
    .eq('storyline_id', storylineId)
    .maybeSingle();

  if (existing) {
    // Unlike
    const { error } = await supabase
      .from('storyline_likes')
      .delete()
      .eq('user_id', user.id)
      .eq('storyline_id', storylineId);
    if (error) throw new Error(`Failed to unlike: ${error.message}`);
  } else {
    // Like
    const { error } = await supabase
      .from('storyline_likes')
      .upsert(
        { user_id: user.id, storyline_id: storylineId },
        { onConflict: 'user_id,storyline_id' }
      );
    if (error) throw new Error(`Failed to like: ${error.message}`);
  }

  // Fetch updated count from storylines table
  const { data: storyline } = await supabase
    .from('storylines')
    .select('like_count')
    .eq('id', storylineId)
    .single();

  return {
    liked: !existing,
    likeCount: storyline?.like_count ?? 0,
  };
}

/**
 * Persist how far a viewer has read into a storyline (migration 090).
 *
 * Complements the client-side IndexedDB progress, which is per-device and
 * invisible to the server: this row is what lets the gallery build a Continue
 * Reading rail and mark finished storylines.
 *
 * Completion is sticky. When `completed` is false the column is left out of the
 * upsert entirely, so a re-read of a finished storyline updates the resume
 * point without clearing the badge.
 *
 * Never throws: reading must not break because progress could not be saved, and
 * the table may not exist yet on a database that has not had 090 applied.
 */
export async function recordStorylineProgress(input: {
  storylineId: string;
  beatIndex: number;
  beatCount: number;
  completed: boolean;
}): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return;

    const row: Record<string, unknown> = {
      user_id: user.id,
      storyline_id: input.storylineId,
      current_beat_index: Math.max(0, Math.floor(input.beatIndex)),
      beat_count: Number.isFinite(input.beatCount) ? Math.max(0, Math.floor(input.beatCount)) : null,
    };

    if (input.completed) {
      row.completed = true;
      row.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('storyline_progress')
      .upsert(row, { onConflict: 'user_id,storyline_id' });

    if (error) {
      console.warn('Failed to record storyline progress:', error.message);
    }
  } catch (error) {
    console.warn('Failed to record storyline progress:', error);
  }
}

export async function recordView(storylineId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return; // Silent fail for unauthenticated

  await supabase
    .from('storyline_views')
    .upsert(
      { user_id: user.id, storyline_id: storylineId },
      { onConflict: 'user_id,storyline_id', ignoreDuplicates: true }
    );
}

export async function getStorylineLikeStatus(
  storylineId: string
): Promise<{ liked: boolean; likeCount: number }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  let liked = false;
  if (!authError && user) {
    const { data: existing } = await supabase
      .from('storyline_likes')
      .select('id')
      .eq('user_id', user.id)
      .eq('storyline_id', storylineId)
      .maybeSingle();
    liked = !!existing;
  }

  const { data: storyline } = await supabase
    .from('storylines')
    .select('like_count')
    .eq('id', storylineId)
    .single();

  return {
    liked,
    likeCount: storyline?.like_count ?? 0,
  };
}

export async function getLikedStorylineIds(): Promise<string[]> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return [];

  const { data } = await supabase
    .from('storyline_likes')
    .select('storyline_id')
    .eq('user_id', user.id);

  return (data ?? []).map((row) => row.storyline_id);
}
