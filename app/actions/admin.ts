'use server';

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { getAllModelConfigs, getFeatureFlag, setFeatureFlag, getFeatureFlagValue, setFeatureFlagValue, type ModelConfig } from '@/lib/ai/model-config';
import { getPublishedPrompt } from '@/lib/ai/prompt-config';
import type { StoryModelOverrides } from '@/app/actions/story-runtime';

// ============================================================
// Search
// ============================================================

export interface AdminStoryResult {
  id: string;
  title: string;
  user_id: string;
  author_name: string | null;
  genre: string | null;
  status: string;
  is_archived: boolean;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminStorylineResult {
  id: string;
  story_id: string;
  user_id: string;
  title: string;
  author_name: string | null;
  is_public: boolean;
  beat_count: number;
  like_count: number;
  view_count: number;
  cover_image_url: string | null;
  created_at: string;
}

export async function searchStories(
  query: string,
  searchBy: 'title' | 'id'
): Promise<AdminStoryResult[]> {
  await verifyAdmin();
  const supabase = createAdminClient();

  let q = supabase
    .from('stories')
    .select('id, title, user_id, genre, status, is_archived, cover_image_url, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (searchBy === 'id') {
    q = q.eq('id', query.trim());
  } else {
    q = q.ilike('title', `%${query.trim()}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(`Search failed: ${error.message}`);

  if (!data || data.length === 0) return [];

  // Fetch author names for the results
  const userIds = [...new Set(data.map(s => s.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', userIds);

  const profileMap = new Map(profiles?.map(p => [p.id, p.display_name]) || []);

  return data.map(s => ({
    ...s,
    author_name: profileMap.get(s.user_id) || null,
  }));
}

export async function searchStorylines(
  query: string,
  searchBy: 'title' | 'id' | 'story_id'
): Promise<AdminStorylineResult[]> {
  await verifyAdmin();
  const supabase = createAdminClient();

  let q = supabase
    .from('storylines')
    .select('id, story_id, user_id, title, author_name, is_public, beat_count, like_count, view_count, cover_image_url, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (searchBy === 'id') {
    q = q.eq('id', query.trim());
  } else if (searchBy === 'story_id') {
    q = q.eq('story_id', query.trim());
  } else {
    q = q.ilike('title', `%${query.trim()}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(`Search failed: ${error.message}`);

  return data || [];
}

// ============================================================
// Mutations
// ============================================================

export async function adminUnpublishStoryline(id: string): Promise<void> {
  await verifyAdmin();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('storylines')
    .update({ is_public: false })
    .eq('id', id);

  if (error) throw new Error(`Failed to unpublish: ${error.message}`);
}

export async function adminDeleteStoryline(id: string): Promise<void> {
  await verifyAdmin();
  const supabase = createAdminClient();

  // Delete cover from public-storylines bucket (best-effort)
  const { data: storyline } = await supabase
    .from('storylines')
    .select('user_id, cover_image_url')
    .eq('id', id)
    .single();

  const { error } = await supabase
    .from('storylines')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Failed to delete storyline: ${error.message}`);

  // Best-effort storage cleanup
  if (storyline?.cover_image_url) {
    try {
      const path = `${storyline.user_id}/${id}/cover.webp`;
      await supabase.storage.from('public-storylines').remove([path]);
    } catch { /* ignore */ }
  }
}

// ============================================================
// Model Config (for client-side story.ts to read active models)
// ============================================================

export async function getActiveModelConfigs(): Promise<ModelConfig[]> {
  return getAllModelConfigs();
}

export async function getStoryModelOverrides(): Promise<StoryModelOverrides> {
  const configs = await getAllModelConfigs();
  const map = new Map(configs.map(c => [c.taskKey, c]));
  const [storyPrompt, visualPrompt, imagePrompt, portraitPrompt] = await Promise.all([
    getPublishedPrompt('story_generation'),
    getPublishedPrompt('visual_prompt'),
    getPublishedPrompt('image_generation'),
    getPublishedPrompt('portrait_generation'),
  ]);
  return {
    storyModel: map.get('story_generation')?.modelId,
    storyTemperature: map.get('story_generation')?.temperature ?? undefined,
    composerModel: map.get('visual_prompt')?.modelId,
    composerTemperature: map.get('visual_prompt')?.temperature ?? undefined,
    imageModel: map.get('image_generation')?.modelId,
    portraitModel: map.get('portrait_generation')?.modelId,
    storyPrompt,
    visualPrompt,
    imagePrompt,
    portraitPrompt,
    enableStoryboard: true,
  };
}

export async function getGlobalSettings(): Promise<{
  cycleOverride: boolean;
  cycleMs: number;
  vignetteEnabled: boolean;
  loadingNodeLabelsEnabled: boolean;
  loadingHintTypewriterEnabled: boolean;
  freePlusCharacterSheetsEnabled: boolean;
  creatorCharacterSheetsEnabled: boolean;
  videoDownloadEnabled: boolean;
  videoDownloadAdminBypass: boolean;
  textTimeoutMs: number;
  imageTimeoutMs: number;
  ttsTimeoutMs: number;
  cloudSaveTimeoutMs: number;
}> {
  await verifyAdmin();
  const [cycleOverride, cycleMsStr, vignetteEnabled, loadingNodeLabelsEnabled, loadingHintTypewriterEnabled, freePlusCharacterSheetsEnabled, creatorCharacterSheetsEnabled, videoDownloadEnabled, videoDownloadAdminBypass, textMs, imageMs, ttsMs, saveMs] = await Promise.all([
    getFeatureFlag('storyboard_cycle_override'),
    getFeatureFlagValue('storyboard_cycle_ms'),
    getFeatureFlag('storyboard_vignette_enabled', true),
    getFeatureFlag('story_loading_node_labels_enabled', true),
    getFeatureFlag('story_loading_hint_typewriter_enabled', false),
    getFeatureFlag('character_sheet_enabled_free_plus'),
    getFeatureFlag('character_sheet_enabled_creator'),
    getFeatureFlag('video_download_enabled'),
    getFeatureFlag('video_download_admin_bypass'),
    getFeatureFlagValue('gemini_text_timeout_ms'),
    getFeatureFlagValue('gemini_image_timeout_ms'),
    getFeatureFlagValue('gemini_tts_timeout_ms'),
    getFeatureFlagValue('cloud_save_timeout_ms'),
  ]);
  return {
    cycleOverride,
    cycleMs: parseInt(cycleMsStr ?? '2500', 10) || 2500,
    vignetteEnabled,
    loadingNodeLabelsEnabled,
    loadingHintTypewriterEnabled,
    freePlusCharacterSheetsEnabled,
    creatorCharacterSheetsEnabled,
    videoDownloadEnabled,
    videoDownloadAdminBypass,
    textTimeoutMs: parseInt(textMs ?? '30000', 10) || 30000,
    imageTimeoutMs: parseInt(imageMs ?? '90000', 10) || 90000,
    ttsTimeoutMs: parseInt(ttsMs ?? '120000', 10) || 120000,
    cloudSaveTimeoutMs: parseInt(saveMs ?? '20000', 10) || 20000,
  };
}

export async function setCycleOverride(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('storyboard_cycle_override', enabled);
}

export async function setCycleMs(ms: number): Promise<void> {
  await verifyAdmin();
  await setFeatureFlagValue('storyboard_cycle_ms', String(ms));
}

export async function setStoryboardVignette(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('storyboard_vignette_enabled', enabled);
}

export async function setStoryLoadingNodeLabels(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_loading_node_labels_enabled', enabled);
}

export async function setStoryLoadingHintTypewriter(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_loading_hint_typewriter_enabled', enabled);
}

export async function setFreePlusCharacterSheets(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('character_sheet_enabled_free_plus', enabled);
}

export async function setCreatorCharacterSheets(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('character_sheet_enabled_creator', enabled);
}

export async function setVideoDownload(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('video_download_enabled', enabled);
}

export async function setVideoDownloadAdminBypass(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('video_download_admin_bypass', enabled);
}

// Public (no admin gate) — lightweight check used by client to gate admin-only features
export async function checkIsAdmin(): Promise<boolean> {
  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return false;
    const adminUserId = process.env.ADMIN_USER_ID;
    return !!adminUserId && user.id === adminUserId;
  } catch {
    return false;
  }
}

export async function setTextTimeout(ms: number): Promise<void> {
  await verifyAdmin();
  await setFeatureFlagValue('gemini_text_timeout_ms', String(ms));
}

export async function setImageTimeout(ms: number): Promise<void> {
  await verifyAdmin();
  await setFeatureFlagValue('gemini_image_timeout_ms', String(ms));
}

export async function setTtsTimeout(ms: number): Promise<void> {
  await verifyAdmin();
  await setFeatureFlagValue('gemini_tts_timeout_ms', String(ms));
}

export async function setCloudSaveTimeout(ms: number): Promise<void> {
  await verifyAdmin();
  await setFeatureFlagValue('cloud_save_timeout_ms', String(ms));
}

// Public (no admin gate) — read by StoryScreen to pace storyboard panels
export async function getStoryboardSettings(): Promise<{
  cycleOverride: boolean;
  cycleMs: number;
  vignetteEnabled: boolean;
  loadingNodeLabelsEnabled: boolean;
  loadingHintTypewriterEnabled: boolean;
  cloudSaveTimeoutMs: number;
  freePlusCharacterSheetsEnabled: boolean;
  creatorCharacterSheetsEnabled: boolean;
  videoDownloadEnabled: boolean;
  videoDownloadAdminBypass: boolean;
}> {
  const [cycleOverride, cycleMsStr, vignetteEnabled, loadingNodeLabelsEnabled, loadingHintTypewriterEnabled, saveMs, freePlusCharacterSheetsEnabled, creatorCharacterSheetsEnabled, videoDownloadEnabled, videoDownloadAdminBypass] = await Promise.all([
    getFeatureFlag('storyboard_cycle_override'),
    getFeatureFlagValue('storyboard_cycle_ms'),
    getFeatureFlag('storyboard_vignette_enabled', true),
    getFeatureFlag('story_loading_node_labels_enabled', true),
    getFeatureFlag('story_loading_hint_typewriter_enabled', false),
    getFeatureFlagValue('cloud_save_timeout_ms'),
    getFeatureFlag('character_sheet_enabled_free_plus'),
    getFeatureFlag('character_sheet_enabled_creator'),
    getFeatureFlag('video_download_enabled'),
    getFeatureFlag('video_download_admin_bypass'),
  ]);
  return {
    cycleOverride,
    cycleMs: parseInt(cycleMsStr ?? '2500', 10) || 2500,
    vignetteEnabled,
    loadingNodeLabelsEnabled,
    loadingHintTypewriterEnabled,
    cloudSaveTimeoutMs: parseInt(saveMs ?? '20000', 10) || 20000,
    freePlusCharacterSheetsEnabled,
    creatorCharacterSheetsEnabled,
    videoDownloadEnabled,
    videoDownloadAdminBypass,
  };
}

export async function adminDeleteStory(storyId: string): Promise<void> {
  await verifyAdmin();
  const supabase = createAdminClient();

  // Get story owner for storage cleanup
  const { data: story } = await supabase
    .from('stories')
    .select('user_id')
    .eq('id', storyId)
    .single();

  const { error } = await supabase
    .from('stories')
    .delete()
    .eq('id', storyId);

  if (error) throw new Error(`Failed to delete story: ${error.message}`);

  // Best-effort storage cleanup
  if (story?.user_id) {
    try {
      const { data: files } = await supabase.storage
        .from('story-assets')
        .list(`${story.user_id}/${storyId}`);
      if (files && files.length > 0) {
        const paths = files.map(f => `${story.user_id}/${storyId}/${f.name}`);
        await supabase.storage.from('story-assets').remove(paths);
      }
    } catch { /* ignore */ }
  }
}
