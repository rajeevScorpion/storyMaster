import { NextResponse } from 'next/server';

import { resolveStorylineShareCoverForId } from '@/lib/story/share-cover';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const cover = await resolveStorylineShareCoverForId(id);
  const response = NextResponse.redirect(cover.url, 302);
  response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  return response;
}
