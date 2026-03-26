import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { loadStorylineWithBeats } from '@/app/actions/exploration';
import { notFound } from 'next/navigation';
import StorylinePlayer from '@/components/story/StorylinePlayer';
import StorylinePreview from '@/components/story/StorylinePreview';
import type { StorylineChoice } from '@/lib/utils/storyline';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
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

  // Check authentication state
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
        isLoggedIn={true}
      />
    </Suspense>
  );
}
