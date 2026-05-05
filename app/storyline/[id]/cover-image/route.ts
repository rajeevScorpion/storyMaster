import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { resolveStorylineCoverSource } from '@/lib/story/storyline-cover';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

function missingCoverResponse() {
  return new NextResponse('Storyline cover image not found', {
    status: 404,
    headers: {
      'Cache-Control': 'public, max-age=60',
    },
  });
}

function inferContentType(path: string | null): string {
  if (!path) return 'image/webp';

  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.avif')) return 'image/avif';

  return 'image/webp';
}

function imageResponse(body: ArrayBuffer, contentType: string) {
  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const source = await resolveStorylineCoverSource(id);

  if (!source) {
    return missingCoverResponse();
  }

  if (source.storageBucket && source.storagePath) {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from(source.storageBucket)
      .download(source.storagePath);

    if (error || !data) {
      console.error('Failed to download storyline cover image:', error?.message);
      return missingCoverResponse();
    }

    const body = await data.arrayBuffer();
    return imageResponse(body, data.type || inferContentType(source.storagePath));
  }

  if (source.url.startsWith('https://')) {
    const response = NextResponse.redirect(source.url, 302);
    response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    return response;
  }

  return missingCoverResponse();
}
