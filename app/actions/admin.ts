'use server';

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { getAllModelConfigs, getFeatureFlag, setFeatureFlag, getFeatureFlagValue, setFeatureFlagValue, type ModelConfig } from '@/lib/ai/model-config';
import { getPublishedPrompt } from '@/lib/ai/prompt-config';
import type { StoryModelOverrides } from '@/app/actions/story-runtime';
import { savePricingActionCost } from '@/app/actions/pricing-admin';
import { getNarrationVoiceSampleStatusesForAdmin } from '@/app/actions/narration';
import {
  getNarrationVoiceSettings,
  saveNarrationVoiceSettings,
  type NarrationVoiceSettingsInput,
} from '@/lib/ai/narration-voice-settings';
import type {
  NarrationVoiceSampleClientStatus,
  NarrationVoiceSettings,
  NarrationVoiceSettingsSaveResult,
} from '@/lib/ai/narration-voices';
import { COINS_PER_BEAT } from '@/lib/types/pricing';
import {
  DEFAULT_STORYBOARD_IMAGE_QUALITY_SETTINGS,
  MAX_STORY_UI_TEXT_LINE_COUNT,
  MIN_STORY_UI_TEXT_LINE_COUNT,
  normalizeStoryboardImageSize,
  normalizeStoryboardLayoutMode,
  normalizeStoryboardVignetteAmountPercent,
  normalizeStoryboardWebpQualityPercent,
  normalizeStoryUiTextLineCount,
  type StoryboardImageQualitySettings,
  type StoryboardImageSize,
} from '@/lib/types/storyboard-settings';

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
  const [storyPrompt, seedPlanPrompt, seededBeatPrompt, visualPrompt, imagePrompt, portraitPrompt, storyboardImageSettings] = await Promise.all([
    getPublishedPrompt('story_generation'),
    getPublishedPrompt('seed_plan_generation'),
    getPublishedPrompt('seeded_beat_materialization'),
    getPublishedPrompt('visual_prompt'),
    getPublishedPrompt('image_generation'),
    getPublishedPrompt('portrait_generation'),
    getStoryboardImageQualitySettings(),
  ]);
  return {
    storyModel: map.get('story_generation')?.modelId,
    storyTemperature: map.get('story_generation')?.temperature ?? undefined,
    seedPlanModel: map.get('seed_plan_generation')?.modelId,
    seedPlanTemperature: map.get('seed_plan_generation')?.temperature ?? undefined,
    seededBeatModel: map.get('seeded_beat_materialization')?.modelId,
    seededBeatTemperature: map.get('seeded_beat_materialization')?.temperature ?? undefined,
    composerModel: map.get('visual_prompt')?.modelId,
    composerTemperature: map.get('visual_prompt')?.temperature ?? undefined,
    imageModel: map.get('image_generation')?.modelId,
    portraitModel: map.get('portrait_generation')?.modelId,
    storyPrompt,
    seedPlanPrompt,
    seededBeatPrompt,
    visualPrompt,
    imagePrompt,
    portraitPrompt,
    storyboardImageSettings,
    enableStoryboard: true,
  };
}

export async function getStoryboardImageQualitySettings(): Promise<StoryboardImageQualitySettings> {
  const [
    imageSizeValue,
    webpCompressionEnabled,
    webpQualityValue,
    clientProcessingEnabled,
    layoutModeValue,
  ] = await Promise.all([
    getFeatureFlagValue('storyboard_image_size'),
    getFeatureFlag('storyboard_webp_compression_enabled', DEFAULT_STORYBOARD_IMAGE_QUALITY_SETTINGS.webpCompressionEnabled),
    getFeatureFlagValue('storyboard_webp_quality_percent'),
    getFeatureFlag('storyboard_client_processing_enabled', DEFAULT_STORYBOARD_IMAGE_QUALITY_SETTINGS.clientProcessingEnabled),
    getFeatureFlagValue('storyboard_layout_mode'),
  ]);

  return {
    imageSize: normalizeStoryboardImageSize(imageSizeValue),
    webpCompressionEnabled,
    webpQualityPercent: normalizeStoryboardWebpQualityPercent(webpQualityValue),
    clientProcessingEnabled,
    layoutMode: normalizeStoryboardLayoutMode(layoutModeValue),
  };
}

export async function getGlobalSettings(): Promise<{
  cycleOverride: boolean;
  cycleMs: number;
  vignetteEnabled: boolean;
  vignetteAmountPercent: number;
  storyboardImageSize: StoryboardImageSize;
  storyboardWebpCompressionEnabled: boolean;
  storyboardWebpQualityPercent: number;
  storyboardClientProcessingEnabled: boolean;
  storyboardLayoutMode: '2x2';
  loadingNodeLabelsEnabled: boolean;
  loadingHintTypewriterEnabled: boolean;
  loadingReaderAnticipationMs: number;
  loadingReaderStoryTextEnabled: boolean;
  loadingReaderOptionsEnabled: boolean;
  loadingReaderScrollSpeedPxPerSecond: number;
  storyUiTextLineCount: number;
  storyUiAutoScrollEnabled: boolean;
  freePlusCharacterSheetsEnabled: boolean;
  creatorCharacterSheetsEnabled: boolean;
  videoDownloadEnabled: boolean;
  videoDownloadAdminBypass: boolean;
  storyAssetSignedUrlSwapEnabled: boolean;
  textTimeoutMs: number;
  imageTimeoutMs: number;
  ttsTimeoutMs: number;
  cloudSaveTimeoutMs: number;
  authoringWordCap: number;
  previewSeedPlanPriceCoins: number;
  narrationVoiceSettings: NarrationVoiceSettings;
  narrationVoiceSampleStatuses: NarrationVoiceSampleClientStatus[];
}> {
  await verifyAdmin();
  const [cycleOverride, cycleMsStr, vignetteEnabled, vignetteAmountValue, storyboardImageSettings, loadingNodeLabelsEnabled, loadingHintTypewriterEnabled, loadingReaderAnticipationMsStr, loadingReaderStoryTextEnabled, loadingReaderOptionsEnabled, loadingReaderScrollSpeedStr, storyUiTextLineCountValue, storyUiAutoScrollEnabled, freePlusCharacterSheetsEnabled, creatorCharacterSheetsEnabled, videoDownloadEnabled, videoDownloadAdminBypass, storyAssetSignedUrlSwapEnabled, textMs, imageMs, ttsMs, saveMs, authoringWordCapStr, previewSeedPlanPriceCoins, narrationVoiceSettings, narrationVoiceSampleStatuses] = await Promise.all([
    getFeatureFlag('storyboard_cycle_override'),
    getFeatureFlagValue('storyboard_cycle_ms'),
    getFeatureFlag('storyboard_vignette_enabled', true),
    getFeatureFlagValue('storyboard_vignette_amount_percent'),
    getStoryboardImageQualitySettings(),
    getFeatureFlag('story_loading_node_labels_enabled', true),
    getFeatureFlag('story_loading_hint_typewriter_enabled', false),
    getFeatureFlagValue('story_loading_reader_anticipation_ms'),
    getFeatureFlag('story_loading_reader_story_text_enabled', true),
    getFeatureFlag('story_loading_reader_options_enabled', true),
    getFeatureFlagValue('story_loading_reader_scroll_speed_px_per_second'),
    getFeatureFlagValue('story_ui_text_line_count'),
    getFeatureFlag('story_ui_auto_scroll_enabled', true),
    getFeatureFlag('character_sheet_enabled_free_plus'),
    getFeatureFlag('character_sheet_enabled_creator'),
    getFeatureFlag('video_download_enabled'),
    getFeatureFlag('video_download_admin_bypass'),
    getFeatureFlag('story_asset_signed_url_swap_enabled', false),
    getFeatureFlagValue('gemini_text_timeout_ms'),
    getFeatureFlagValue('gemini_image_timeout_ms'),
    getFeatureFlagValue('gemini_tts_timeout_ms'),
    getFeatureFlagValue('cloud_save_timeout_ms'),
    getFeatureFlagValue('story_authoring_word_cap'),
    getPreviewSeedPlanPriceCoins(),
    getNarrationVoiceSettings(),
    getNarrationVoiceSampleStatusesForAdmin(),
  ]);
  const parsedLoadingReaderAnticipationMs = parseInt(loadingReaderAnticipationMsStr ?? '10000', 10);
  const parsedLoadingReaderScrollSpeed = parseInt(loadingReaderScrollSpeedStr ?? '24', 10);

  return {
    cycleOverride,
    cycleMs: parseInt(cycleMsStr ?? '2500', 10) || 2500,
    vignetteEnabled,
    vignetteAmountPercent: normalizeStoryboardVignetteAmountPercent(vignetteAmountValue),
    storyboardImageSize: storyboardImageSettings.imageSize,
    storyboardWebpCompressionEnabled: storyboardImageSettings.webpCompressionEnabled,
    storyboardWebpQualityPercent: storyboardImageSettings.webpQualityPercent,
    storyboardClientProcessingEnabled: storyboardImageSettings.clientProcessingEnabled,
    storyboardLayoutMode: storyboardImageSettings.layoutMode,
    loadingNodeLabelsEnabled,
    loadingHintTypewriterEnabled,
    loadingReaderAnticipationMs: Number.isFinite(parsedLoadingReaderAnticipationMs)
      ? Math.max(0, parsedLoadingReaderAnticipationMs)
      : 10000,
    loadingReaderStoryTextEnabled,
    loadingReaderOptionsEnabled,
    loadingReaderScrollSpeedPxPerSecond: Number.isFinite(parsedLoadingReaderScrollSpeed)
      ? Math.max(1, parsedLoadingReaderScrollSpeed)
      : 24,
    storyUiTextLineCount: normalizeStoryUiTextLineCount(storyUiTextLineCountValue),
    storyUiAutoScrollEnabled,
    freePlusCharacterSheetsEnabled,
    creatorCharacterSheetsEnabled,
    videoDownloadEnabled,
    videoDownloadAdminBypass,
    storyAssetSignedUrlSwapEnabled,
    textTimeoutMs: parseInt(textMs ?? '30000', 10) || 30000,
    imageTimeoutMs: parseInt(imageMs ?? '90000', 10) || 90000,
    ttsTimeoutMs: parseInt(ttsMs ?? '120000', 10) || 120000,
    cloudSaveTimeoutMs: parseInt(saveMs ?? '20000', 10) || 20000,
    authoringWordCap: parseInt(authoringWordCapStr ?? '500', 10) || 500,
    previewSeedPlanPriceCoins,
    narrationVoiceSettings,
    narrationVoiceSampleStatuses,
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

export async function setStoryboardVignetteAmountPercent(percent: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error('Vignette amount must be between 0 and 100.');
  }
  await setFeatureFlagValue('storyboard_vignette_amount_percent', String(normalizeStoryboardVignetteAmountPercent(percent)));
}

export async function setStoryboardImageSize(size: StoryboardImageSize): Promise<void> {
  await verifyAdmin();
  await setFeatureFlagValue('storyboard_image_size', normalizeStoryboardImageSize(size));
}

export async function setStoryboardWebpCompression(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('storyboard_webp_compression_enabled', enabled);
}

export async function setStoryboardWebpQualityPercent(percent: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
    throw new Error('WebP quality must be between 1 and 100.');
  }
  await setFeatureFlagValue('storyboard_webp_quality_percent', String(normalizeStoryboardWebpQualityPercent(percent)));
}

export async function setStoryboardClientProcessing(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('storyboard_client_processing_enabled', enabled);
}

export async function setStoryLoadingNodeLabels(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_loading_node_labels_enabled', enabled);
}

export async function setStoryLoadingHintTypewriter(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_loading_hint_typewriter_enabled', enabled);
}

export async function setStoryLoadingReaderAnticipationMs(ms: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error('Loader anticipation time must be 0 seconds or more.');
  }
  await setFeatureFlagValue('story_loading_reader_anticipation_ms', String(Math.round(ms)));
}

export async function setStoryLoadingReaderStoryText(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_loading_reader_story_text_enabled', enabled);
}

export async function setStoryLoadingReaderOptions(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_loading_reader_options_enabled', enabled);
}

export async function setStoryLoadingReaderScrollSpeed(pxPerSecond: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(pxPerSecond) || pxPerSecond < 1) {
    throw new Error('Loader story scrolling speed must be at least 1 pixel per second.');
  }
  await setFeatureFlagValue('story_loading_reader_scroll_speed_px_per_second', String(Math.round(pxPerSecond)));
}

export async function setStoryUiTextLineCount(lines: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(lines) || lines < MIN_STORY_UI_TEXT_LINE_COUNT || lines > MAX_STORY_UI_TEXT_LINE_COUNT) {
    throw new Error(`Story text lines must be between ${MIN_STORY_UI_TEXT_LINE_COUNT} and ${MAX_STORY_UI_TEXT_LINE_COUNT}.`);
  }
  await setFeatureFlagValue('story_ui_text_line_count', String(normalizeStoryUiTextLineCount(lines)));
}

export async function setStoryUiAutoScroll(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_ui_auto_scroll_enabled', enabled);
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

export async function setStoryAssetSignedUrlSwap(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_asset_signed_url_swap_enabled', enabled);
}

export async function getStoryAssetSignedUrlSwapEnabled(): Promise<boolean> {
  return getFeatureFlag('story_asset_signed_url_swap_enabled', false);
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

export async function setAuthoringWordCap(words: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(words) || words < 50) {
    throw new Error('Authoring word cap must be at least 50 words.');
  }
  await setFeatureFlagValue('story_authoring_word_cap', String(Math.round(words)));
}

export async function setPreviewSeedPlanPriceCoins(coins: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(coins) || coins < 0) {
    throw new Error('Preview price must be 0 or more.');
  }
  if (coins % COINS_PER_BEAT !== 0) {
    throw new Error(`Preview price must be set in multiples of ${COINS_PER_BEAT} coins.`);
  }

  await savePricingActionCost({
    actionKey: 'preview_seed_plan',
    beatCost: Math.round(coins / COINS_PER_BEAT),
    isActive: true,
  });
}

export async function saveAdminNarrationVoiceSettings(
  input: NarrationVoiceSettingsInput
): Promise<NarrationVoiceSettingsSaveResult> {
  await verifyAdmin();
  return saveNarrationVoiceSettings(input);
}

// Public (no admin gate) — read by StoryScreen to pace storyboard panels
export async function getStoryboardSettings(): Promise<{
  cycleOverride: boolean;
  cycleMs: number;
  vignetteEnabled: boolean;
  vignetteAmountPercent: number;
  storyboardImageSize: StoryboardImageSize;
  storyboardWebpCompressionEnabled: boolean;
  storyboardWebpQualityPercent: number;
  storyboardClientProcessingEnabled: boolean;
  storyboardLayoutMode: '2x2';
  loadingNodeLabelsEnabled: boolean;
  loadingHintTypewriterEnabled: boolean;
  loadingReaderAnticipationMs: number;
  loadingReaderStoryTextEnabled: boolean;
  loadingReaderOptionsEnabled: boolean;
  loadingReaderScrollSpeedPxPerSecond: number;
  storyUiTextLineCount: number;
  storyUiAutoScrollEnabled: boolean;
  cloudSaveTimeoutMs: number;
  freePlusCharacterSheetsEnabled: boolean;
  creatorCharacterSheetsEnabled: boolean;
  videoDownloadEnabled: boolean;
  videoDownloadAdminBypass: boolean;
  storyAssetSignedUrlSwapEnabled: boolean;
  authoringWordCap: number;
}> {
  const [cycleOverride, cycleMsStr, vignetteEnabled, vignetteAmountValue, storyboardImageSettings, loadingNodeLabelsEnabled, loadingHintTypewriterEnabled, loadingReaderAnticipationMsStr, loadingReaderStoryTextEnabled, loadingReaderOptionsEnabled, loadingReaderScrollSpeedStr, storyUiTextLineCountValue, storyUiAutoScrollEnabled, saveMs, freePlusCharacterSheetsEnabled, creatorCharacterSheetsEnabled, videoDownloadEnabled, videoDownloadAdminBypass, storyAssetSignedUrlSwapEnabled, authoringWordCapStr] = await Promise.all([
    getFeatureFlag('storyboard_cycle_override'),
    getFeatureFlagValue('storyboard_cycle_ms'),
    getFeatureFlag('storyboard_vignette_enabled', true),
    getFeatureFlagValue('storyboard_vignette_amount_percent'),
    getStoryboardImageQualitySettings(),
    getFeatureFlag('story_loading_node_labels_enabled', true),
    getFeatureFlag('story_loading_hint_typewriter_enabled', false),
    getFeatureFlagValue('story_loading_reader_anticipation_ms'),
    getFeatureFlag('story_loading_reader_story_text_enabled', true),
    getFeatureFlag('story_loading_reader_options_enabled', true),
    getFeatureFlagValue('story_loading_reader_scroll_speed_px_per_second'),
    getFeatureFlagValue('story_ui_text_line_count'),
    getFeatureFlag('story_ui_auto_scroll_enabled', true),
    getFeatureFlagValue('cloud_save_timeout_ms'),
    getFeatureFlag('character_sheet_enabled_free_plus'),
    getFeatureFlag('character_sheet_enabled_creator'),
    getFeatureFlag('video_download_enabled'),
    getFeatureFlag('video_download_admin_bypass'),
    getFeatureFlag('story_asset_signed_url_swap_enabled', false),
    getFeatureFlagValue('story_authoring_word_cap'),
  ]);
  const parsedLoadingReaderAnticipationMs = parseInt(loadingReaderAnticipationMsStr ?? '10000', 10);
  const parsedLoadingReaderScrollSpeed = parseInt(loadingReaderScrollSpeedStr ?? '24', 10);

  return {
    cycleOverride,
    cycleMs: parseInt(cycleMsStr ?? '2500', 10) || 2500,
    vignetteEnabled,
    vignetteAmountPercent: normalizeStoryboardVignetteAmountPercent(vignetteAmountValue),
    storyboardImageSize: storyboardImageSettings.imageSize,
    storyboardWebpCompressionEnabled: storyboardImageSettings.webpCompressionEnabled,
    storyboardWebpQualityPercent: storyboardImageSettings.webpQualityPercent,
    storyboardClientProcessingEnabled: storyboardImageSettings.clientProcessingEnabled,
    storyboardLayoutMode: storyboardImageSettings.layoutMode,
    loadingNodeLabelsEnabled,
    loadingHintTypewriterEnabled,
    loadingReaderAnticipationMs: Number.isFinite(parsedLoadingReaderAnticipationMs)
      ? Math.max(0, parsedLoadingReaderAnticipationMs)
      : 10000,
    loadingReaderStoryTextEnabled,
    loadingReaderOptionsEnabled,
    loadingReaderScrollSpeedPxPerSecond: Number.isFinite(parsedLoadingReaderScrollSpeed)
      ? Math.max(1, parsedLoadingReaderScrollSpeed)
      : 24,
    storyUiTextLineCount: normalizeStoryUiTextLineCount(storyUiTextLineCountValue),
    storyUiAutoScrollEnabled,
    cloudSaveTimeoutMs: parseInt(saveMs ?? '20000', 10) || 20000,
    freePlusCharacterSheetsEnabled,
    creatorCharacterSheetsEnabled,
    videoDownloadEnabled,
    videoDownloadAdminBypass,
    storyAssetSignedUrlSwapEnabled,
    authoringWordCap: parseInt(authoringWordCapStr ?? '500', 10) || 500,
  };
}

async function getPreviewSeedPlanPriceCoins(): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('pricing_action_costs')
    .select('beat_cost')
    .eq('action_key', 'preview_seed_plan')
    .order('effective_from', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Failed to load preview seed-plan price:', error.message);
    return 0;
  }

  const beatCost = (data?.[0] as { beat_cost?: number } | undefined)?.beat_cost ?? 0;
  return beatCost * COINS_PER_BEAT;
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
