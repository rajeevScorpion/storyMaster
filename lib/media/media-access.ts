import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { extractMediaObjectScopeCandidates } from '@/lib/media/media-object-keys';

function cleanId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function userOwnsStory(
  supabase: SupabaseClient,
  userId: string,
  storyId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('stories')
    .select('id')
    .eq('id', storyId)
    .eq('user_id', userId)
    .maybeSingle();

  return !error && Boolean(data);
}

async function userCanReadStory(
  supabase: SupabaseClient,
  storyId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('stories')
    .select('id')
    .eq('id', storyId)
    .maybeSingle();

  return !error && Boolean(data);
}

async function loadReadableStoryline(
  supabase: SupabaseClient,
  storylineId: string
): Promise<{ id: string; story_id: string } | null> {
  const { data, error } = await supabase
    .from('storylines')
    .select('id, story_id')
    .eq('id', storylineId)
    .maybeSingle();

  return !error && data ? data as { id: string; story_id: string } : null;
}

export async function verifyUserCanReadMediaObject(
  supabase: SupabaseClient,
  input: { objectKey: string }
): Promise<{ allowed: boolean; storyId: string | null; storylineId: string | null }> {
  const scopeIds = extractMediaObjectScopeCandidates(input.objectKey);

  for (const scopeId of scopeIds) {
    if (await userCanReadStory(supabase, scopeId)) {
      return { allowed: true, storyId: scopeId, storylineId: null };
    }

    const storyline = await loadReadableStoryline(supabase, scopeId);
    if (storyline && await userCanReadStory(supabase, storyline.story_id)) {
      return { allowed: true, storyId: storyline.story_id, storylineId: storyline.id };
    }
  }

  return { allowed: false, storyId: null, storylineId: null };
}

async function loadOwnedStoryline(
  supabase: SupabaseClient,
  userId: string,
  storylineId: string
): Promise<{ id: string; story_id: string } | null> {
  const { data, error } = await supabase
    .from('storylines')
    .select('id, story_id')
    .eq('id', storylineId)
    .eq('user_id', userId)
    .maybeSingle();

  return !error && data ? data as { id: string; story_id: string } : null;
}

export async function verifyUserCanWriteMediaObject(
  supabase: SupabaseClient,
  userId: string,
  input: {
    objectKey: string;
    storyId?: unknown;
    storylineId?: unknown;
  }
): Promise<{ allowed: boolean; storyId: string | null; storylineId: string | null }> {
  const explicitStoryId = cleanId(input.storyId);
  const explicitStorylineId = cleanId(input.storylineId);

  if (explicitStoryId) {
    const ownsStory = await userOwnsStory(supabase, userId, explicitStoryId);
    if (!ownsStory) return { allowed: false, storyId: null, storylineId: null };
  }

  if (explicitStorylineId) {
    const storyline = await loadOwnedStoryline(supabase, userId, explicitStorylineId);
    if (!storyline) return { allowed: false, storyId: null, storylineId: null };
    if (explicitStoryId && storyline.story_id !== explicitStoryId) {
      return { allowed: false, storyId: null, storylineId: null };
    }
    return {
      allowed: true,
      storyId: explicitStoryId ?? storyline.story_id,
      storylineId: storyline.id,
    };
  }

  if (explicitStoryId) {
    return { allowed: true, storyId: explicitStoryId, storylineId: null };
  }

  const scopeIds = extractMediaObjectScopeCandidates(input.objectKey);

  for (const scopeId of scopeIds) {
    if (await userOwnsStory(supabase, userId, scopeId)) {
      return { allowed: true, storyId: scopeId, storylineId: null };
    }

    const storyline = await loadOwnedStoryline(supabase, userId, scopeId);
    if (storyline) {
      return { allowed: true, storyId: storyline.story_id, storylineId: storyline.id };
    }
  }

  return { allowed: false, storyId: null, storylineId: null };
}
