import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { verifyUserCanWriteMediaObject } from '@/lib/media/media-access';
import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import { getR2ObjectBuffer } from '@/lib/media/r2-server';
import { toR2Reference } from '@/lib/media/r2-reference';

export const runtime = 'nodejs';

function isValidObjectKey(value: string | null): value is string {
  return Boolean(value)
    && value!.startsWith('stories/')
    && !value!.includes('..')
    && !value!.startsWith('/')
    && value!.length <= 1024;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const url = new URL(request.url);
  const bucket = url.searchParams.get('bucket')?.trim() || null;
  const objectKey = url.searchParams.get('key')?.trim() || null;

  if (!bucket || !isValidObjectKey(objectKey)) {
    return NextResponse.json({ error: 'Invalid R2 object request.' }, { status: 400 });
  }

  const config = await getEffectiveMediaStorageConfig();
  const allowedBuckets = new Set([
    config.r2.bucketName,
    config.r2.privateBucketName,
  ].filter((value): value is string => Boolean(value)));

  if (!config.r2.enabled || !allowedBuckets.has(bucket)) {
    return NextResponse.json({ error: 'R2 object access is unavailable.' }, { status: 404 });
  }

  const accessCheck = await verifyUserCanWriteMediaObject(supabase, user.id, { objectKey });
  if (!accessCheck.allowed) {
    return NextResponse.json({ error: 'Not authorized to access media for this story.' }, { status: 403 });
  }

  try {
    const object = await getR2ObjectBuffer(toR2Reference(bucket, objectKey));
    if (!object) {
      return NextResponse.json({ error: 'Media object not found.' }, { status: 404 });
    }

    const bytes = new Uint8Array(
      object.buffer.buffer,
      object.buffer.byteOffset,
      object.buffer.byteLength
    );

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': object.contentType || 'application/octet-stream',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.warn('R2 object proxy failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to load media object.' }, { status: 502 });
  }
}
