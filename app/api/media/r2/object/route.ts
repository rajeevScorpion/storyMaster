import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { verifyUserCanWriteMediaObject } from '@/lib/media/media-access';
import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import { getR2ObjectBuffer } from '@/lib/media/r2-server';
import { parseR2UrlLikeReference, toR2Reference } from '@/lib/media/r2-reference';

export const runtime = 'nodejs';

function isValidObjectKey(value: string | null): value is string {
  return Boolean(value)
    && value!.startsWith('stories/')
    && !value!.includes('..')
    && !value!.startsWith('/')
    && value!.length <= 1024;
}

function normalizeRangeHeader(value: string | null): string | undefined {
  if (!value || !/^bytes=(?:\d+-\d*|-\d+)$/.test(value.trim())) return undefined;
  return value.trim();
}

function parsePublicR2Url(
  value: string | null,
  publicBaseUrl: string | null,
  bucketName: string | null
): { bucket: string; objectKey: string } | null {
  if (!value || !publicBaseUrl || !bucketName) return null;

  try {
    const assetUrl = new URL(value);
    const baseUrl = new URL(publicBaseUrl);
    if (assetUrl.origin !== baseUrl.origin) return null;

    const basePath = baseUrl.pathname.replace(/\/+$/, '');
    if (basePath && !assetUrl.pathname.startsWith(`${basePath}/`)) return null;

    const objectKey = decodeURIComponent(
      assetUrl.pathname.slice(basePath.length).replace(/^\/+/, '')
    );
    if (!isValidObjectKey(objectKey)) return null;

    return { bucket: bucketName, objectKey };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const url = new URL(request.url);
  const config = await getEffectiveMediaStorageConfig();
  const allowedBuckets = new Set([
    config.r2.bucketName,
    config.r2.privateBucketName,
  ].filter((value): value is string => Boolean(value)));

  if (!config.r2.enabled || allowedBuckets.size === 0) {
    return NextResponse.json({ error: 'R2 object access is unavailable.' }, { status: 404 });
  }

  const bucketParam = url.searchParams.get('bucket')?.trim() || null;
  const keyParam = url.searchParams.get('key')?.trim() || null;
  const sourceUrl = url.searchParams.get('url')?.trim() || null;
  const sourceReference = sourceUrl ? parseR2UrlLikeReference(sourceUrl) : null;
  const publicReference = parsePublicR2Url(sourceUrl, config.r2.publicBaseUrl, config.r2.bucketName);
  const objectRef = bucketParam && isValidObjectKey(keyParam)
    ? { bucket: bucketParam, objectKey: keyParam }
    : sourceReference ?? publicReference;

  if (!objectRef || !isValidObjectKey(objectRef.objectKey) || !allowedBuckets.has(objectRef.bucket)) {
    return NextResponse.json({ error: 'Invalid R2 object request.' }, { status: 400 });
  }

  const accessCheck = await verifyUserCanWriteMediaObject(supabase, user.id, { objectKey: objectRef.objectKey });
  if (!accessCheck.allowed) {
    return NextResponse.json({ error: 'Not authorized to access media for this story.' }, { status: 403 });
  }

  try {
    const requestedRange = normalizeRangeHeader(request.headers.get('range'));
    const object = await getR2ObjectBuffer(
      toR2Reference(objectRef.bucket, objectRef.objectKey),
      { range: requestedRange }
    );
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

    const headers = new Headers({
      'Content-Type': object.contentType || 'application/octet-stream',
      'Content-Length': String(object.buffer.byteLength),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
    });
    if (object.contentRange) headers.set('Content-Range', object.contentRange);

    return new Response(body, {
      status: object.contentRange ? 206 : 200,
      headers,
    });
  } catch (err) {
    console.warn('R2 object proxy failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to load media object.' }, { status: 502 });
  }
}
