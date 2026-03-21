import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import StorylinePlayer from '@/components/story/StorylinePlayer';
import type { StoryBeat } from '@/lib/types/story';
import type { StorylineChoice } from '@/lib/utils/storyline';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function StorylinePage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch the storyline
  const { data: storyline, error } = await supabase
    .from('storylines')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !storyline) {
    notFound();
  }

  // Check if the current user is the owner
  const { data: { user } } = await supabase.auth.getUser();
  const isOwner = user?.id === storyline.user_id;

  return (
    <StorylinePlayer
      storylineId={storyline.id}
      storyId={storyline.story_id}
      title={storyline.title}
      beats={storyline.beats as unknown as StoryBeat[]}
      choices={storyline.choices as unknown as StorylineChoice[]}
      authorName={storyline.author_name}
      isOwner={isOwner}
    />
  );
}
