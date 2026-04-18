import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { loadStorylineWithBeats } from '@/app/actions/exploration';
import { notFound } from 'next/navigation';
import StorylinePlayer from '@/components/story/StorylinePlayer';
import StorylinePreview from '@/components/story/StorylinePreview';
import type { StorylineChoice } from '@/lib/utils/storyline';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();

  const { data: storyline } = await supabase
    .from('storylines')
    .select('title, author_name, cover_image_url')
    .eq('id', id)
    .single();

  if (!storyline) return { title: 'Storyline — Kissago' };

  const description = storyline.author_name
    ? `A storyline by ${storyline.author_name} on Kissago`
    : 'An interactive storyline on Kissago';

  return {
    title: `${storyline.title} — Kissago`,
    description,
    openGraph: {
      title: storyline.title,
      description,
      ...(storyline.cover_image_url && {
        images: [{ url: storyline.cover_image_url, width: 1200, height: 630 }],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title: storyline.title,
      description,
      ...(storyline.cover_image_url && {
        images: [storyline.cover_image_url],
      }),
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
  const { beats, choices } = await loadStorylineWithBeats(id);

  return (
    <Suspense>
      <StorylinePlayer
        storylineId={storyline.id}
        storyId={storyline.story_id}
        title={storyline.title}
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
