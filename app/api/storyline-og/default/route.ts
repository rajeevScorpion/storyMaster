import { NextResponse } from 'next/server';

import { createBrandedDefaultCoverBuffer, SOCIAL_SHARE_COVER_MIME_TYPE } from '@/lib/story/share-cover';
import type { StorylineFormat } from '@/lib/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeStoryFormat(value: string | null): StorylineFormat {
  return value === 'audio_story' ? 'audio_story' : 'visual_story';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const title = url.searchParams.get('title') || 'Kissago Story';
  const authorName = url.searchParams.get('author') || null;
  const storyFormat = normalizeStoryFormat(url.searchParams.get('format'));

  const buffer = await createBrandedDefaultCoverBuffer({
    title,
    authorName,
    storyFormat,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': SOCIAL_SHARE_COVER_MIME_TYPE,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
    },
  });
}
