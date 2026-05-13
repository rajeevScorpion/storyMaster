import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

export type MediaAssetType =
  | 'beat_image'
  | 'storyboard_image'
  | 'character_reference'
  | 'storyline_cover'
  | 'share_cover'
  | 'youtube_thumbnail'
  | 'reel_thumbnail'
  | 'reel_style_sample'
  | 'narration_audio'
  | 'portrait'
  | 'unknown';

export async function recordMediaAsset(input: {
  storyId?: string | null;
  beatId?: string | null;
  nodeId?: string | null;
  storylineId?: string | null;
  userId?: string | null;
  assetType: MediaAssetType;
  storageProvider: 'supabase' | 'r2';
  bucket: string;
  objectKey: string;
  publicUrl?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  isPublic: boolean;
  cacheControl?: string | null;
  status?: 'ready' | 'failed';
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('media_assets').upsert({
      story_id: input.storyId ?? null,
      beat_id: input.beatId ?? null,
      node_id: input.nodeId ?? null,
      storyline_id: input.storylineId ?? null,
      user_id: input.userId ?? null,
      asset_type: input.assetType,
      storage_provider: input.storageProvider,
      bucket: input.bucket,
      object_key: input.objectKey,
      public_url: input.publicUrl ?? null,
      mime_type: input.mimeType ?? null,
      size_bytes: input.sizeBytes ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      duration_seconds: input.durationSeconds ?? null,
      is_public: input.isPublic,
      cache_control: input.cacheControl ?? null,
      status: input.status ?? 'ready',
      error_message: input.errorMessage ?? null,
    }, { onConflict: 'storage_provider,bucket,object_key' });
  } catch (error) {
    console.error('Failed to record media asset metadata:', error instanceof Error ? error.message : error);
  }
}
