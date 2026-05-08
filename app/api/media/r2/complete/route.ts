import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import { getR2PublicUrl, r2ObjectExists } from '@/lib/media/r2-server';
import { toR2Reference } from '@/lib/media/r2-reference';
import { recordMediaAsset, type MediaAssetType } from '@/lib/media/media-assets';
import { verifyUserCanWriteMediaObject } from '@/lib/media/media-access';

export const runtime = 'nodejs';

const VALID_ASSET_TYPES = new Set<MediaAssetType>([
  'beat_image',
  'storyboard_image',
  'character_reference',
  'storyline_cover',
  'share_cover',
  'youtube_thumbnail',
  'reel_thumbnail',
  'narration_audio',
  'portrait',
  'unknown',
]);

function isValidObjectKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('stories/')
    && !value.includes('..')
    && !value.startsWith('/')
    && value.length <= 1024;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const access = body?.access === 'public' ? 'public' : body?.access === 'private' ? 'private' : null;
  const objectKey = body?.objectKey;
  const bucket = typeof body?.bucket === 'string' ? body.bucket : null;
  const assetType = VALID_ASSET_TYPES.has(body?.assetType) ? body.assetType as MediaAssetType : 'unknown';

  if (!access || !bucket || !isValidObjectKey(objectKey)) {
    return NextResponse.json({ error: 'Invalid R2 completion request.' }, { status: 400 });
  }

  const accessCheck = await verifyUserCanWriteMediaObject(supabase, user.id, {
    objectKey,
    storyId: body?.storyId,
    storylineId: body?.storylineId,
  });
  if (!accessCheck.allowed) {
    return NextResponse.json({ error: 'Not authorized to complete media for this story.' }, { status: 403 });
  }

  const config = await getEffectiveMediaStorageConfig();
  if (!config.r2.enabled) {
    return NextResponse.json({ error: 'R2 is disabled for this environment.' }, { status: 409 });
  }

  let exists = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    exists = await r2ObjectExists({ bucket, objectKey });
    if (exists) break;
    await sleep(300 * (attempt + 1));
  }

  if (!exists) {
    return NextResponse.json({ error: 'R2 object was not found after upload.' }, { status: 404 });
  }

  const publicUrl = access === 'public' ? await getR2PublicUrl(objectKey) : null;
  const reference = access === 'private' ? toR2Reference(bucket, objectKey) : null;
  const cacheControl = typeof body?.cacheControl === 'string' ? body.cacheControl : null;

  await recordMediaAsset({
    storyId: accessCheck.storyId,
    beatId: typeof body?.beatId === 'string' ? body.beatId : null,
    nodeId: typeof body?.nodeId === 'string' ? body.nodeId : null,
    storylineId: accessCheck.storylineId,
    userId: user.id,
    assetType,
    storageProvider: 'r2',
    bucket,
    objectKey,
    publicUrl,
    mimeType: typeof body?.mimeType === 'string' ? body.mimeType : null,
    sizeBytes: typeof body?.sizeBytes === 'number' ? body.sizeBytes : null,
    width: typeof body?.width === 'number' ? body.width : null,
    height: typeof body?.height === 'number' ? body.height : null,
    durationSeconds: typeof body?.durationSeconds === 'number' ? body.durationSeconds : null,
    isPublic: access === 'public',
    cacheControl,
  });

  return NextResponse.json({
    storageProvider: 'r2',
    bucket,
    objectKey,
    publicUrl,
    reference,
    url: publicUrl ?? reference,
  });
}
