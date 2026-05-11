import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getEffectiveMediaStorageConfig } from '@/lib/media/storage-config';
import { deleteR2Object, getR2Bucket } from '@/lib/media/r2-server';
import { parseR2Reference } from '@/lib/media/r2-reference';
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
  const reference = typeof body?.reference === 'string' ? body.reference : null;
  const access = body?.access === 'public' ? 'public' : 'private';
  const objectKey = typeof body?.objectKey === 'string' ? body.objectKey : null;
  const parsedReference = reference ? parseR2Reference(reference) : null;

  if (!parsedReference && !isValidObjectKey(objectKey)) {
    return NextResponse.json({ error: 'Invalid R2 delete request.' }, { status: 400 });
  }

  const key = parsedReference?.objectKey ?? objectKey!;
  const accessCheck = await verifyUserCanWriteMediaObject(supabase, user.id, {
    objectKey: key,
    storyId: body?.storyId,
    storylineId: body?.storylineId,
  });
  if (!accessCheck.allowed) {
    return NextResponse.json({ error: 'Not authorized to delete media for this story.' }, { status: 403 });
  }

  const config = await getEffectiveMediaStorageConfig();
  if (!config.r2.enabled) {
    return NextResponse.json({ skipped: true, reason: 'R2 disabled' });
  }

  const bucket = parsedReference?.bucket ?? await getR2Bucket(access);

  try {
    await deleteR2Object(bucket, key);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.warn('R2 delete failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ deleted: false }, { status: 500 });
  }
}
