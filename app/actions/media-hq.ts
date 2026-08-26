'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { getMediaPipelineSettings } from '@/lib/media/processing-mode';
import { isHqEntitled } from '@/lib/media/retention';
import { createR2SignedGetUrl, r2ObjectExists } from '@/lib/media/r2-server';

export type HqUnavailableReason =
  | 'none'          // no server-pipeline original exists for this beat
  | 'not_entitled'  // plan does not include HQ download
  | 'expired'       // original retention window has passed
  | 'not_signed_in';

export interface BeatHqDownloadState {
  available: boolean;
  reason: HqUnavailableReason | null;
  mediaGroupId: string | null;
  /** When HQ access ends (shown as "available until ..."). */
  expiresAt: string | null;
  entitled: boolean;
}

interface OriginalRow {
  media_group_id: string | null;
  bucket: string;
  object_key: string;
  user_id: string | null;
  original_expires_at: string | null;
  metadata_json: Record<string, unknown> | null;
  mime_type: string | null;
}

function originalIsExpired(row: OriginalRow, now = Date.now()): boolean {
  if (row.metadata_json && typeof row.metadata_json === 'object' && 'expiredAt' in row.metadata_json) return true;
  if (!row.original_expires_at) return false;
  return new Date(row.original_expires_at).getTime() <= now;
}

async function loadLatestOriginalForBeat(storyId: string, nodeId: string): Promise<OriginalRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('media_assets')
    .select('media_group_id, bucket, object_key, user_id, original_expires_at, metadata_json, mime_type')
    .eq('story_id', storyId)
    .eq('node_id', nodeId)
    .eq('variant', 'original')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as OriginalRow | null) ?? null;
}

/** Owner-facing state for the HQ download control on a beat. */
export async function getBeatHqDownloadState(storyId: string, nodeId: string): Promise<BeatHqDownloadState> {
  const empty: BeatHqDownloadState = { available: false, reason: 'none', mediaGroupId: null, expiresAt: null, entitled: false };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ...empty, reason: 'not_signed_in' };

  const [row, settings, pricing] = await Promise.all([
    loadLatestOriginalForBeat(storyId, nodeId),
    getMediaPipelineSettings(),
    getPricingRuntimeContext().catch(() => null),
  ]);
  const entitled = isHqEntitled(pricing?.snapshot.entitlementPlanKey ?? 'free', settings);
  if (!row || row.user_id !== user.id) return { ...empty, entitled };
  if (originalIsExpired(row)) {
    return { available: false, reason: 'expired', mediaGroupId: row.media_group_id, expiresAt: row.original_expires_at, entitled };
  }
  if (!entitled) {
    return { available: false, reason: 'not_entitled', mediaGroupId: row.media_group_id, expiresAt: row.original_expires_at, entitled };
  }
  return { available: true, reason: null, mediaGroupId: row.media_group_id, expiresAt: row.original_expires_at, entitled };
}

export type HqDownloadUrlResult =
  | { url: string; expiresInSeconds: number; mimeType: string | null }
  | { error: HqUnavailableReason };

/**
 * Mint a short-lived signed URL for the private original — only at click
 * time, never stored, and re-checking auth + ownership + entitlement +
 * expiry on every call (pack security rules).
 */
export async function createHqDownloadUrl(input: { storyId: string; nodeId: string }): Promise<HqDownloadUrlResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'not_signed_in' };

  const [row, settings, pricing] = await Promise.all([
    loadLatestOriginalForBeat(input.storyId, input.nodeId),
    getMediaPipelineSettings(),
    getPricingRuntimeContext().catch(() => null),
  ]);
  if (!row || row.user_id !== user.id) return { error: 'none' };
  if (originalIsExpired(row)) return { error: 'expired' };
  if (!isHqEntitled(pricing?.snapshot.entitlementPlanKey ?? 'free', settings)) return { error: 'not_entitled' };

  const exists = await r2ObjectExists({ bucket: row.bucket, objectKey: row.object_key });
  if (!exists) return { error: 'expired' };

  const url = await createR2SignedGetUrl(row.bucket, row.object_key, settings.signedUrlTtlSeconds);
  if (!url) return { error: 'none' };
  return { url, expiresInSeconds: settings.signedUrlTtlSeconds, mimeType: row.mime_type };
}
