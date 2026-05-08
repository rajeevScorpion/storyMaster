import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import { createR2PresignedPutUrl } from '@/lib/media/r2-server';
import { verifyUserCanWriteMediaObject } from '@/lib/media/media-access';

export const runtime = 'nodejs';

function isValidObjectKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('stories/')
    && !value.includes('..')
    && !value.startsWith('/')
    && value.length <= 1024;
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
  const contentType = typeof body?.contentType === 'string' && body.contentType.trim()
    ? body.contentType.trim()
    : 'application/octet-stream';

  if (!access || !isValidObjectKey(objectKey)) {
    return NextResponse.json({ error: 'Invalid R2 upload request.' }, { status: 400 });
  }

  const accessCheck = await verifyUserCanWriteMediaObject(supabase, user.id, {
    objectKey,
    storyId: body?.storyId,
    storylineId: body?.storylineId,
  });
  if (!accessCheck.allowed) {
    return NextResponse.json({ error: 'Not authorized to upload media for this story.' }, { status: 403 });
  }

  const config = await getEffectiveMediaStorageConfig();
  const assetType = typeof body?.assetType === 'string' ? body.assetType : 'unknown';
  if (!config.r2.enabled) {
    return NextResponse.json({
      enabled: false,
      reason: config.envStatus.missing.length > 0
        ? `Missing R2 env: ${config.envStatus.missing.join(', ')}`
        : 'R2 is disabled for this environment.',
    });
  }
  if (access === 'public' && !config.r2.publicDeliveryEnabled) {
    return NextResponse.json({ enabled: false, reason: 'R2 public delivery is disabled.' });
  }
  const allowedForAsset =
    assetType === 'narration_audio'
      ? config.settings.r2UseForNarrationAudio
      : assetType === 'storyline_cover'
        || assetType === 'share_cover'
        || assetType === 'youtube_thumbnail'
        || assetType === 'reel_thumbnail'
          ? config.settings.r2UseForCovers
          : config.settings.r2UseForImages;
  if (!allowedForAsset) {
    return NextResponse.json({ enabled: false, reason: `R2 disabled for ${assetType}.` });
  }

  const cacheControl = typeof body?.cacheControl === 'string' && body.cacheControl.trim()
    ? body.cacheControl.trim()
    : access === 'public'
      ? config.r2.cacheControlPublic
      : config.r2.cacheControlPrivate;

  try {
    const presigned = await createR2PresignedPutUrl({
      access,
      objectKey,
      contentType,
      cacheControl,
      expiresIn: 900,
    });

    return NextResponse.json({
      enabled: true,
      access,
      bucket: presigned.bucket,
      objectKey: presigned.objectKey,
      uploadUrl: presigned.uploadUrl,
      publicUrl: presigned.publicUrl ?? null,
      reference: presigned.reference ?? null,
      requiredHeaders: {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
      },
    });
  } catch (err) {
    console.error('Failed to create R2 presigned upload URL:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create R2 upload URL.' },
      { status: 500 }
    );
  }
}
