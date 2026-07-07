import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { shareTokensEqual } from '@/lib/story/visibility';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import StorylinePersistenceLoader from '@/components/story/StorylinePersistenceLoader';
import StorylinePreview from '@/components/story/StorylinePreview';
import type { Metadata } from 'next';
import {
  resolveStorylineShareCover,
  type StorylineShareCoverRow,
} from '@/lib/story/share-cover';
import { getFirstBeatShareExcerpt } from '@/lib/story/share-message';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ token?: string }>;
}

function normalizeOriginValue(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      url.protocol = 'https:';
    }
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function isLocalOrigin(value: string | null): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

async function getRequestOrigin(): Promise<string | null> {
  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');
  const proto = (headerStore.get('x-forwarded-proto') ?? 'https').split(',')[0]?.trim() || 'https';
  const headerOrigin = host ? normalizeOriginValue(`${proto}://${host.split(',')[0]?.trim()}`) : null;
  const configuredOrigin = normalizeOriginValue(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL);

  if (headerOrigin && !isLocalOrigin(headerOrigin)) return headerOrigin;
  if (configuredOrigin && !isLocalOrigin(configuredOrigin)) return configuredOrigin;
  return headerOrigin ?? configuredOrigin;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const { token } = (await searchParams) ?? {};
  // Tokenized (unlisted) links must never be indexed or previewed richly.
  if (token) {
    return { title: 'Storyline - Kissago', robots: { index: false, follow: false } };
  }
  const supabase = await createClient();

  const { data: storyline } = await supabase
    .from('storylines')
    .select(`
      id,
      title,
      author_name,
      cover_image_url,
      beats,
      is_vertical_story,
      aspect_ratio,
      share_cover_url,
      share_cover_source,
      share_cover_status,
      share_cover_width,
      share_cover_height,
      share_cover_mime_type,
      share_cover_version,
      youtube_thumbnail_url,
      youtube_thumbnail_source,
      youtube_thumbnail_status,
      youtube_thumbnail_width,
      youtube_thumbnail_height,
      youtube_thumbnail_mime_type,
      youtube_thumbnail_version,
      story_format,
      story_visual_mode,
      orientation
    `)
    .eq('id', id)
    .eq('is_public', true)
    .single();

  if (!storyline) return { title: 'Storyline - Kissago' };

  const defaultDescription = storyline.author_name
    ? `A storyline by ${storyline.author_name} on Kissago`
    : 'An interactive storyline on Kissago';
  const description = getFirstBeatShareExcerpt((storyline as { beats?: unknown }).beats)
    ?? defaultDescription;
  const origin = await getRequestOrigin();
  const canonicalUrl = origin ? new URL(`/storyline/${id}`, origin).toString() : undefined;
  const cover = resolveStorylineShareCover(storyline as StorylineShareCoverRow, { origin });
  const pageTitle = `${storyline.title} - Kissago`;

  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: pageTitle,
    description,
    alternates: canonicalUrl ? { canonical: canonicalUrl } : undefined,
    openGraph: {
      title: storyline.title,
      description,
      type: 'article',
      url: canonicalUrl,
      images: [{
        url: cover.url,
        secureUrl: cover.url,
        width: 1200,
        height: 630,
        type: cover.mimeType,
        alt: storyline.title,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: storyline.title,
      description,
      images: [{
        url: cover.url,
        alt: storyline.title,
      }],
    },
  };
}

export default async function StorylinePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { token } = (await searchParams) ?? {};
  const supabase = await createClient();

  // Fetch the storyline (RLS allows public storylines for everyone)
  let { data: storyline } = await supabase
    .from('storylines')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  // Unlisted storylines are hidden from RLS; a valid revocable share token
  // grants access through a server-side service-role check instead.
  let validatedShareToken: string | null = null;
  if (!storyline && token) {
    const admin = createAdminClient();
    const { data: tokenRow } = await admin
      .from('storylines')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (
      tokenRow
      && tokenRow.visibility === 'unlisted'
      && shareTokensEqual(tokenRow.share_token, token)
    ) {
      storyline = tokenRow;
      validatedShareToken = token;
    }
  }

  if (!storyline) {
    notFound();
  }

  // Check authentication
  const { data: { user } } = await supabase.auth.getUser();

  // Unauthenticated users see a preview with sign-in CTA
  if (!user) {
    return (
      <StorylinePreview
        storylineId={storyline.id}
        title={storyline.title}
        authorName={storyline.author_name}
        coverImageUrl={storyline.cover_image_url}
        beatCount={storyline.beat_count}
      />
    );
  }

  // Authenticated users get the full experience
  const isOwner = user.id === storyline.user_id;

  let isSaved = false;
  const { count } = await supabase
    .from('saved_storylines')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('storyline_id', id);
  isSaved = (count ?? 0) > 0;

  // Check like status
  let isLiked = false;
  const { count: likeCheck } = await supabase
    .from('storyline_likes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('storyline_id', id);
  isLiked = (likeCheck ?? 0) > 0;
  const likeCount = storyline.like_count ?? 0;

  return (
    <Suspense>
      <StorylinePersistenceLoader
        storylineId={storyline.id}
        storyId={storyline.story_id}
        userId={user.id}
        title={storyline.title}
        coverImageUrl={storyline.cover_image_url}
        beatCount={storyline.beat_count}
        isVerticalStory={storyline.is_vertical_story === true || storyline.aspect_ratio === '9:16'}
        aspectRatio={storyline.aspect_ratio === '9:16' ? '9:16' : '16:9'}
        authorName={storyline.author_name}
        isOwner={isOwner}
        isSaved={isSaved}
        isLiked={isLiked}
        likeCount={likeCount}
        shareToken={validatedShareToken}
      />
    </Suspense>
  );
}
