'use server';

import { createClient } from '@/lib/supabase/server';
import type { StorySession, StoryMap, StoryBeat, StoryNode } from '@/lib/types/story';
import type { DbStory, DbBeat } from '@/lib/types/database';
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
 * Convert a StoryNode + beat data into a beats table row object.
 */
function nodeToBeatRow(storyId: string, nodeId: string, node: StoryNode, userId: string) {
  return {
    story_id: storyId,
    node_id: nodeId,
    beat_number: node.beatNumber,
    parent_node_id: node.parentId || null,
    selected_option_id: node.selectedOptionId || null,
    generated_by: userId,
    title: node.data.title,
    is_ending: node.data.isEnding,
    story_text: node.data.storyText,
    scene_summary: node.data.sceneSummary || null,
    options: node.data.options as unknown as Record<string, unknown>[],
    characters: node.data.characters as unknown as Record<string, unknown>[],
    continuity_notes: node.data.continuityNotes || null,
    image_prompt: node.data.imagePrompt || null,
    clues: node.data.clues || null,
    next_beat_goal: node.data.nextBeatGoal || null,
    ending_forecast: node.data.endingForecast || null,
    image_url: node.data.imageUrl?.startsWith('data:') ? null : (node.data.imageUrl || null),
    audio_url: node.data.audioUrl?.startsWith('data:') ? null : (node.data.audioUrl || null),
  };
}

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
  // Build a map of node_id → DbBeat
  const beatsByNodeId = new Map<string, DbBeat>();
  for (const beat of beats) {
    beatsByNodeId.set(beat.node_id, beat);
  }

  // Build children map: parent_node_id → child node_ids
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

  // Build StoryNode records
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
// Save / Load Story
// ============================================================

/**
 * Save or update a story in the database.
 * Dual-writes: saves both story_map JSONB (legacy) and normalized beats.
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
    current_node_id: cleanMap.currentNodeId || null,
    updated_at: new Date().toISOString(),
  };

  let storyId: string;

  // Upsert: if savedStoryId exists, update; otherwise insert
  if (session.savedStoryId) {
    const { error } = await supabase
      .from('stories')
      .update(storyData)
      .eq('id', session.savedStoryId)
      .eq('user_id', user.id);

    if (error) throw new Error(`Failed to update story: ${error.message}`);
    storyId = session.savedStoryId;
  } else {
    const { data, error } = await supabase
      .from('stories')
      .insert(storyData)
      .select('id')
      .single();

    if (error) throw new Error(`Failed to save story: ${error.message}`);
    storyId = data.id;
  }

  // Dual-write: batch upsert all nodes into beats table
  const beatRows = Object.entries(cleanMap.nodes).map(([nodeId, node]) =>
    nodeToBeatRow(storyId, nodeId, node, user.id)
  );

  if (beatRows.length > 0) {
    const { error: beatsError } = await supabase
      .from('beats')
      .upsert(beatRows, { onConflict: 'story_id,node_id' });

    if (beatsError) {
      console.error('Failed to upsert beats (non-fatal):', beatsError.message);
    }
  }

  return { storyId };
}

/**
 * Load a saved story from the database.
 * Tries normalized beats first, falls back to story_map JSONB.
 */
export async function loadStory(storyId: string): Promise<StorySession> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .eq('id', storyId)
    .single();

  if (error || !data) throw new Error('Story not found');

  const story = data as DbStory;

  // Try loading from normalized beats table
  const { data: beats } = await supabase
    .from('beats')
    .select('*')
    .eq('story_id', storyId)
    .order('beat_number', { ascending: true });

  let storyMap: StoryMap;
  if (beats && beats.length > 0) {
    storyMap = reconstructStoryMap(beats as DbBeat[], story.current_node_id);
  } else {
    // Fallback to legacy story_map JSONB
    storyMap = story.story_map as unknown as StoryMap;
  }

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
    storyMap,
    beats: [],
    choiceHistory: [],
    openThreads: [],
    allowedEndings: [],
    safetyProfile: 'all_ages',
    narratorVoice: story.narrator_voice || undefined,
  };
}

// ============================================================
// Incremental Beat Save
// ============================================================

/**
 * Save a single beat incrementally (fire-and-forget from client).
 * Works for both story creators and explorers (shared branching).
 */
export async function saveBeat(
  storyId: string,
  nodeId: string,
  node: StoryNode
): Promise<{ beatId: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const beatRow = nodeToBeatRow(storyId, nodeId, node, user.id);

  const { data, error } = await supabase
    .from('beats')
    .upsert(beatRow, { onConflict: 'story_id,node_id' })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to save beat: ${error.message}`);
  return { beatId: data.id };
}

/**
 * Update a beat's asset URLs (e.g., after uploading audio).
 */
export async function updateBeatAssets(
  storyId: string,
  nodeId: string,
  assets: { imageUrl?: string; audioUrl?: string }
): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const updateData: Record<string, unknown> = {};
  if (assets.imageUrl) updateData.image_url = assets.imageUrl;
  if (assets.audioUrl) updateData.audio_url = assets.audioUrl;

  if (Object.keys(updateData).length === 0) return;

  const { error } = await supabase
    .from('beats')
    .update(updateData)
    .eq('story_id', storyId)
    .eq('node_id', nodeId)
    .eq('generated_by', user.id);

  if (error) {
    console.error('Failed to update beat assets:', error.message);
  }
}

// ============================================================
// Auto-Publish Storyline
// ============================================================

/**
 * Compute a path hash for duplicate storyline detection.
 * Uses a simple hash of the node_path joined by '|'.
 */
async function computePathHash(nodePath: string[]): Promise<string> {
  const data = new TextEncoder().encode(nodePath.join('|'));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Walk from an ending beat back to root to get the full node path.
 */
function walkPathToRoot(beats: DbBeat[], endingNodeId: string): string[] {
  const beatMap = new Map<string, DbBeat>();
  for (const beat of beats) {
    beatMap.set(beat.node_id, beat);
  }

  const path: string[] = [];
  let currentId: string | null = endingNodeId;
  while (currentId) {
    path.unshift(currentId);
    const beat = beatMap.get(currentId);
    currentId = beat?.parent_node_id || null;
  }
  return path;
}

/**
 * Auto-publish a completed storyline when an ending beat is reached.
 * - Checks for duplicate paths via path_hash
 * - Creates storyline + storyline_beats junction rows
 * - Auto-saves to user's saved_storylines
 */
export async function autoPublishStoryline(
  storyId: string,
  endingNodeId: string,
  storyTitle: string,
  coverImageUrl?: string | null
): Promise<{ alreadyPublished: boolean; storylineId: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  // Fetch all beats for the story to walk the path
  const { data: allBeats, error: beatsError } = await supabase
    .from('beats')
    .select('*')
    .eq('story_id', storyId);

  if (beatsError || !allBeats) throw new Error('Failed to fetch beats');

  // Walk from ending to root
  const nodePath = walkPathToRoot(allBeats as DbBeat[], endingNodeId);
  if (nodePath.length === 0) throw new Error('Invalid path');

  // Compute path hash for duplicate detection
  const pathHash = await computePathHash(nodePath);

  // Check if this exact path is already published
  const { data: existing } = await supabase
    .from('storylines')
    .select('id')
    .eq('story_id', storyId)
    .eq('path_hash', pathHash)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Already published — just auto-save to user's profile
    await supabase
      .from('saved_storylines')
      .upsert(
        { user_id: user.id, storyline_id: existing.id },
        { onConflict: 'user_id,storyline_id' }
      );

    return { alreadyPublished: true, storylineId: existing.id };
  }

  // Get author name from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .single();

  // Build beats map for junction
  const beatsMap = new Map<string, DbBeat>();
  for (const beat of allBeats as DbBeat[]) {
    beatsMap.set(beat.node_id, beat);
  }

  // Build choices array from path
  const choices: StorylineChoice[] = [];
  for (let i = 1; i < nodePath.length; i++) {
    const currentBeat = beatsMap.get(nodePath[i]);
    const parentBeat = beatsMap.get(nodePath[i - 1]);
    if (currentBeat?.selected_option_id && parentBeat?.options) {
      const options = parentBeat.options as unknown as { id: string; label: string }[];
      const option = options.find(o => o.id === currentBeat.selected_option_id);
      if (option) {
        choices.push({ fromBeat: parentBeat.beat_number, optionLabel: option.label });
      }
    }
  }

  // Create the storyline (legacy beats JSONB included for backward compat during transition)
  const pathBeats = nodePath.map(nid => beatsMap.get(nid)).filter(Boolean) as DbBeat[];
  const legacyBeats = pathBeats.map(b => ({
    title: b.title,
    beatNumber: b.beat_number,
    isEnding: b.is_ending,
    storyText: b.story_text,
    sceneSummary: b.scene_summary,
    options: b.options,
    characters: b.characters,
    continuityNotes: b.continuity_notes,
    imagePrompt: b.image_prompt,
    clues: b.clues,
    nextBeatGoal: b.next_beat_goal,
    endingForecast: b.ending_forecast,
    imageUrl: b.image_url,
    audioUrl: b.audio_url,
  }));

  const { data: storyline, error: slError } = await supabase
    .from('storylines')
    .insert({
      story_id: storyId,
      user_id: user.id,
      title: storyTitle,
      beat_count: nodePath.length,
      cover_image_url: coverImageUrl || null,
      node_path: nodePath,
      beats: legacyBeats as unknown as Record<string, unknown>[],
      choices: choices as unknown as Record<string, unknown>[],
      author_name: profile?.display_name || 'Anonymous',
      is_public: true,
      path_hash: pathHash,
    })
    .select('id')
    .single();

  if (slError) throw new Error(`Failed to publish storyline: ${slError.message}`);

  // Create storyline_beats junction rows
  const junctionRows = nodePath.map((nodeId, index) => {
    const beat = beatsMap.get(nodeId);
    const choiceForThisBeat = index > 0 ? choices[index - 1] : undefined;
    return {
      storyline_id: storyline.id,
      beat_id: beat!.id,
      position: index,
      choice_label: choiceForThisBeat?.optionLabel || null,
    };
  });

  const { error: junctionError } = await supabase
    .from('storyline_beats')
    .insert(junctionRows);

  if (junctionError) {
    console.error('Failed to create storyline_beats (non-fatal):', junctionError.message);
  }

  // Auto-save to user's profile
  await supabase
    .from('saved_storylines')
    .upsert(
      { user_id: user.id, storyline_id: storyline.id },
      { onConflict: 'user_id,storyline_id' }
    );

  return { alreadyPublished: false, storylineId: storyline.id };
}

// ============================================================
// List / Delete / Archive
// ============================================================

/**
 * List the current user's created stories.
 */
export async function listUserStories(): Promise<Array<{
  id: string;
  title: string;
  status: string;
  is_archived: boolean;
  updated_at: string;
  user_prompt: string;
}>> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('stories')
    .select('id, title, status, is_archived, updated_at, user_prompt')
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
 * Archive a story (soft delete — hidden from creator but stays public).
 */
export async function archiveStory(storyId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('stories')
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq('id', storyId)
    .eq('user_id', user.id);

  if (error) throw new Error(`Failed to archive story: ${error.message}`);
}

/**
 * Unarchive a story (restore from soft delete).
 */
export async function unarchiveStory(storyId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('stories')
    .update({ is_archived: false, updated_at: new Date().toISOString() })
    .eq('id', storyId)
    .eq('user_id', user.id);

  if (error) throw new Error(`Failed to unarchive story: ${error.message}`);
}

// ============================================================
// Storyline Profile Management
// ============================================================

/**
 * Save a storyline to the user's profile (bookmark — reference only).
 */
export async function saveStorylineToProfile(storylineId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('saved_storylines')
    .upsert(
      { user_id: user.id, storyline_id: storylineId },
      { onConflict: 'user_id,storyline_id' }
    );

  if (error) throw new Error(`Failed to save storyline: ${error.message}`);
}

/**
 * Remove a storyline from the user's profile.
 */
export async function unsaveStoryline(storylineId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('saved_storylines')
    .delete()
    .eq('user_id', user.id)
    .eq('storyline_id', storylineId);

  if (error) throw new Error(`Failed to unsave storyline: ${error.message}`);
}

/**
 * List storylines saved to the user's profile.
 */
export async function listSavedStorylines(): Promise<Array<{
  id: string;
  storyline_id: string;
  saved_at: string;
  storyline: {
    id: string;
    title: string;
    beat_count: number;
    cover_image_url: string | null;
    author_name: string | null;
    story_id: string;
  };
}>> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('saved_storylines')
    .select(`
      id,
      storyline_id,
      saved_at,
      storylines (
        id,
        title,
        beat_count,
        cover_image_url,
        author_name,
        story_id
      )
    `)
    .eq('user_id', user.id)
    .order('saved_at', { ascending: false });

  if (error) throw new Error(`Failed to list saved storylines: ${error.message}`);

  return (data || []).map((row: any) => ({
    id: row.id,
    storyline_id: row.storyline_id,
    saved_at: row.saved_at,
    storyline: row.storylines,
  }));
}

// ============================================================
// Legacy Publish (kept for backward compatibility during transition)
// ============================================================

/**
 * Publish a storyline to the database (legacy — used by PublishDialog).
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

  // Compute path hash
  const pathHash = await computePathHash(params.nodePath);

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
      path_hash: pathHash,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to publish storyline: ${error.message}`);
  return { storylineId: data.id };
}
