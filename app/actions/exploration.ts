'use server';

import { createClient } from '@/lib/supabase/server';
import { signStoryMapAssetUrls } from '@/lib/supabase/storage';
import type { StorySession, StoryMap, StoryBeat, StoryNode } from '@/lib/types/story';
import type { DbBeat, DbStory } from '@/lib/types/database';

/**
 * Convert a DbBeat row back into a StoryNode for the client StoryMap.
 */
function beatRowToNode(beat: DbBeat, childNodeIds: string[]): StoryNode {
  return {
    id: beat.node_id,
    beatNumber: beat.beat_number,
    parentId: beat.parent_node_id,
    selectedOptionId: beat.selected_option_id,
    data: {
      title: beat.title,
      beatNumber: beat.beat_number,
      isEnding: beat.is_ending,
      storyText: beat.story_text,
      sceneSummary: beat.scene_summary || '',
      options: (beat.options || []) as unknown as StoryBeat['options'],
      characters: (beat.characters || []) as unknown as StoryBeat['characters'],
      continuityNotes: (beat.continuity_notes || []) as string[],
      imagePrompt: beat.image_prompt || '',
      clues: (beat.clues || []) as string[],
      nextBeatGoal: beat.next_beat_goal || '',
      endingForecast: (beat.ending_forecast || []) as string[],
      imageUrl: beat.image_url || undefined,
      audioUrl: beat.audio_url || undefined,
    },
    children: childNodeIds,
  };
}

/**
 * Reconstruct a StoryMap from normalized beats rows.
 */
function reconstructStoryMap(beats: DbBeat[], currentNodeId?: string | null): StoryMap {
  const beatsByNodeId = new Map<string, DbBeat>();
  for (const beat of beats) {
    beatsByNodeId.set(beat.node_id, beat);
  }

  const childrenMap = new Map<string, string[]>();
  let rootNodeId = '';
  for (const beat of beats) {
    if (!beat.parent_node_id) {
      rootNodeId = beat.node_id;
    } else {
      const siblings = childrenMap.get(beat.parent_node_id) || [];
      siblings.push(beat.node_id);
      childrenMap.set(beat.parent_node_id, siblings);
    }
  }

  const nodes: Record<string, StoryNode> = {};
  for (const beat of beats) {
    const childNodeIds = childrenMap.get(beat.node_id) || [];
    nodes[beat.node_id] = beatRowToNode(beat, childNodeIds);
  }

  return {
    nodes,
    rootNodeId,
    currentNodeId: currentNodeId || rootNodeId,
  };
}

// ============================================================
// Story Tree Exploration
// ============================================================

/**
 * Load a story tree for exploration by any logged-in user.
 * Returns a StorySession with explorationMode = true for non-owners.
 */
export async function loadStoryTree(storyId: string): Promise<StorySession> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  // Fetch story metadata (RLS allows non-archived stories for authenticated users)
  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('*')
    .eq('id', storyId)
    .single();

  if (storyError || !story) throw new Error('Story not found or not accessible');

  const dbStory = story as DbStory;
  const isOwner = dbStory.user_id === user.id;

  // Fetch all beats for the story
  const { data: beats, error: beatsError } = await supabase
    .from('beats')
    .select('*')
    .eq('story_id', storyId)
    .order('beat_number', { ascending: true });

  if (beatsError) throw new Error('Failed to load story beats');

  let storyMap: StoryMap;
  if (beats && beats.length > 0) {
    // Always start from root node — exploration begins from beat 1
    storyMap = reconstructStoryMap(beats as DbBeat[], null);
  } else {
    // Fallback to legacy story_map JSONB
    storyMap = dbStory.story_map as unknown as StoryMap;
    // Reset to root for legacy maps too
    if (storyMap.rootNodeId) {
      storyMap = { ...storyMap, currentNodeId: storyMap.rootNodeId };
    }
  }

  // Replace private storage URLs with signed URLs so images/audio load in the browser
  storyMap = await signStoryMapAssetUrls(supabase, storyMap);

  // Track exploration for non-owners
  if (!isOwner) {
    await supabase
      .from('explored_stories')
      .upsert(
        {
          user_id: user.id,
          story_id: storyId,
          last_node_id: storyMap.currentNodeId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,story_id' }
      );
  }

  return {
    storySessionId: dbStory.id,
    savedStoryId: dbStory.id,
    explorationMode: !isOwner,
    sourceStoryOwnerId: dbStory.user_id,
    userPrompt: dbStory.user_prompt,
    title: dbStory.title,
    genre: dbStory.genre || 'adventure',
    tone: dbStory.tone || 'playful',
    targetAge: dbStory.target_age || 'all_ages',
    visualStyle: dbStory.visual_style || 'cinematic storybook illustration',
    currentBeat: 0,
    maxBeats: (dbStory.story_config as any)?.maxBeats || 6,
    status: dbStory.status as 'active' | 'completed' | 'error',
    characters: (dbStory.characters || []) as any,
    setting: (dbStory.setting || { world: 'unknown', timeOfDay: 'unknown', mood: 'unknown' }) as any,
    storyConfig: (dbStory.story_config || { language: 'english', ageGroup: 'all_ages', settingCountry: 'generic', maxBeats: 6 }) as any,
    storyMap,
    beats: [],
    choiceHistory: [],
    openThreads: [],
    allowedEndings: [],
    safetyProfile: 'all_ages',
    narratorVoice: dbStory.narrator_voice || undefined,
  };
}

/**
 * Update the user's exploration position in a story tree.
 */
export async function trackExploration(
  storyId: string,
  lastNodeId: string
): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return;

  await supabase
    .from('explored_stories')
    .upsert(
      {
        user_id: user.id,
        story_id: storyId,
        last_node_id: lastNodeId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,story_id' }
    );
}

/**
 * List stories the user has explored (not created).
 */
export async function listExploredStories(): Promise<Array<{
  id: string;
  story_id: string;
  last_node_id: string | null;
  updated_at: string;
  story: {
    id: string;
    title: string;
    user_prompt: string;
    status: string;
    user_id: string;
  };
}>> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('explored_stories')
    .select(`
      id,
      story_id,
      last_node_id,
      updated_at,
      stories (
        id,
        title,
        user_prompt,
        status,
        user_id
      )
    `)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Failed to list explored stories: ${error.message}`);

  return (data || []).map((row: any) => ({
    id: row.id,
    story_id: row.story_id,
    last_node_id: row.last_node_id,
    updated_at: row.updated_at,
    story: row.stories,
  }));
}

/**
 * Load a storyline using normalized beats (via storyline_beats junction).
 * Falls back to legacy beats JSONB if no junction rows exist.
 */
export async function loadStorylineWithBeats(storylineId: string): Promise<{
  storyline: {
    id: string;
    story_id: string;
    title: string;
    beat_count: number;
    cover_image_url: string | null;
    author_name: string | null;
    is_public: boolean;
    created_at: string;
  };
  beats: StoryBeat[];
  choices: { fromBeat: number; optionLabel: string }[];
}> {
  const supabase = await createClient();

  // Fetch storyline metadata
  const { data: storyline, error: slError } = await supabase
    .from('storylines')
    .select('id, story_id, title, beat_count, cover_image_url, author_name, is_public, created_at, beats, choices')
    .eq('id', storylineId)
    .single();

  if (slError || !storyline) throw new Error('Storyline not found');

  // Try normalized junction first
  const { data: junctionBeats } = await supabase
    .from('storyline_beats')
    .select(`
      position,
      choice_label,
      beats (*)
    `)
    .eq('storyline_id', storylineId)
    .order('position', { ascending: true });

  if (junctionBeats && junctionBeats.length > 0) {
    const beats: StoryBeat[] = junctionBeats.map((jb: any) => {
      const b = jb.beats as DbBeat;
      return {
        title: b.title,
        beatNumber: b.beat_number,
        isEnding: b.is_ending,
        storyText: b.story_text,
        sceneSummary: b.scene_summary || '',
        options: (b.options || []) as unknown as StoryBeat['options'],
        characters: (b.characters || []) as unknown as StoryBeat['characters'],
        continuityNotes: (b.continuity_notes || []) as string[],
        imagePrompt: b.image_prompt || '',
        clues: (b.clues || []) as string[],
        nextBeatGoal: b.next_beat_goal || '',
        endingForecast: (b.ending_forecast || []) as string[],
        imageUrl: b.image_url || undefined,
        audioUrl: b.audio_url || undefined,
      };
    });

    const choices = junctionBeats
      .filter((jb: any) => jb.choice_label)
      .map((jb: any, i: number) => ({
        fromBeat: i,
        optionLabel: jb.choice_label as string,
      }));

    return {
      storyline: {
        id: storyline.id,
        story_id: storyline.story_id,
        title: storyline.title,
        beat_count: storyline.beat_count,
        cover_image_url: storyline.cover_image_url,
        author_name: storyline.author_name,
        is_public: storyline.is_public,
        created_at: storyline.created_at,
      },
      beats,
      choices,
    };
  }

  // Fallback to legacy JSONB beats
  return {
    storyline: {
      id: storyline.id,
      story_id: storyline.story_id,
      title: storyline.title,
      beat_count: storyline.beat_count,
      cover_image_url: storyline.cover_image_url,
      author_name: storyline.author_name,
      is_public: storyline.is_public,
      created_at: storyline.created_at,
    },
    beats: (storyline.beats as any[]).map(b => b as unknown as StoryBeat),
    choices: (storyline.choices as any[]).map(c => c as { fromBeat: number; optionLabel: string }),
  };
}
