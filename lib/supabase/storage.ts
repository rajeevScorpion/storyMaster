import { createClient } from './client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoryMap, StoryBeat } from '@/lib/types/story';

/**
 * Convert a base64 data URL to a Blob with the correct content type.
 */
export function base64ToBlob(base64DataUrl: string): { blob: Blob; contentType: string; ext: string } {
  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid base64 data URL');
  }
  const contentType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const ext = contentType.split('/')[1] || 'bin';
  return { blob: new Blob([bytes], { type: contentType }), contentType, ext };
}

/**
 * Upload a base64 data URL to Supabase Storage.
 * Returns the public URL of the uploaded file.
 */
export async function uploadAsset(
  bucket: string,
  path: string,
  base64DataUrl: string
): Promise<string> {
  const supabase = createClient();
  const { blob, contentType } = base64ToBlob(base64DataUrl);

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return urlData.publicUrl;
}

/**
 * Check if a string is a base64 data URL (not an HTTP URL).
 */
function isBase64DataUrl(url: string | undefined): boolean {
  return !!url && url.startsWith('data:');
}

/**
 * Upload images and audio for specified nodes to a storage bucket.
 * Returns a map of nodeId -> { imageUrl?, audioUrl? } with storage URLs.
 */
export async function uploadNodeAssets(
  bucket: string,
  basePath: string,
  storyMap: StoryMap,
  nodeIds: string[]
): Promise<Record<string, { imageUrl?: string; audioUrl?: string }>> {
  const results: Record<string, { imageUrl?: string; audioUrl?: string }> = {};
  const uploads: Promise<void>[] = [];

  for (const nodeId of nodeIds) {
    const node = storyMap.nodes[nodeId];
    if (!node) continue;

    results[nodeId] = {};

    if (isBase64DataUrl(node.data.imageUrl)) {
      const imgPath = `${basePath}/${nodeId}/image.webp`;
      uploads.push(
        uploadAsset(bucket, imgPath, node.data.imageUrl!).then((url) => {
          results[nodeId].imageUrl = url;
        })
      );
    } else if (node.data.imageUrl) {
      // Already a URL (previously uploaded), keep it
      results[nodeId].imageUrl = node.data.imageUrl;
    }

    if (isBase64DataUrl(node.data.audioUrl)) {
      const audioPath = `${basePath}/${nodeId}/audio.wav`;
      uploads.push(
        uploadAsset(bucket, audioPath, node.data.audioUrl!).then((url) => {
          results[nodeId].audioUrl = url;
        })
      );
    } else if (node.data.audioUrl) {
      results[nodeId].audioUrl = node.data.audioUrl;
    }
  }

  // Upload in parallel with concurrency limit
  const BATCH_SIZE = 4;
  for (let i = 0; i < uploads.length; i += BATCH_SIZE) {
    await Promise.all(uploads.slice(i, i + BATCH_SIZE));
  }

  return results;
}

/**
 * Deep clone a StoryMap and replace base64 data URLs with storage URLs.
 */
export function replaceBase64WithUrls(
  storyMap: StoryMap,
  assetMap: Record<string, { imageUrl?: string; audioUrl?: string }>
): StoryMap {
  const cloned: StoryMap = {
    ...storyMap,
    nodes: { ...storyMap.nodes },
  };

  for (const [nodeId, urls] of Object.entries(assetMap)) {
    const node = cloned.nodes[nodeId];
    if (!node) continue;

    cloned.nodes[nodeId] = {
      ...node,
      data: {
        ...node.data,
        ...(urls.imageUrl && { imageUrl: urls.imageUrl }),
        ...(urls.audioUrl && { audioUrl: urls.audioUrl }),
      },
    };
  }

  return cloned;
}

/**
 * Strip all base64 data URLs from a StoryMap (replace with empty string).
 * Used before saving to database to avoid bloating JSONB.
 */
export function stripBase64FromStoryMap(storyMap: StoryMap): StoryMap {
  const cloned: StoryMap = {
    ...storyMap,
    nodes: {},
  };

  for (const [nodeId, node] of Object.entries(storyMap.nodes)) {
    cloned.nodes[nodeId] = {
      ...node,
      data: {
        ...node.data,
        imageUrl: isBase64DataUrl(node.data.imageUrl) ? undefined : node.data.imageUrl,
        audioUrl: isBase64DataUrl(node.data.audioUrl) ? undefined : node.data.audioUrl,
      },
    };
  }

  return cloned;
}

/**
 * Upload a cover image for a storyline from a specific node.
 */
export async function uploadCoverImage(
  userId: string,
  storylineId: string,
  imageDataUrl: string
): Promise<string> {
  const path = `${userId}/${storylineId}/cover.webp`;
  return uploadAsset('public-storylines', path, imageDataUrl);
}

/**
 * Copy a file from one Supabase Storage bucket to another.
 * Downloads from the source bucket and uploads to the destination.
 * Returns the public URL of the uploaded file, or null on failure.
 */
export async function copyToPublicBucket(
  supabase: SupabaseClient,
  sourceUrl: string,
  sourceBucket: string,
  destBucket: string,
  destPath: string
): Promise<string | null> {
  const storagePath = extractStoragePath(sourceUrl, sourceBucket);
  if (!storagePath) return null;

  const { data: blob, error: dlError } = await supabase.storage
    .from(sourceBucket)
    .download(storagePath);

  if (dlError || !blob) {
    console.error('Failed to download source asset:', dlError?.message);
    return null;
  }

  const { error: ulError } = await supabase.storage
    .from(destBucket)
    .upload(destPath, blob, {
      contentType: blob.type || 'image/webp',
      upsert: true,
    });

  if (ulError) {
    console.error('Failed to upload to public bucket:', ulError.message);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from(destBucket)
    .getPublicUrl(destPath);

  return urlData.publicUrl;
}

/**
 * Extract the storage path from a Supabase Storage URL (public or signed).
 * Handles both formats:
 *   - Public:  /storage/v1/object/public/{bucket}/path
 *   - Signed:  /storage/v1/object/sign/{bucket}/path?token=...
 */
export function extractStoragePath(url: string, bucket: string): string | null {
  // Try public URL format
  const publicMarker = `/storage/v1/object/public/${bucket}/`;
  let idx = url.indexOf(publicMarker);
  if (idx !== -1) {
    return url.substring(idx + publicMarker.length);
  }

  // Try signed URL format
  const signedMarker = `/storage/v1/object/sign/${bucket}/`;
  idx = url.indexOf(signedMarker);
  if (idx !== -1) {
    const pathWithQuery = url.substring(idx + signedMarker.length);
    // Strip query params (e.g. ?token=...)
    const qIdx = pathWithQuery.indexOf('?');
    return qIdx !== -1 ? pathWithQuery.substring(0, qIdx) : pathWithQuery;
  }

  return null;
}

/**
 * Convert any Supabase Storage URL (public or signed) to canonical public format.
 * Returns the original string if it doesn't match any known format.
 */
export function normalizeStorageUrl(url: string, bucket: string): string {
  const path = extractStoragePath(url, bucket);
  if (!path) return url;
  // Reconstruct as public URL using the project's Supabase URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return url;
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Replace Supabase Storage public URLs in a StoryMap with signed URLs.
 * Must be called from a server context with a server supabase client.
 */
export async function signStoryMapAssetUrls(
  supabase: SupabaseClient,
  storyMap: StoryMap,
  bucket = 'story-assets',
  expiresIn = 3600
): Promise<StoryMap> {
  // Collect all paths that need signing
  const pathEntries: { nodeId: string; field: 'imageUrl' | 'audioUrl'; path: string }[] = [];

  for (const [nodeId, node] of Object.entries(storyMap.nodes)) {
    for (const field of ['imageUrl', 'audioUrl'] as const) {
      const url = node.data[field];
      if (!url) continue;
      const storagePath = extractStoragePath(url, bucket);
      if (storagePath) {
        pathEntries.push({ nodeId, field, path: storagePath });
      }
    }
  }

  // Infer audio path from image path when audioUrl is missing but imageUrl exists.
  // Both assets live in the same storage folder ({userId}/{storyId}/{nodeId}/).
  for (const [nodeId, node] of Object.entries(storyMap.nodes)) {
    if (node.data.imageUrl && !node.data.audioUrl) {
      const imgPath = extractStoragePath(node.data.imageUrl, bucket);
      if (imgPath) {
        const dir = imgPath.substring(0, imgPath.lastIndexOf('/'));
        pathEntries.push({ nodeId, field: 'audioUrl', path: `${dir}/audio.wav` });
      }
    }
  }

  if (pathEntries.length === 0) return storyMap;

  // Batch-create signed URLs
  const paths = pathEntries.map((e) => e.path);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, expiresIn);

  if (error || !data) {
    console.error('Failed to create signed URLs:', error);
    return storyMap;
  }

  // Build updated nodes
  const cloned: StoryMap = { ...storyMap, nodes: { ...storyMap.nodes } };

  for (let i = 0; i < pathEntries.length; i++) {
    const entry = pathEntries[i];
    const signed = data[i];
    if (signed.error || !signed.signedUrl) continue;

    const node = cloned.nodes[entry.nodeId];
    cloned.nodes[entry.nodeId] = {
      ...node,
      data: {
        ...node.data,
        [entry.field]: signed.signedUrl,
      },
    };
  }

  return cloned;
}

/**
 * Replace Supabase Storage public URLs in a flat StoryBeat[] with signed URLs.
 * Used by the storyline player page (server context).
 */
export async function signStorylineBeatsUrls(
  supabase: SupabaseClient,
  beats: StoryBeat[],
  bucket = 'story-assets',
  expiresIn = 3600
): Promise<StoryBeat[]> {
  const pathEntries: { index: number; field: 'imageUrl' | 'audioUrl'; path: string }[] = [];

  for (let i = 0; i < beats.length; i++) {
    for (const field of ['imageUrl', 'audioUrl'] as const) {
      const url = beats[i][field];
      if (!url) continue;
      const storagePath = extractStoragePath(url, bucket);
      if (storagePath) {
        pathEntries.push({ index: i, field, path: storagePath });
      }
    }
  }

  // Infer audio path from image path when audioUrl is missing but imageUrl exists.
  // Both assets live in the same storage folder ({userId}/{storyId}/{nodeId}/).
  for (let i = 0; i < beats.length; i++) {
    if (beats[i].imageUrl && !beats[i].audioUrl) {
      const imgPath = extractStoragePath(beats[i].imageUrl!, bucket);
      if (imgPath) {
        const dir = imgPath.substring(0, imgPath.lastIndexOf('/'));
        pathEntries.push({ index: i, field: 'audioUrl', path: `${dir}/audio.wav` });
      }
    }
  }

  if (pathEntries.length === 0) return beats;

  const paths = pathEntries.map((e) => e.path);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, expiresIn);

  if (error || !data) {
    console.error('Failed to create signed URLs for storyline beats:', error);
    return beats;
  }

  const cloned = beats.map((b) => ({ ...b }));

  for (let i = 0; i < pathEntries.length; i++) {
    const entry = pathEntries[i];
    const signed = data[i];
    if (signed.error || !signed.signedUrl) continue;
    cloned[entry.index] = { ...cloned[entry.index], [entry.field]: signed.signedUrl };
  }

  return cloned;
}
