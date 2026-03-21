'use server';

import { createClient } from '@/lib/supabase/server';
import type { StorySession, StoryMap, StoryBeat } from '@/lib/types/story';
import type { DbStory } from '@/lib/types/database';
import type { StorylineChoice } from '@/lib/utils/storyline';

/**
 * Strip base64 data URLs from a StoryMap before saving to DB.
 * Keeps HTTP URLs intact (already uploaded to storage).
 */
function stripBase64(storyMap: StoryMap): StoryMap {
  const nodes: StoryMap['nodes'] = {};
  for (const [id, node] of Object.entries(storyMap.nodes)) {
    nodes[id] = {
      ...node,
      data: {
        ...node.data,
        imageUrl: node.data.imageUrl?.startsWith('data:') ? undefined : node.data.imageUrl,
        audioUrl: node.data.audioUrl?.startsWith('data:') ? undefined : node.data.audioUrl,
      },
    };
  }
  return { ...storyMap, nodes };
}

/**
 * Save or update a story in the database.
 * The storyMap should have storage URLs for uploaded assets before calling this.
 */
export async function saveStory(
  session: StorySession,
  storyMapWithUrls: StoryMap
): Promise<{ storyId: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const cleanMap = stripBase64(storyMapWithUrls);

  const storyData = {
    user_id: user.id,
    title: session.title,
    user_prompt: session.userPrompt,
    genre: session.genre,
    tone: session.tone,
    visual_style: session.visualStyle,
    target_age: session.targetAge,
    story_config: session.storyConfig as unknown as Record<string, unknown>,
    story_map: cleanMap as unknown as Record<string, unknown>,
    characters: session.characters as unknown as Record<string, unknown>[],
    setting: session.setting as unknown as Record<string, unknown>,
    status: session.status,
    narrator_voice: session.narratorVoice || null,
    updated_at: new Date().toISOString(),
  };

  // Upsert: if savedStoryId exists, update; otherwise insert
  if (session.savedStoryId) {
    const { error } = await supabase
      .from('stories')
      .update(storyData)
      .eq('id', session.savedStoryId)
      .eq('user_id', user.id);

    if (error) throw new Error(`Failed to update story: ${error.message}`);
    return { storyId: session.savedStoryId };
  }

  const { data, error } = await supabase
    .from('stories')
    .insert(storyData)
    .select('id')
    .single();

  if (error) throw new Error(`Failed to save story: ${error.message}`);
  return { storyId: data.id };
}

/**
 * Load a saved story from the database.
 */
export async function loadStory(storyId: string): Promise<StorySession> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .eq('id', storyId)
    .eq('user_id', user.id)
    .single();

  if (error || !data) throw new Error('Story not found');

  const story = data as DbStory;

  return {
    storySessionId: story.id,
    savedStoryId: story.id,
    userPrompt: story.user_prompt,
    title: story.title,
    genre: story.genre || 'adventure',
    tone: story.tone || 'playful',
    targetAge: story.target_age || 'all_ages',
    visualStyle: story.visual_style || 'cinematic storybook illustration',
    currentBeat: 0,
    maxBeats: (story.story_config as any)?.maxBeats || 6,
    status: story.status as 'active' | 'completed' | 'error',
    characters: (story.characters || []) as any,
    setting: (story.setting || { world: 'unknown', timeOfDay: 'unknown', mood: 'unknown' }) as any,
    storyConfig: (story.story_config || { language: 'english', ageGroup: 'all_ages', settingCountry: 'generic', maxBeats: 6 }) as any,
    storyMap: story.story_map as unknown as StoryMap,
    beats: [],
    choiceHistory: [],
    openThreads: [],
    allowedEndings: [],
    safetyProfile: 'all_ages',
    narratorVoice: story.narrator_voice || undefined,
  };
}

/**
 * List the current user's saved stories.
 */
export async function listUserStories(): Promise<Array<{
  id: string;
  title: string;
  status: string;
  updated_at: string;
  user_prompt: string;
}>> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('stories')
    .select('id, title, status, updated_at, user_prompt')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Failed to list stories: ${error.message}`);
  return data || [];
}

/**
 * Delete a story and its associated assets.
 */
export async function deleteStory(storyId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('stories')
    .delete()
    .eq('id', storyId)
    .eq('user_id', user.id);

  if (error) throw new Error(`Failed to delete story: ${error.message}`);
}

/**
 * Publish a storyline to the database.
 * Assets should already be uploaded by the client before calling this.
 */
export async function publishStoryline(params: {
  storyId: string;
  title: string;
  beats: StoryBeat[];
  choices: StorylineChoice[];
  nodePath: string[];
  coverImageUrl: string | null;
}): Promise<{ storylineId: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  // Get author name from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .single();

  const { data, error } = await supabase
    .from('storylines')
    .insert({
      story_id: params.storyId,
      user_id: user.id,
      title: params.title,
      beat_count: params.beats.length,
      cover_image_url: params.coverImageUrl,
      node_path: params.nodePath,
      beats: params.beats as unknown as Record<string, unknown>[],
      choices: params.choices as unknown as Record<string, unknown>[],
      author_name: profile?.display_name || 'Anonymous',
      is_public: true,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to publish storyline: ${error.message}`);
  return { storylineId: data.id };
}
