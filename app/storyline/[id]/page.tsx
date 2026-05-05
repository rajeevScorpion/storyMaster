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
  getAbsoluteStorylineCoverImageUrl,
  getStorylineCoverImagePath,
  resolveStorylineCoverMetadata,
} from '@/lib/story/storyline-cover';

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
  return `${proto}://${host.split(',')[0]?.trim()}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();

  const { data: storyline } = await supabase
    .from('storylines')
    .select('title, author_name, cover_image_url, is_vertical_story, aspect_ratio')
    .eq('id', id)
    .single();

  if (!storyline) return { title: 'Storyline - Kissago' };

  const description = storyline.author_name
    ? `A storyline by ${storyline.author_name} on Kissago`
    : 'An interactive storyline on Kissago';
  const coverMetadata = await resolveStorylineCoverMetadata(id);
  const coverSource = coverMetadata?.source ?? null;
  const origin = coverSource ? await getRequestOrigin() : null;
  const coverImageUrl = coverSource && origin
    ? getAbsoluteStorylineCoverImageUrl(id, origin, coverSource.version)
    : null;
  const isVertical = coverMetadata?.isVertical
    ?? (storyline.is_vertical_story === true || storyline.aspect_ratio === '9:16');
  const imageSize = isVertical
    ? { width: 1080, height: 1920 }
    : { width: 1200, height: 630 };
  const openGraphImages = coverImageUrl
    ? [{ url: coverImageUrl, ...imageSize, alt: storyline.title }]
    : undefined;

  return {
    title: `${storyline.title} - Kissago`,
    description,
    openGraph: {
      title: storyline.title,
      description,
      type: 'article',
      ...(openGraphImages && { images: openGraphImages }),
    },
    twitter: {
      card: 'summary_large_image',
      title: storyline.title,
      description,
      ...(coverImageUrl && { images: [coverImageUrl] }),
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
    const coverMetadata = await resolveStorylineCoverMetadata(id);
    const previewCoverImageUrl = coverMetadata?.source
      ? getStorylineCoverImagePath(id, coverMetadata.source.version)
      : storyline.cover_image_url;

    return (
      <StorylinePreview
        storylineId={storyline.id}
        title={storyline.title}
        authorName={storyline.author_name}
        coverImageUrl={previewCoverImageUrl}
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
