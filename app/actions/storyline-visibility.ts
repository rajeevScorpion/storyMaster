'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getMediaPipelineSettings } from '@/lib/media/processing-mode';
import { resolveValidatedPublishQuality } from '@/lib/story/publish-quality';
import {
  generateShareToken,
  normalizePublishQuality,
  normalizeStorylineVisibility,
  type StorylinePublishQuality,
  type StorylineVisibility,
} from '@/lib/story/visibility';

export interface StorylineVisibilityState {
  storylineId: string;
  visibility: StorylineVisibility;
  shareToken: string | null;
  publishQuality: StorylinePublishQuality;
  moderationStatus: string;
  publishedAt: string | null;
  /** Set when a requested high quality silently fell back to standard. */
  notice: string | null;
}

async function loadOwnedStoryline(storylineId: string, userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('storylines')
    .select('id, user_id, story_id, visibility, share_token, publish_quality, moderation_status, published_at')
    .eq('id', storylineId)
    .single();
  if (error || !data) throw new Error('Storyline not found.');
  if (data.user_id !== userId) throw new Error('Forbidden.');
  return data;
}

function toState(row: {
  id: string;
  visibility: string;
  share_token: string | null;
  publish_quality: string;
  moderation_status: string;
  published_at: string | null;
}, notice: string | null = null): StorylineVisibilityState {
  return {
    storylineId: row.id,
    visibility: normalizeStorylineVisibility(row.visibility),
    shareToken: row.share_token,
    publishQuality: normalizePublishQuality(row.publish_quality),
    moderationStatus: row.moderation_status,
    publishedAt: row.published_at,
    notice,
  };
}

export async function getStorylineVisibilityState(storylineId: string): Promise<StorylineVisibilityState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return toState(await loadOwnedStoryline(storylineId, user.id));
}

/**
 * Owner-facing visibility control. Server-validates everything the client
 * asks for: admin publishing/unlisted toggles, HQ entitlement + share_high
 * availability for quality='high' (silent fallback to standard with a
 * notice), moderation gate for public listings.
 */
export async function setStorylineVisibility(input: {
  storylineId: string;
  visibility: StorylineVisibility;
  quality?: StorylinePublishQuality;
}): Promise<StorylineVisibilityState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const row = await loadOwnedStoryline(input.storylineId, user.id);
  const settings = await getMediaPipelineSettings();
  const visibility = normalizeStorylineVisibility(input.visibility);

  if (visibility === 'public' && !settings.publicPublishingEnabled) {
    throw new Error('Public publishing is currently disabled by the admin.');
  }
  if (visibility === 'unlisted' && !settings.unlistedSharingEnabled) {
    throw new Error('Unlisted sharing is currently disabled by the admin.');
  }

  // Quality: never trust the client selection.
  const validated = await resolveValidatedPublishQuality(
    row.story_id,
    input.quality ?? row.publish_quality
  );
  const quality = validated.quality;
  const notice = validated.notice;

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    visibility,
    publish_quality: quality,
  };
  if (visibility === 'public') {
    update.published_at = row.published_at ?? now;
    update.unpublished_at = null;
    if (settings.moderationRequiredForPublic && row.moderation_status === 'none') {
      update.moderation_status = 'pending';
    }
  } else {
    if (row.visibility === 'public') update.unpublished_at = now;
    if (visibility === 'unlisted' && !row.share_token) {
      update.share_token = generateShareToken();
    }
  }

  const { data: updated, error } = await admin
    .from('storylines')
    .update(update)
    .eq('id', row.id)
    .select('id, visibility, share_token, publish_quality, moderation_status, published_at')
    .single();
  if (error || !updated) throw new Error(`Failed to update visibility: ${error?.message}`);
  return toState(updated, notice);
}

/** Invalidate the current unlisted link and mint a new one. */
export async function rotateStorylineShareToken(storylineId: string): Promise<StorylineVisibilityState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const row = await loadOwnedStoryline(storylineId, user.id);

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from('storylines')
    .update({ share_token: generateShareToken() })
    .eq('id', row.id)
    .select('id, visibility, share_token, publish_quality, moderation_status, published_at')
    .single();
  if (error || !updated) throw new Error(`Failed to rotate share token: ${error?.message}`);
  return toState(updated);
}

/** Kill the unlisted link entirely (also flips an unlisted storyline private). */
export async function revokeStorylineShareToken(storylineId: string): Promise<StorylineVisibilityState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const row = await loadOwnedStoryline(storylineId, user.id);

  const admin = createAdminClient();
  const update: Record<string, unknown> = { share_token: null };
  if (row.visibility === 'unlisted') update.visibility = 'private';
  const { data: updated, error } = await admin
    .from('storylines')
    .update(update)
    .eq('id', row.id)
    .select('id, visibility, share_token, publish_quality, moderation_status, published_at')
    .single();
  if (error || !updated) throw new Error(`Failed to revoke share token: ${error?.message}`);
  return toState(updated);
}
