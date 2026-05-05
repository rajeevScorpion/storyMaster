import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { loadStorylineWithBeats } from '@/app/actions/exploration';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import StorylinePlayer from '@/components/story/StorylinePlayer';
import StorylinePreview from '@/components/story/StorylinePreview';
import type { StorylineChoice } from '@/lib/utils/storyline';
import type { Metadata } from 'next';
import {
  resolveStorylineShareCover,
  type StorylineShareCoverRow,
} from '@/lib/story/share-cover';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getRequestOrigin(): Promise<string | null> {
  const configuredOrigin = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, '');

  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');
  if (!host) return null;

  const proto = (headerStore.get('x-forwarded-proto') ?? 'https').split(',')[0]?.trim() || 'https';
  const origin = `${proto}://${host.split(',')[0]?.trim()}`;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      url.protocol = 'https:';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();

  const { data: storyline } = await supabase
    .from('storylines')
    .select(`
      id,
      title,
      author_name,
      cover_image_url,
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

  const description = storyline.author_name
    ? `A storyline by ${storyline.author_name} on Kissago`
    : 'An interactive storyline on Kissago';
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

export default async function StorylinePage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch the storyline (RLS allows public storylines for everyone)
  const { data: storyline, error } = await supabase
    .from('storylines')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !storyline) {
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

  // Load beats via junction table (falls back to JSONB) with fresh signed URLs
  const { storyline: loadedStoryline, beats, choices } = await loadStorylineWithBeats(id);

  return (
    <Suspense>
      <StorylinePlayer
        storylineId={storyline.id}
        storyId={storyline.story_id}
        title={storyline.title}
        isVerticalStory={loadedStoryline.is_vertical_story === true || loadedStoryline.aspect_ratio === '9:16'}
        aspectRatio={loadedStoryline.aspect_ratio === '9:16' ? '9:16' : '16:9'}
        beats={beats}
        choices={choices as StorylineChoice[]}
        authorName={storyline.author_name}
        isOwner={isOwner}
        isSaved={isSaved}
        isLiked={isLiked}
        likeCount={likeCount}
        isLoggedIn={true}
      />
    </Suspense>
  );
}
