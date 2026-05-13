'use server';

import { createClient } from '@/lib/supabase/server';
import { signStoryMapAssetUrls, signStorylineBeatsUrls } from '@/lib/media/storage-url-signing';
import type { StorySession, StoryMap, StoryBeat, StoryNode } from '@/lib/types/story';
import type { DbBeat, DbStory } from '@/lib/types/database';
import { deriveVisualStyleSummary, normalizeStoryConfig } from '@/lib/ai/story-config';
import { normalizeBeatMediaFields } from '@/lib/types/beat-media';
import { repairMissingReadyBeatImageUrls } from '@/app/actions/persistence';

/**
 * Convert a DbBeat row back into a StoryNode for the client StoryMap.
 */
function beatRowToNode(beat: DbBeat, childNodeIds: string[]): StoryNode {
  const normalizedBeat = normalizeBeatMediaFields({
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
    imageStatus: beat.image_status,
    imageError: beat.image_error || undefined,
    imageGallery: Array.isArray(beat.image_gallery)
      ? beat.image_gallery.map((entry) => ({
          url: entry.url,
          storageKey: entry.storage_key,
          uploadedAt: entry.uploaded_at,
        }))
      : [],
    audioUrl: beat.audio_url || undefined,
    audioStatus: beat.audio_status,
    audioError: beat.audio_error || undefined,
    narrationVoiceId: beat.narration_voice_id || undefined,
    originKind: (beat.origin_kind as StoryBeat['originKind'] | null) || undefined,
    seedPlanBeatIndex: beat.seed_plan_beat_index || undefined,
    canonicalOptionId: beat.canonical_option_id || undefined,
  });
  return {
    id: beat.node_id,
    beatNumber: beat.beat_number,
    parentId: beat.parent_node_id,
    selectedOptionId: beat.selected_option_id,
    data: normalizedBeat,
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

function getStoryMapFromStorylineRow(row: any): StoryMap | null {
  const story = Array.isArray(row?.stories) ? row.stories[0] : row?.stories;
  const rawMap = story?.story_map;
  if (!rawMap || typeof rawMap !== 'object' || !('nodes' in rawMap)) {
    return null;
  }

  return rawMap as unknown as StoryMap;
}

function mergeStoryMapBeatFallback(beat: StoryBeat, fallback?: StoryBeat): StoryBeat {
  if (!fallback) return beat;

  return {
    ...beat,
    imageUrl: beat.imageUrl || fallback.imageUrl,
    persistedImageUrl: beat.persistedImageUrl || fallback.persistedImageUrl || fallback.imageUrl,
    imageStatus: beat.imageStatus || fallback.imageStatus,
    imageError: beat.imageError || fallback.imageError,
    audioUrl: beat.audioUrl || fallback.audioUrl,
    audioStatus: beat.audioStatus || fallback.audioStatus,
    audioError: beat.audioError || fallback.audioError,
    characters: fallback.characters
      ? mergeCharactersWithFallback(beat.characters, fallback.characters)
      : beat.characters,
    isStoryboard: beat.isStoryboard || fallback.isStoryboard || fallback.storyboardPlan ? true : undefined,
    newCharacterIds: beat.newCharacterIds || fallback.newCharacterIds,
    changedCharacterIds: beat.changedCharacterIds || fallback.changedCharacterIds,
    storyboardPlan: beat.storyboardPlan || fallback.storyboardPlan,
    storyboardPromptText: beat.storyboardPromptText || fallback.storyboardPromptText,
    reelCaptions: beat.reelCaptions || fallback.reelCaptions,
    reelTextOverlayEnabled: beat.reelTextOverlayEnabled ?? fallback.reelTextOverlayEnabled,
    reelTextOverlayStyle: beat.reelTextOverlayStyle || fallback.reelTextOverlayStyle,
    finalImagePromptText: beat.finalImagePromptText || fallback.finalImagePromptText,
    narrationVoiceId: beat.narrationVoiceId || fallback.narrationVoiceId,
    originKind: beat.originKind || fallback.originKind,
    seedPlanBeatIndex: beat.seedPlanBeatIndex ?? fallback.seedPlanBeatIndex,
    canonicalOptionId: beat.canonicalOptionId || fallback.canonicalOptionId,
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
  let rawStoryMap = dbStory.story_map && typeof dbStory.story_map === 'object' && 'nodes' in dbStory.story_map
    ? (dbStory.story_map as unknown as StoryMap)
    : null;

  // Fetch all beats for the story
  const { data: beats, error: beatsError } = await supabase
    .from('beats')
    .select('*')
    .eq('story_id', storyId)
    .order('beat_number', { ascending: true });

  if (beatsError) throw new Error('Failed to load story beats');
  let repairedBeats = (beats as DbBeat[] | null) || [];
  if (isOwner && repairedBeats.length > 0) {
    const repairResult = await repairMissingReadyBeatImageUrls(
      supabase,
      storyId,
      dbStory.user_id,
      repairedBeats,
      rawStoryMap
    );
    repairedBeats = repairResult.beats;
    rawStoryMap = repairResult.storyMap;
  }

  let storyMap: StoryMap;
  if (repairedBeats.length > 0) {
    // Always start from root node — exploration begins from beat 1
    storyMap = reconstructStoryMap(repairedBeats, null);
    if (rawStoryMap) {
      const jsonbMap = rawStoryMap;
      for (const nodeId of Object.keys(storyMap.nodes)) {
        const jsonbNode = jsonbMap.nodes?.[nodeId];
        if (!jsonbNode?.data) continue;
        storyMap.nodes[nodeId] = {
          ...storyMap.nodes[nodeId],
          data: {
            ...storyMap.nodes[nodeId].data,
            ...(!storyMap.nodes[nodeId].data.imageUrl && jsonbNode.data.imageUrl
              ? { imageUrl: jsonbNode.data.imageUrl }
              : {}),
            ...(!storyMap.nodes[nodeId].data.imageStatus && jsonbNode.data.imageStatus
              ? { imageStatus: jsonbNode.data.imageStatus }
              : {}),
            ...(!storyMap.nodes[nodeId].data.imageError && jsonbNode.data.imageError
              ? { imageError: jsonbNode.data.imageError }
              : {}),
            ...(!storyMap.nodes[nodeId].data.audioUrl && jsonbNode.data.audioUrl
              ? { audioUrl: jsonbNode.data.audioUrl }
              : {}),
            ...(!storyMap.nodes[nodeId].data.audioStatus && jsonbNode.data.audioStatus
              ? { audioStatus: jsonbNode.data.audioStatus }
              : {}),
            ...(!storyMap.nodes[nodeId].data.audioError && jsonbNode.data.audioError
              ? { audioError: jsonbNode.data.audioError }
              : {}),
            ...(jsonbNode.data.characters
              ? {
                  characters: mergeCharactersWithFallback(
                    storyMap.nodes[nodeId].data.characters,
                    jsonbNode.data.characters
                  ),
                }
              : {}),
            ...(jsonbNode.data.isStoryboard ? { isStoryboard: true } : {}),
            ...(jsonbNode.data.newCharacterIds ? { newCharacterIds: jsonbNode.data.newCharacterIds } : {}),
            ...(jsonbNode.data.changedCharacterIds ? { changedCharacterIds: jsonbNode.data.changedCharacterIds } : {}),
            ...(jsonbNode.data.storyboardPlan ? { storyboardPlan: jsonbNode.data.storyboardPlan } : {}),
            ...(jsonbNode.data.storyboardPromptText ? { storyboardPromptText: jsonbNode.data.storyboardPromptText } : {}),
            ...(jsonbNode.data.finalImagePromptText ? { finalImagePromptText: jsonbNode.data.finalImagePromptText } : {}),
            ...(jsonbNode.data.originKind ? { originKind: jsonbNode.data.originKind } : {}),
            ...(jsonbNode.data.seedPlanBeatIndex ? { seedPlanBeatIndex: jsonbNode.data.seedPlanBeatIndex } : {}),
            ...(jsonbNode.data.canonicalOptionId ? { canonicalOptionId: jsonbNode.data.canonicalOptionId } : {}),
          },
        };
        storyMap.nodes[nodeId].data = normalizeBeatMediaFields(storyMap.nodes[nodeId].data);
      }
    }
  } else {
    // Fallback to legacy story_map JSONB
    const rawFallbackMap = rawStoryMap;
    if (!rawFallbackMap || typeof rawFallbackMap !== 'object' || !('nodes' in rawFallbackMap)) {
      throw new Error('Story map is missing or corrupted');
    }
    storyMap = rawFallbackMap as unknown as StoryMap;
    // Reset to root for legacy maps too
    if (storyMap.rootNodeId) {
      storyMap = { ...storyMap, currentNodeId: storyMap.rootNodeId };
    }
  }

  // Replace private storage URLs with signed URLs so images/audio load in the browser
  storyMap = await signStoryMapAssetUrls(supabase, storyMap);
  for (const nodeId of Object.keys(storyMap.nodes)) {
    storyMap.nodes[nodeId] = {
      ...storyMap.nodes[nodeId],
      data: normalizeBeatMediaFields(storyMap.nodes[nodeId].data),
    };
  }
  const storyConfig = normalizeStoryConfig({
    ...(dbStory.story_config as any),
    storyKind: dbStory.story_kind,
    isVerticalStory: dbStory.is_vertical_story,
    aspectRatio: dbStory.aspect_ratio,
  });

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
    visualStyle: dbStory.visual_style || deriveVisualStyleSummary(storyConfig.visualSettings),
    currentBeat: 0,
    maxBeats: storyConfig.maxBeats,
    status: dbStory.status as 'active' | 'completed' | 'error',
    characters: (dbStory.characters || []) as any,
    setting: (dbStory.setting || { world: 'unknown', timeOfDay: 'unknown', mood: 'unknown' }) as any,
    storyConfig,
    storyMap,
    beats: [],
    choiceHistory: [],
    openThreads: [],
    allowedEndings: [],
    safetyProfile: 'all_ages',
    narratorVoice: dbStory.narrator_voice || undefined,
    narrationVoiceMode: dbStory.narration_voice_mode === 'user_selected' ? 'user_selected' : 'legacy_auto',
    narrationVoiceGenderBucket: dbStory.narration_voice_gender_bucket === 'male' ? 'male' : dbStory.narration_voice_gender_bucket === 'female' ? 'female' : undefined,
    narrationLanguageCode: dbStory.narration_language_code === 'en-IN' || dbStory.narration_language_code === 'hi-IN' ? dbStory.narration_language_code : undefined,
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
    is_vertical_story: boolean;
    aspect_ratio: string;
    author_name: string | null;
    is_public: boolean;
    created_at: string;
  };
  beats: StoryBeat[];
  choices: { fromBeat: number; optionLabel: string }[];
}> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  // Fetch storyline metadata
  const { data: storyline, error: slError } = await supabase
    .from('storylines')
    .select('id, story_id, title, beat_count, cover_image_url, is_vertical_story, aspect_ratio, author_name, is_public, created_at, node_path, beats, choices, stories(story_map, story_config, story_kind, is_vertical_story, aspect_ratio)')
    .eq('id', storylineId)
    .single();

  if (slError || !storyline) throw new Error('Storyline not found');
  const fallbackStoryMap = getStoryMapFromStorylineRow(storyline);
  const sourceStory = (storyline as any).stories as {
    story_config?: Record<string, unknown> | null;
    story_kind?: string | null;
    is_vertical_story?: boolean | null;
    aspect_ratio?: string | null;
  } | null;
  const sourceStoryConfig = normalizeStoryConfig({
    ...(sourceStory?.story_config ?? {}),
    story_kind: sourceStory?.story_kind,
    is_vertical_story: sourceStory?.is_vertical_story,
    aspect_ratio: sourceStory?.aspect_ratio,
  });
  const storylineAspectRatio = storyline.is_vertical_story === true
    || storyline.aspect_ratio === '9:16'
    || sourceStoryConfig.isVerticalStory
    ? '9:16'
    : '16:9';
  const storylineIsVertical = storylineAspectRatio === '9:16';

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
      const normalizedBeat = normalizeBeatMediaFields({
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
        imageStatus: b.image_status,
        imageError: b.image_error || undefined,
        audioUrl: b.audio_url || undefined,
        audioStatus: b.audio_status,
        audioError: b.audio_error || undefined,
        narrationVoiceId: b.narration_voice_id || undefined,
        isStoryboard: b.is_storyboard || undefined,
        reelCaptions: Array.isArray(b.reel_captions)
          ? b.reel_captions as StoryBeat['reelCaptions']
          : undefined,
        reelTextOverlayEnabled: sourceStoryConfig.reel.textOverlayEnabled,
        reelTextOverlayStyle: sourceStoryConfig.reel.textOverlayStyle,
        originKind: (b.origin_kind as StoryBeat['originKind'] | null) || undefined,
        seedPlanBeatIndex: b.seed_plan_beat_index || undefined,
        canonicalOptionId: b.canonical_option_id || undefined,
      });
      return mergeStoryMapBeatFallback(normalizedBeat, fallbackStoryMap?.nodes?.[b.node_id]?.data);
    });

    const choices = junctionBeats
      .filter((jb: any) => jb.choice_label)
      .map((jb: any, i: number) => ({
        fromBeat: i,
        optionLabel: jb.choice_label as string,
      }));

    // Sign private storage URLs for authenticated access
    const signedBeats = await signStorylineBeatsUrls(supabase, beats);

    return {
      storyline: {
        id: storyline.id,
        story_id: storyline.story_id,
        title: storyline.title,
        beat_count: storyline.beat_count,
        cover_image_url: storyline.cover_image_url,
        is_vertical_story: storylineIsVertical,
        aspect_ratio: storylineAspectRatio,
        author_name: storyline.author_name,
        is_public: storyline.is_public,
        created_at: storyline.created_at,
      },
      beats: signedBeats,
      choices,
    };
  }

  // Fallback to legacy JSONB beats
  const nodePath = Array.isArray(storyline.node_path) ? storyline.node_path : [];
  const legacyBeats = (storyline.beats as any[]).map((b, index) => {
    const nodeId = nodePath[index];
    return mergeStoryMapBeatFallback(
      {
        ...(b as unknown as StoryBeat),
        reelTextOverlayEnabled: sourceStoryConfig.reel.textOverlayEnabled,
        reelTextOverlayStyle: sourceStoryConfig.reel.textOverlayStyle,
      },
      nodeId ? fallbackStoryMap?.nodes?.[nodeId]?.data : undefined
    );
  });
  const signedLegacyBeats = await signStorylineBeatsUrls(supabase, legacyBeats);

  return {
    storyline: {
      id: storyline.id,
      story_id: storyline.story_id,
      title: storyline.title,
      beat_count: storyline.beat_count,
      cover_image_url: storyline.cover_image_url,
      is_vertical_story: storylineIsVertical,
      aspect_ratio: storylineAspectRatio,
      author_name: storyline.author_name,
      is_public: storyline.is_public,
      created_at: storyline.created_at,
    },
    beats: signedLegacyBeats,
    choices: (storyline.choices as any[]).map(c => c as { fromBeat: number; optionLabel: string }),
  };
}

function mergeCharactersWithFallback(
  primary: StoryBeat['characters'],
  fallback?: StoryBeat['characters']
): StoryBeat['characters'] {
  if (!fallback || fallback.length === 0) {
    return primary;
  }

  const merged = new Map<string, StoryBeat['characters'][number]>();

  for (const character of fallback) {
    merged.set(character.id, { ...character });
  }

  for (const character of primary) {
    const existing = merged.get(character.id);
    merged.set(character.id, {
      ...existing,
      ...character,
      portraitUrl: character.portraitUrl || existing?.portraitUrl,
      portraitBase64: character.portraitBase64 || existing?.portraitBase64,
    });
  }

  return Array.from(merged.values());
}

/**
 * Refresh signed URLs for a storyline's beats.
 * Called by the client when signed URLs are about to expire.
 */
export async function refreshStorylineSignedUrls(storylineId: string): Promise<StoryBeat[]> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: storyline, error: slError } = await supabase
    .from('storylines')
    .select('node_path, beats, stories(story_map)')
    .eq('id', storylineId)
    .single();

  if (slError || !storyline) throw new Error('Storyline not found');
  const fallbackStoryMap = getStoryMapFromStorylineRow(storyline);

  // Try normalized junction beats first
  const { data: junctionBeats } = await supabase
    .from('storyline_beats')
    .select('position, beats (*)')
    .eq('storyline_id', storylineId)
    .order('position', { ascending: true });

  let beats: StoryBeat[];
  if (junctionBeats && junctionBeats.length > 0) {
    beats = junctionBeats.map((jb: any) => {
      const b = jb.beats as DbBeat;
      const normalizedBeat = normalizeBeatMediaFields({
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
        imageStatus: b.image_status,
        imageError: b.image_error || undefined,
        audioUrl: b.audio_url || undefined,
        audioStatus: b.audio_status,
        audioError: b.audio_error || undefined,
        narrationVoiceId: b.narration_voice_id || undefined,
        isStoryboard: b.is_storyboard || undefined,
        reelCaptions: Array.isArray(b.reel_captions)
          ? b.reel_captions as StoryBeat['reelCaptions']
          : undefined,
        originKind: (b.origin_kind as StoryBeat['originKind'] | null) || undefined,
        seedPlanBeatIndex: b.seed_plan_beat_index || undefined,
        canonicalOptionId: b.canonical_option_id || undefined,
      });
      return mergeStoryMapBeatFallback(normalizedBeat, fallbackStoryMap?.nodes?.[b.node_id]?.data);
    });
  } else {
    const nodePath = Array.isArray(storyline.node_path) ? storyline.node_path : [];
    beats = (storyline.beats as any[]).map((b, index) => {
      const nodeId = nodePath[index];
      return mergeStoryMapBeatFallback(
        b as unknown as StoryBeat,
        nodeId ? fallbackStoryMap?.nodes?.[nodeId]?.data : undefined
      );
    });
  }

  return signStorylineBeatsUrls(supabase, beats);
}

/**
 * Refresh signed URLs for a story map's assets.
 * Called by the client when signed URLs are about to expire.
 */
export async function refreshStoryMapSignedUrls(storyId: string): Promise<StoryMap> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: beats, error: beatsError } = await supabase
    .from('beats')
    .select('*')
    .eq('story_id', storyId)
    .order('beat_number', { ascending: true });

  if (beatsError) throw new Error('Failed to load story beats');

  let storyMap: StoryMap;
  if (beats && beats.length > 0) {
    storyMap = reconstructStoryMap(beats as DbBeat[]);
  } else {
    const { data: story } = await supabase
      .from('stories')
      .select('story_map')
      .eq('id', storyId)
      .single();

    if (!story) throw new Error('Story not found');
    storyMap = story.story_map as unknown as StoryMap;
  }

  return signStoryMapAssetUrls(supabase, storyMap);
}
