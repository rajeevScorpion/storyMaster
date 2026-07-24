'use server';

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { getAllModelConfigs, getFeatureFlag, setFeatureFlag, getFeatureFlagValue, setFeatureFlagValue, warmFeatureFlagCaches, type ModelConfig } from '@/lib/ai/model-config';
import { getPublishedPrompt } from '@/lib/ai/prompt-config';
import type { StoryModelOverrides } from '@/app/actions/story-runtime';
import {
  parseReelStorySettingsValue,
  serializeReelStorySettings,
  normalizeReelStorySettings,
  type ReelStorySetupSettings,
  type ReelStorySettings,
} from '@/lib/reel/settings';
import { savePricingActionCost } from '@/app/actions/pricing-admin';
import { getPublishedReelVisualStylesForRuntime } from '@/app/actions/reel-styles';
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
import {
  getEnabledStoryLanguageIds,
  saveEnabledStoryLanguageIds,
} from '@/lib/ai/story-language-settings';
import { NARRATION_VOICE_FLAG_KEYS, SUPPORTED_NARRATION_VOICE_LANGUAGES } from '@/lib/ai/narration-voices';
import { NARRATION_ACCENT_FLAG_KEYS } from '@/lib/ai/narration-accents';
import { STORY_LANGUAGE_ENABLED_FLAG_KEY } from '@/lib/ai/story-config';
import type { StoryLanguage } from '@/lib/types/story';
import { COINS_PER_BEAT } from '@/lib/types/pricing';
import {
  DEFAULT_STORYBOARD_IMAGE_QUALITY_SETTINGS,
  MAX_STORY_UI_TEXT_LINE_COUNT,
  MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
  MIN_STORY_UI_TEXT_LINE_COUNT,
  MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
  normalizeStoryboardImageSize,
  normalizeStoryboardLayoutMode,
  normalizeStoryboardVignetteAmountPercent,
  normalizeStoryboardWebpQualityPercent,
  normalizeStoryTextOverlayWordsPerLine,
  normalizeStoryUiTextLineCount,
  type StoryboardImageQualitySettings,
  type StoryboardImageSize,
} from '@/lib/types/storyboard-settings';
import {
  DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS,
  IMAGE_UPLOAD_OPTIMIZATION_FLAG_KEYS,
  normalizeImageUploadOptimizationSettings,
  type ImageUploadOptimizationSettings,
} from '@/lib/media/imageUploadOptimization';
import {
  MEDIA_STORAGE_FLAG_KEYS,
  normalizeMediaStorageSettings,
  type MediaStorageAdminState,
  type MediaStorageSettings,
} from '@/lib/media/storage-settings';
import { getMediaStorageAdminState as loadMediaStorageAdminState } from '@/lib/media/storage-config';
import {
  BEAT_CONTROL_FLAG_KEYS,
  BEAT_IMAGE_MAX_VERSIONS_FLAG_KEY,
  MAX_BEAT_IMAGE_VERSIONS_PER_BEAT,
  MIN_BEAT_IMAGE_VERSIONS_PER_BEAT,
  normalizeMaxImageVersionsPerBeat,
  type BeatControlFlagKey,
} from '@/lib/beat-control/settings';
import {
  CHARACTER_UNIVERSE_FLAG_KEYS,
  type CharacterUniverseFlagKey,
} from '@/lib/character-universe/settings';

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
  is_vertical_story: boolean;
  aspect_ratio: string;
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
  is_vertical_story: boolean;
  aspect_ratio: string;
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
    .select('id, title, user_id, genre, status, is_archived, is_vertical_story, aspect_ratio, cover_image_url, created_at, updated_at')
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
    .select('id, story_id, user_id, title, author_name, is_public, beat_count, is_vertical_story, aspect_ratio, like_count, view_count, cover_image_url, created_at')
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

  // The 073 sync trigger maps is_public=false onto visibility='private'.
  const { error } = await supabase
    .from('storylines')
    .update({ is_public: false, unpublished_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    // Pre-073 databases: unpublished_at doesn't exist yet.
    const { error: fallbackError } = await supabase
      .from('storylines')
      .update({ is_public: false })
      .eq('id', id);
    if (fallbackError) throw new Error(`Failed to unpublish: ${fallbackError.message}`);
  }
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
  const [storyPrompt, reelStoryPrompt, seedPlanPrompt, seededBeatPrompt, visualPrompt, reelVisualPrompt, imagePrompt, reelImagePrompt, portraitPrompt, storyboardImageSettings, reelSettingsValue, reelVisualStyles] = await Promise.all([
    getPublishedPrompt('story_generation'),
    getPublishedPrompt('reel_story_generation'),
    getPublishedPrompt('seed_plan_generation'),
    getPublishedPrompt('seeded_beat_materialization'),
    getPublishedPrompt('visual_prompt'),
    getPublishedPrompt('reel_visual_prompt'),
    getPublishedPrompt('image_generation'),
    getPublishedPrompt('reel_image_generation'),
    getPublishedPrompt('portrait_generation'),
    getStoryboardImageQualitySettings(),
    getFeatureFlagValue('reel_story_settings'),
    getPublishedReelVisualStylesForRuntime().catch(() => []),
  ]);
  return {
    storyModel: map.get('story_generation')?.modelId,
    storyTemperature: map.get('story_generation')?.temperature ?? undefined,
    reelStoryModel: map.get('reel_story_generation')?.modelId,
    reelStoryTemperature: map.get('reel_story_generation')?.temperature ?? undefined,
    seedPlanModel: map.get('seed_plan_generation')?.modelId,
    seedPlanTemperature: map.get('seed_plan_generation')?.temperature ?? undefined,
    seededBeatModel: map.get('seeded_beat_materialization')?.modelId,
    seededBeatTemperature: map.get('seeded_beat_materialization')?.temperature ?? undefined,
    composerModel: map.get('visual_prompt')?.modelId,
    composerTemperature: map.get('visual_prompt')?.temperature ?? undefined,
    reelComposerModel: map.get('reel_visual_prompt')?.modelId,
    reelComposerTemperature: map.get('reel_visual_prompt')?.temperature ?? undefined,
    imageModel: map.get('image_generation')?.modelId,
    reelImageModel: map.get('reel_image_generation')?.modelId,
    portraitModel: map.get('portrait_generation')?.modelId,
    storyPrompt,
    reelStoryPrompt,
    seedPlanPrompt,
    seededBeatPrompt,
    visualPrompt,
    reelVisualPrompt,
    imagePrompt,
    reelImagePrompt,
    portraitPrompt,
    reelSettings: parseReelStorySettingsValue(reelSettingsValue),
    reelVisualStyles,
    storyboardImageSettings,
    enableStoryboard: true,
  };
}

export async function getReelStorySetupSettings(): Promise<ReelStorySetupSettings> {
  const [enabled, publishEnabled, settingsValue] = await Promise.all([
    getFeatureFlag('reel_story_enabled', false),
    getFeatureFlag('reel_story_publish_enabled', false),
    getFeatureFlagValue('reel_story_settings'),
  ]);

  return {
    enabled,
    publishEnabled,
    settings: parseReelStorySettingsValue(settingsValue),
  };
}

export async function setReelStoryEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('reel_story_enabled', enabled);
}

export async function setReelStoryPublishEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('reel_story_publish_enabled', enabled);
}

export async function saveReelStorySettings(settings: ReelStorySettings): Promise<ReelStorySettings> {
  await verifyAdmin();
  const normalized = normalizeReelStorySettings(settings);
  await setFeatureFlagValue('reel_story_settings', serializeReelStorySettings(normalized));
  return normalized;
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

function parseFlagNumber(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getImageUploadOptimizationSettings(): Promise<ImageUploadOptimizationSettings> {
  const keys = IMAGE_UPLOAD_OPTIMIZATION_FLAG_KEYS;
  const defaults = DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS;
  const [
    clientSideCompressionEnabled,
    compressBeatImages,
    compressStoryboardImages,
    compressCoverImages,
    compressSocialCoverImages,
    compressCharacterRefs,
    outputFormat,
    defaultWebpQuality,
    characterRefWebpQuality,
    maxLandscapeWidth,
    maxLandscapeHeight,
    maxVerticalWidth,
    maxVerticalHeight,
    maxCharacterRefDimension,
    rawSelectedFileLimitMB,
    finalUploadLimitMB,
    showCompressionStatsToUser,
    allowOriginalUploadIfCompressionFailsAndWithinLimit,
  ] = await Promise.all([
    getFeatureFlag(keys.clientSideCompressionEnabled, defaults.clientSideCompressionEnabled),
    getFeatureFlag(keys.compressBeatImages, defaults.compressBeatImages),
    getFeatureFlag(keys.compressStoryboardImages, defaults.compressStoryboardImages),
    getFeatureFlag(keys.compressCoverImages, defaults.compressCoverImages),
    getFeatureFlag(keys.compressSocialCoverImages, defaults.compressSocialCoverImages),
    getFeatureFlag(keys.compressCharacterRefs, defaults.compressCharacterRefs),
    getFeatureFlagValue(keys.outputFormat),
    getFeatureFlagValue(keys.defaultWebpQuality),
    getFeatureFlagValue(keys.characterRefWebpQuality),
    getFeatureFlagValue(keys.maxLandscapeWidth),
    getFeatureFlagValue(keys.maxLandscapeHeight),
    getFeatureFlagValue(keys.maxVerticalWidth),
    getFeatureFlagValue(keys.maxVerticalHeight),
    getFeatureFlagValue(keys.maxCharacterRefDimension),
    getFeatureFlagValue(keys.rawSelectedFileLimitMB),
    getFeatureFlagValue(keys.finalUploadLimitMB),
    getFeatureFlag(keys.showCompressionStatsToUser, defaults.showCompressionStatsToUser),
    getFeatureFlag(
      keys.allowOriginalUploadIfCompressionFailsAndWithinLimit,
      defaults.allowOriginalUploadIfCompressionFailsAndWithinLimit
    ),
  ]);

  return normalizeImageUploadOptimizationSettings({
    clientSideCompressionEnabled,
    compressBeatImages,
    compressStoryboardImages,
    compressCoverImages,
    compressSocialCoverImages,
    compressCharacterRefs,
    outputFormat: outputFormat === 'webp' ? 'webp' : defaults.outputFormat,
    defaultWebpQuality: parseFlagNumber(defaultWebpQuality, defaults.defaultWebpQuality),
    characterRefWebpQuality: parseFlagNumber(characterRefWebpQuality, defaults.characterRefWebpQuality),
    maxLandscapeWidth: parseFlagNumber(maxLandscapeWidth, defaults.maxLandscapeWidth),
    maxLandscapeHeight: parseFlagNumber(maxLandscapeHeight, defaults.maxLandscapeHeight),
    maxVerticalWidth: parseFlagNumber(maxVerticalWidth, defaults.maxVerticalWidth),
    maxVerticalHeight: parseFlagNumber(maxVerticalHeight, defaults.maxVerticalHeight),
    maxCharacterRefDimension: parseFlagNumber(maxCharacterRefDimension, defaults.maxCharacterRefDimension),
    rawSelectedFileLimitMB: parseFlagNumber(rawSelectedFileLimitMB, defaults.rawSelectedFileLimitMB),
    finalUploadLimitMB: parseFlagNumber(finalUploadLimitMB, defaults.finalUploadLimitMB),
    showCompressionStatsToUser,
    allowOriginalUploadIfCompressionFailsAndWithinLimit,
  });
}

export async function saveImageUploadOptimizationSettings(
  input: Partial<ImageUploadOptimizationSettings>
): Promise<ImageUploadOptimizationSettings> {
  await verifyAdmin();
  const settings = normalizeImageUploadOptimizationSettings(input);
  const keys = IMAGE_UPLOAD_OPTIMIZATION_FLAG_KEYS;

  await Promise.all([
    setFeatureFlag(keys.clientSideCompressionEnabled, settings.clientSideCompressionEnabled),
    setFeatureFlag(keys.compressBeatImages, settings.compressBeatImages),
    setFeatureFlag(keys.compressStoryboardImages, settings.compressStoryboardImages),
    setFeatureFlag(keys.compressCoverImages, settings.compressCoverImages),
    setFeatureFlag(keys.compressSocialCoverImages, settings.compressSocialCoverImages),
    setFeatureFlag(keys.compressCharacterRefs, settings.compressCharacterRefs),
    setFeatureFlagValue(keys.outputFormat, settings.outputFormat),
    setFeatureFlagValue(keys.defaultWebpQuality, String(settings.defaultWebpQuality)),
    setFeatureFlagValue(keys.characterRefWebpQuality, String(settings.characterRefWebpQuality)),
    setFeatureFlagValue(keys.maxLandscapeWidth, String(settings.maxLandscapeWidth)),
    setFeatureFlagValue(keys.maxLandscapeHeight, String(settings.maxLandscapeHeight)),
    setFeatureFlagValue(keys.maxVerticalWidth, String(settings.maxVerticalWidth)),
    setFeatureFlagValue(keys.maxVerticalHeight, String(settings.maxVerticalHeight)),
    setFeatureFlagValue(keys.maxCharacterRefDimension, String(settings.maxCharacterRefDimension)),
    setFeatureFlagValue(keys.rawSelectedFileLimitMB, String(settings.rawSelectedFileLimitMB)),
    setFeatureFlagValue(keys.finalUploadLimitMB, String(settings.finalUploadLimitMB)),
    setFeatureFlag(keys.showCompressionStatsToUser, settings.showCompressionStatsToUser),
    setFeatureFlag(
      keys.allowOriginalUploadIfCompressionFailsAndWithinLimit,
      settings.allowOriginalUploadIfCompressionFailsAndWithinLimit
    ),
  ]);

  return settings;
}

export async function saveMediaStorageSettings(
  input: Partial<MediaStorageSettings>
): Promise<MediaStorageAdminState> {
  await verifyAdmin();
  const settings = normalizeMediaStorageSettings(input);
  const keys = MEDIA_STORAGE_FLAG_KEYS;

  await Promise.all([
    setFeatureFlagValue(keys.storageProvider, settings.storageProvider),
    setFeatureFlag(keys.r2Enabled, settings.r2Enabled),
    setFeatureFlag(keys.r2UseForImages, settings.r2UseForImages),
    setFeatureFlag(keys.r2UseForCovers, settings.r2UseForCovers),
    setFeatureFlag(keys.r2UseForNarrationAudio, settings.r2UseForNarrationAudio),
    setFeatureFlag(keys.r2PublicDeliveryForPublishedStories, settings.r2PublicDeliveryForPublishedStories),
    setFeatureFlag(keys.r2GenerateThumbnails, settings.r2GenerateThumbnails),
    setFeatureFlag(keys.r2FallbackToSupabase, settings.r2FallbackToSupabase),
    setFeatureFlagValue(keys.publishedAssetCacheDuration, String(settings.publishedAssetCacheDuration)),
  ]);

  return loadMediaStorageAdminState();
}

// Every feature_flags key read (directly or via a composite fetcher) inside
// getGlobalSettings below. Warming these in one query lets the per-key getters
// short-circuit to cache instead of doing ~70+ individual round-trips on a cold
// cache. Keep this list in sync when adding/removing flag reads in
// getGlobalSettings — a stale entry only costs a warmed-but-unused cache row,
// and a missing entry only falls back to an individual read (never a wrong
// value). Keys sourced from constants are spread so they can't drift.
const GLOBAL_SETTINGS_WARM_KEYS: readonly string[] = [
  // Storyboard (inline + getStoryboardImageQualitySettings)
  'storyboard_cycle_override',
  'storyboard_cycle_ms',
  'storyboard_vignette_enabled',
  'storyboard_vignette_amount_percent',
  'storyboard_image_size',
  'storyboard_webp_compression_enabled',
  'storyboard_webp_quality_percent',
  'storyboard_client_processing_enabled',
  'storyboard_layout_mode',
  // Reader / loader
  'story_loading_node_labels_enabled',
  'story_loading_hint_typewriter_enabled',
  'story_loading_reader_anticipation_ms',
  'story_loading_reader_story_text_enabled',
  'story_loading_reader_options_enabled',
  'story_loading_reader_scroll_speed_px_per_second',
  'story_ui_text_line_count',
  'story_ui_auto_scroll_enabled',
  'story_text_overlay_words_per_line',
  // Persistence / branch flash
  'client_story_persistence_enabled',
  'storyline_choice_flash_enabled',
  'storyline_choice_flash_ms',
  // Character sheets
  'character_sheet_enabled_free_plus',
  'character_sheet_enabled_creator',
  // Prompt-only / vertical / audio
  'story_prompt_only_mode_enabled',
  'vertical_stories_setting_enabled',
  'audio_storyline_publish_enabled',
  // Video export
  'video_download_enabled',
  'video_download_admin_bypass',
  // Asset sync
  'story_asset_signed_url_swap_enabled',
  'story_incremental_asset_sync_enabled',
  'story_asset_upload_pause_during_generation_enabled',
  // Timeouts + authoring
  'gemini_text_timeout_ms',
  'gemini_image_timeout_ms',
  'gemini_tts_timeout_ms',
  'cloud_save_timeout_ms',
  'story_asset_sync_warning_timeout_ms',
  'story_authoring_word_cap',
  // Prompt-only image gallery
  'prompt_only_max_images_per_beat',
  'prompt_only_image_gallery_cleanup_enabled',
  'prompt_only_image_gallery_cleanup_days',
  // Composite fetchers (keys sourced from their own constants)
  ...Object.values(IMAGE_UPLOAD_OPTIMIZATION_FLAG_KEYS),
  ...Object.values(MEDIA_STORAGE_FLAG_KEYS),
  ...Object.values(NARRATION_VOICE_FLAG_KEYS),
  ...SUPPORTED_NARRATION_VOICE_LANGUAGES.map((language) => language.sampleTextFlagKey),
  ...Object.values(NARRATION_ACCENT_FLAG_KEYS),
  STORY_LANGUAGE_ENABLED_FLAG_KEY,
];

// `section` scopes the two real DB round-trips below (narration sample statuses
// + preview seed-plan price) to the pages that actually render them. Every other
// value is served from the warm flag cache, so the rest stays a single query
// regardless of section. Defaults to 'overview', which fetches everything (its
// live summaries read both scoped values).
export async function getGlobalSettings(section: string = 'overview'): Promise<{
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
  storyTextOverlayWordsPerLine: number;
  clientStoryPersistenceEnabled: boolean;
  storylineChoiceFlashEnabled: boolean;
  storylineChoiceFlashMs: number;
  freePlusCharacterSheetsEnabled: boolean;
  creatorCharacterSheetsEnabled: boolean;
  storyPromptOnlyModeEnabled: boolean;
  verticalStoriesSettingEnabled: boolean;
  audioStorylinePublishEnabled: boolean;
  videoDownloadEnabled: boolean;
  videoDownloadAdminBypass: boolean;
  storyAssetSignedUrlSwapEnabled: boolean;
  storyIncrementalAssetSyncEnabled: boolean;
  storyAssetUploadPauseDuringGenerationEnabled: boolean;
  textTimeoutMs: number;
  imageTimeoutMs: number;
  ttsTimeoutMs: number;
  cloudSaveTimeoutMs: number;
  storyAssetSyncWarningTimeoutMs: number;
  authoringWordCap: number;
  previewSeedPlanPriceCoins: number;
  promptOnlyMaxImagesPerBeat: number;
  promptOnlyImageGalleryCleanupEnabled: boolean;
  promptOnlyImageGalleryCleanupDays: number;
  imageUploadOptimizationSettings: ImageUploadOptimizationSettings;
  mediaStorage: MediaStorageAdminState;
  narrationVoiceSettings: NarrationVoiceSettings;
  narrationVoiceSampleStatuses: NarrationVoiceSampleClientStatus[];
  enabledStoryLanguageIds: StoryLanguage[];
}> {
  await verifyAdmin();
  // Warm both flag caches in one query so the per-key getters below (including
  // those inside the composite fetchers) hit cache instead of round-tripping.
  await warmFeatureFlagCaches(GLOBAL_SETTINGS_WARM_KEYS);
  // Only these two sections (and the overview, which summarizes both) render the
  // narration sample statuses / preview seed-plan price, so skip their DB reads
  // everywhere else. When skipped they resolve to the same empty values the
  // component holds by default and never displays off-section.
  const needsNarrationSamples = section === 'overview' || section === 'narration';
  const needsPreviewPrice = section === 'overview' || section === 'authoring';
  const [cycleOverride, cycleMsStr, vignetteEnabled, vignetteAmountValue, storyboardImageSettings, loadingNodeLabelsEnabled, loadingHintTypewriterEnabled, loadingReaderAnticipationMsStr, loadingReaderStoryTextEnabled, loadingReaderOptionsEnabled, loadingReaderScrollSpeedStr, storyUiTextLineCountValue, storyUiAutoScrollEnabled, storyTextOverlayWordsPerLineValue, clientStoryPersistenceEnabled, storylineChoiceFlashEnabled, storylineChoiceFlashMsStr, freePlusCharacterSheetsEnabled, creatorCharacterSheetsEnabled, storyPromptOnlyModeEnabled, verticalStoriesSettingEnabled, audioStorylinePublishEnabled, videoDownloadEnabled, videoDownloadAdminBypass, storyAssetSignedUrlSwapEnabled, storyIncrementalAssetSyncEnabled, storyAssetUploadPauseDuringGenerationEnabled, textMs, imageMs, ttsMs, saveMs, storyAssetSyncWarningTimeoutMs, authoringWordCapStr, previewSeedPlanPriceCoins, promptOnlyMaxImagesPerBeatStr, promptOnlyImageGalleryCleanupEnabledFlag, promptOnlyImageGalleryCleanupDaysStr, imageUploadOptimizationSettings, mediaStorage, narrationBundle, enabledStoryLanguageIds] = await Promise.all([
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
    getFeatureFlagValue('story_text_overlay_words_per_line'),
    getFeatureFlag('client_story_persistence_enabled', false),
    getFeatureFlag('storyline_choice_flash_enabled', true),
    getFeatureFlagValue('storyline_choice_flash_ms'),
    getFeatureFlag('character_sheet_enabled_free_plus'),
    getFeatureFlag('character_sheet_enabled_creator'),
    getFeatureFlag('story_prompt_only_mode_enabled', false),
    getFeatureFlag('vertical_stories_setting_enabled', false),
    getFeatureFlag('audio_storyline_publish_enabled', false),
    getFeatureFlag('video_download_enabled'),
    getFeatureFlag('video_download_admin_bypass'),
    getFeatureFlag('story_asset_signed_url_swap_enabled', false),
    getFeatureFlag('story_incremental_asset_sync_enabled', false),
    getFeatureFlag('story_asset_upload_pause_during_generation_enabled', false),
    getFeatureFlagValue('gemini_text_timeout_ms'),
    getFeatureFlagValue('gemini_image_timeout_ms'),
    getFeatureFlagValue('gemini_tts_timeout_ms'),
    getFeatureFlagValue('cloud_save_timeout_ms'),
    getFeatureFlagValue('story_asset_sync_warning_timeout_ms'),
    getFeatureFlagValue('story_authoring_word_cap'),
    needsPreviewPrice ? getPreviewSeedPlanPriceCoins() : Promise.resolve(0),
    getFeatureFlagValue('prompt_only_max_images_per_beat'),
    getFeatureFlag('prompt_only_image_gallery_cleanup_enabled', true),
    getFeatureFlagValue('prompt_only_image_gallery_cleanup_days'),
    getImageUploadOptimizationSettings(),
    loadMediaStorageAdminState(),
    (async () => {
      // Sequential so the statuses fetch's internal getNarrationVoiceSettings()
      // read reuses the first call's result instead of fetching voice settings
      // twice (the warm cache already covers this; sequencing keeps the dedupe
      // even if warming failed).
      const settings = await getNarrationVoiceSettings();
      const statuses = needsNarrationSamples ? await getNarrationVoiceSampleStatusesForAdmin() : [];
      return { settings, statuses };
    })(),
    getEnabledStoryLanguageIds(),
  ]);
  const narrationVoiceSettings = narrationBundle.settings;
  const narrationVoiceSampleStatuses = narrationBundle.statuses;
  const parsedLoadingReaderAnticipationMs = parseInt(loadingReaderAnticipationMsStr ?? '10000', 10);
  const parsedLoadingReaderScrollSpeed = parseInt(loadingReaderScrollSpeedStr ?? '24', 10);
  const parsedStorylineChoiceFlashMs = parseInt(storylineChoiceFlashMsStr ?? '3000', 10);

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
    storyTextOverlayWordsPerLine: normalizeStoryTextOverlayWordsPerLine(storyTextOverlayWordsPerLineValue),
    clientStoryPersistenceEnabled,
    storylineChoiceFlashEnabled,
    storylineChoiceFlashMs: Number.isFinite(parsedStorylineChoiceFlashMs)
      ? Math.max(500, Math.min(30000, parsedStorylineChoiceFlashMs))
      : 3000,
    freePlusCharacterSheetsEnabled,
    creatorCharacterSheetsEnabled,
    storyPromptOnlyModeEnabled,
    verticalStoriesSettingEnabled,
    audioStorylinePublishEnabled,
    videoDownloadEnabled,
    videoDownloadAdminBypass,
    storyAssetSignedUrlSwapEnabled,
    storyIncrementalAssetSyncEnabled,
    storyAssetUploadPauseDuringGenerationEnabled,
    textTimeoutMs: parseInt(textMs ?? '30000', 10) || 30000,
    imageTimeoutMs: parseInt(imageMs ?? '90000', 10) || 90000,
    ttsTimeoutMs: parseInt(ttsMs ?? '120000', 10) || 120000,
    cloudSaveTimeoutMs: parseInt(saveMs ?? '20000', 10) || 20000,
    storyAssetSyncWarningTimeoutMs: parseInt(storyAssetSyncWarningTimeoutMs ?? '15000', 10) || 15000,
    authoringWordCap: parseInt(authoringWordCapStr ?? '500', 10) || 500,
    previewSeedPlanPriceCoins,
    promptOnlyMaxImagesPerBeat: Math.max(1, Math.min(10, parseInt(promptOnlyMaxImagesPerBeatStr ?? '3', 10) || 3)),
    promptOnlyImageGalleryCleanupEnabled: promptOnlyImageGalleryCleanupEnabledFlag,
    promptOnlyImageGalleryCleanupDays: Math.max(1, Math.min(90, parseInt(promptOnlyImageGalleryCleanupDaysStr ?? '7', 10) || 7)),
    imageUploadOptimizationSettings,
    mediaStorage,
    narrationVoiceSettings,
    narrationVoiceSampleStatuses,
    enabledStoryLanguageIds,
  };
}

export async function saveAdminStoryLanguageSettings(
  enabledIds: StoryLanguage[]
): Promise<{ enabledStoryLanguageIds: StoryLanguage[] }> {
  await verifyAdmin();
  const enabledStoryLanguageIds = await saveEnabledStoryLanguageIds(enabledIds);
  return { enabledStoryLanguageIds };
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

export async function setStoryTextOverlayWordsPerLine(words: number): Promise<void> {
  await verifyAdmin();
  if (
    !Number.isFinite(words)
    || words < MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE
    || words > MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE
  ) {
    throw new Error(`Story overlay words per line must be between ${MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE} and ${MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE}.`);
  }
  await setFeatureFlagValue('story_text_overlay_words_per_line', String(normalizeStoryTextOverlayWordsPerLine(words)));
}

export async function setStoryUiAutoScroll(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_ui_auto_scroll_enabled', enabled);
}

export async function setStorylineChoiceFlashEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('storyline_choice_flash_enabled', enabled);
}

export async function setStorylineChoiceFlashMs(ms: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(ms) || ms < 500 || ms > 30000) {
    throw new Error('Storyline choice flash duration must be between 0.5 and 30 seconds.');
  }
  await setFeatureFlagValue('storyline_choice_flash_ms', String(Math.round(ms)));
}

export async function setFreePlusCharacterSheets(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('character_sheet_enabled_free_plus', enabled);
}

export async function setCreatorCharacterSheets(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('character_sheet_enabled_creator', enabled);
}

export async function setStoryPromptOnlyModeEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_prompt_only_mode_enabled', enabled);
}

export async function setVerticalStoriesSettingEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('vertical_stories_setting_enabled', enabled);
}

export async function setAudioStorylinePublishEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('audio_storyline_publish_enabled', enabled);
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

export async function setClientStoryPersistenceEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('client_story_persistence_enabled', enabled);
}

export async function getStoryAssetSignedUrlSwapEnabled(): Promise<boolean> {
  return getFeatureFlag('story_asset_signed_url_swap_enabled', false);
}

export async function setStoryIncrementalAssetSync(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_incremental_asset_sync_enabled', enabled);
}

export async function getStoryIncrementalAssetSyncEnabled(): Promise<boolean> {
  return getFeatureFlag('story_incremental_asset_sync_enabled', false);
}

export async function setStoryAssetUploadPauseDuringGeneration(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('story_asset_upload_pause_during_generation_enabled', enabled);
}

export async function getStoryAssetUploadPauseDuringGenerationEnabled(): Promise<boolean> {
  return getFeatureFlag('story_asset_upload_pause_during_generation_enabled', false);
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

export async function setStoryAssetSyncWarningTimeout(ms: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(ms) || ms < 1000) {
    throw new Error('Beat asset sync warning timeout must be at least 1000 milliseconds.');
  }
  await setFeatureFlagValue('story_asset_sync_warning_timeout_ms', String(Math.round(ms)));
}

export async function setPromptOnlyMaxImagesPerBeat(count: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(count) || count < 1 || count > 10) {
    throw new Error('Max images per prompt-only beat must be between 1 and 10.');
  }
  await setFeatureFlagValue('prompt_only_max_images_per_beat', String(Math.round(count)));
}

export async function setPromptOnlyImageGalleryCleanupEnabled(enabled: boolean): Promise<void> {
  await verifyAdmin();
  await setFeatureFlag('prompt_only_image_gallery_cleanup_enabled', enabled);
}

export async function setPromptOnlyImageGalleryCleanupDays(days: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(days) || days < 1 || days > 90) {
    throw new Error('Cleanup window must be between 1 and 90 days.');
  }
  await setFeatureFlagValue('prompt_only_image_gallery_cleanup_days', String(Math.round(days)));
}

export async function setAuthoringWordCap(words: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(words) || words < 50) {
    throw new Error('Authoring word cap must be at least 50 words.');
  }
  await setFeatureFlagValue('story_authoring_word_cap', String(Math.round(words)));
}

export interface BeatControlAdminSettings {
  flags: Record<BeatControlFlagKey, boolean>;
  maxImageVersionsPerBeat: number;
}

export async function getBeatControlAdminSettings(): Promise<BeatControlAdminSettings> {
  await verifyAdmin();
  const [values, maxVersionsRaw] = await Promise.all([
    Promise.all(BEAT_CONTROL_FLAG_KEYS.map((key) => getFeatureFlag(key, false))),
    getFeatureFlagValue(BEAT_IMAGE_MAX_VERSIONS_FLAG_KEY),
  ]);
  const flags = Object.fromEntries(
    BEAT_CONTROL_FLAG_KEYS.map((key, index) => [key, values[index]])
  ) as Record<BeatControlFlagKey, boolean>;
  return {
    flags,
    maxImageVersionsPerBeat: normalizeMaxImageVersionsPerBeat(maxVersionsRaw),
  };
}

export async function setBeatControlFlag(key: BeatControlFlagKey, enabled: boolean): Promise<void> {
  await verifyAdmin();
  if (!BEAT_CONTROL_FLAG_KEYS.includes(key)) {
    throw new Error(`Unknown beat control flag: ${key}`);
  }
  await setFeatureFlag(key, enabled);
}

export async function setBeatImageMaxVersionsPerBeat(count: number): Promise<void> {
  await verifyAdmin();
  if (
    !Number.isFinite(count) ||
    count < MIN_BEAT_IMAGE_VERSIONS_PER_BEAT ||
    count > MAX_BEAT_IMAGE_VERSIONS_PER_BEAT
  ) {
    throw new Error(
      `Max image versions per beat must be between ${MIN_BEAT_IMAGE_VERSIONS_PER_BEAT} and ${MAX_BEAT_IMAGE_VERSIONS_PER_BEAT}.`
    );
  }
  await setFeatureFlagValue(BEAT_IMAGE_MAX_VERSIONS_FLAG_KEY, String(Math.round(count)));
}

export interface CharacterUniverseAdminSettings {
  flags: Record<CharacterUniverseFlagKey, boolean>;
}

export async function getCharacterUniverseAdminSettings(): Promise<CharacterUniverseAdminSettings> {
  await verifyAdmin();
  const values = await Promise.all(
    CHARACTER_UNIVERSE_FLAG_KEYS.map((key) => getFeatureFlag(key, false))
  );
  const flags = Object.fromEntries(
    CHARACTER_UNIVERSE_FLAG_KEYS.map((key, index) => [key, values[index]])
  ) as Record<CharacterUniverseFlagKey, boolean>;
  return { flags };
}

export async function setCharacterUniverseFlag(
  key: CharacterUniverseFlagKey,
  enabled: boolean
): Promise<void> {
  await verifyAdmin();
  if (!CHARACTER_UNIVERSE_FLAG_KEYS.includes(key)) {
    throw new Error(`Unknown character universe flag: ${key}`);
  }
  await setFeatureFlag(key, enabled);
}

export async function setPreviewSeedPlanPriceCoins(coins: number): Promise<void> {
  await verifyAdmin();
  if (!Number.isFinite(coins) || coins < 0) {
    throw new Error('Preview price must be 0 or more.');
  }
  if (!Number.isInteger(coins)) {
    throw new Error('Preview price must be a whole number of coins.');
  }

  await savePricingActionCost({
    actionKey: 'preview_seed_plan',
    beatCost: Number((coins / COINS_PER_BEAT).toFixed(2)),
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
  storyTextOverlayWordsPerLine: number;
  storylineChoiceFlashEnabled: boolean;
  storylineChoiceFlashMs: number;
  cloudSaveTimeoutMs: number;
  freePlusCharacterSheetsEnabled: boolean;
  creatorCharacterSheetsEnabled: boolean;
  storyPromptOnlyModeEnabled: boolean;
  verticalStoriesSettingEnabled: boolean;
  audioStorylinePublishEnabled: boolean;
  reelStoryPublishEnabled: boolean;
  videoDownloadEnabled: boolean;
  videoDownloadAdminBypass: boolean;
  storyAssetSignedUrlSwapEnabled: boolean;
  storyIncrementalAssetSyncEnabled: boolean;
  storyAssetUploadPauseDuringGenerationEnabled: boolean;
  authoringWordCap: number;
  storyAssetSyncWarningTimeoutMs: number;
  promptOnlyMaxImagesPerBeat: number;
  promptOnlyImageGalleryCleanupEnabled: boolean;
  promptOnlyImageGalleryCleanupDays: number;
  characterSheetUploadEnabled: boolean;
  characterSheetUploadMaxBytes: number;
  characterSheetMaxPerCharacter: number;
  characterSheetCleanupEnabled: boolean;
  characterSheetCleanupDays: number;
  imageUploadOptimizationSettings: ImageUploadOptimizationSettings;
}> {
  const [cycleOverride, cycleMsStr, vignetteEnabled, vignetteAmountValue, storyboardImageSettings, loadingNodeLabelsEnabled, loadingHintTypewriterEnabled, loadingReaderAnticipationMsStr, loadingReaderStoryTextEnabled, loadingReaderOptionsEnabled, loadingReaderScrollSpeedStr, storyUiTextLineCountValue, storyUiAutoScrollEnabled, storyTextOverlayWordsPerLineValue, storylineChoiceFlashEnabled, storylineChoiceFlashMsStr, saveMs, freePlusCharacterSheetsEnabled, creatorCharacterSheetsEnabled, storyPromptOnlyModeEnabled, verticalStoriesSettingEnabled, audioStorylinePublishEnabled, reelStoryPublishEnabled, videoDownloadEnabled, videoDownloadAdminBypass, storyAssetSignedUrlSwapEnabled, storyIncrementalAssetSyncEnabled, storyAssetUploadPauseDuringGenerationEnabled, storyAssetSyncWarningTimeoutMs, authoringWordCapStr, promptOnlyMaxImagesPerBeatStr, promptOnlyImageGalleryCleanupEnabled, promptOnlyImageGalleryCleanupDaysStr, characterSheetUploadEnabled, characterSheetUploadMaxBytesStr, characterSheetMaxPerCharacterStr, characterSheetCleanupEnabled, characterSheetCleanupDaysStr, imageUploadOptimizationSettings] = await Promise.all([
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
    getFeatureFlagValue('story_text_overlay_words_per_line'),
    getFeatureFlag('storyline_choice_flash_enabled', true),
    getFeatureFlagValue('storyline_choice_flash_ms'),
    getFeatureFlagValue('cloud_save_timeout_ms'),
    getFeatureFlag('character_sheet_enabled_free_plus'),
    getFeatureFlag('character_sheet_enabled_creator'),
    getFeatureFlag('story_prompt_only_mode_enabled', false),
    getFeatureFlag('vertical_stories_setting_enabled', false),
    getFeatureFlag('audio_storyline_publish_enabled', false),
    getFeatureFlag('reel_story_publish_enabled', false),
    getFeatureFlag('video_download_enabled'),
    getFeatureFlag('video_download_admin_bypass'),
    getFeatureFlag('story_asset_signed_url_swap_enabled', false),
    getFeatureFlag('story_incremental_asset_sync_enabled', false),
    getFeatureFlag('story_asset_upload_pause_during_generation_enabled', false),
    getFeatureFlagValue('story_asset_sync_warning_timeout_ms'),
    getFeatureFlagValue('story_authoring_word_cap'),
    getFeatureFlagValue('prompt_only_max_images_per_beat'),
    getFeatureFlag('prompt_only_image_gallery_cleanup_enabled', true),
    getFeatureFlagValue('prompt_only_image_gallery_cleanup_days'),
    getFeatureFlag('character_sheet_upload_enabled', true),
    getFeatureFlagValue('character_sheet_upload_max_bytes'),
    getFeatureFlagValue('character_sheet_max_per_character'),
    getFeatureFlag('character_sheet_cleanup_enabled', true),
    getFeatureFlagValue('character_sheet_cleanup_days'),
    getImageUploadOptimizationSettings(),
  ]);
  const parsedLoadingReaderAnticipationMs = parseInt(loadingReaderAnticipationMsStr ?? '10000', 10);
  const parsedLoadingReaderScrollSpeed = parseInt(loadingReaderScrollSpeedStr ?? '24', 10);
  const parsedStorylineChoiceFlashMs = parseInt(storylineChoiceFlashMsStr ?? '3000', 10);
  const parsedCharacterSheetMaxBytes = parseInt(characterSheetUploadMaxBytesStr ?? '5242880', 10);
  const parsedCharacterSheetMaxPerCharacter = parseInt(characterSheetMaxPerCharacterStr ?? '3', 10);
  const parsedCharacterSheetCleanupDays = parseInt(characterSheetCleanupDaysStr ?? '7', 10);

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
    storyTextOverlayWordsPerLine: normalizeStoryTextOverlayWordsPerLine(storyTextOverlayWordsPerLineValue),
    storylineChoiceFlashEnabled,
    storylineChoiceFlashMs: Number.isFinite(parsedStorylineChoiceFlashMs)
      ? Math.max(500, Math.min(30000, parsedStorylineChoiceFlashMs))
      : 3000,
    cloudSaveTimeoutMs: parseInt(saveMs ?? '20000', 10) || 20000,
    freePlusCharacterSheetsEnabled,
    creatorCharacterSheetsEnabled,
    storyPromptOnlyModeEnabled,
    verticalStoriesSettingEnabled,
    audioStorylinePublishEnabled,
    reelStoryPublishEnabled,
    videoDownloadEnabled,
    videoDownloadAdminBypass,
    storyAssetSignedUrlSwapEnabled,
    storyIncrementalAssetSyncEnabled,
    storyAssetUploadPauseDuringGenerationEnabled,
    authoringWordCap: parseInt(authoringWordCapStr ?? '500', 10) || 500,
    storyAssetSyncWarningTimeoutMs: parseInt(storyAssetSyncWarningTimeoutMs ?? '15000', 10) || 15000,
    promptOnlyMaxImagesPerBeat: Math.max(1, Math.min(10, parseInt(promptOnlyMaxImagesPerBeatStr ?? '3', 10) || 3)),
    promptOnlyImageGalleryCleanupEnabled,
    promptOnlyImageGalleryCleanupDays: Math.max(1, Math.min(90, parseInt(promptOnlyImageGalleryCleanupDaysStr ?? '7', 10) || 7)),
    characterSheetUploadEnabled,
    characterSheetUploadMaxBytes: Number.isFinite(parsedCharacterSheetMaxBytes)
      ? Math.max(1024 * 1024, Math.min(50 * 1024 * 1024, parsedCharacterSheetMaxBytes))
      : 5 * 1024 * 1024,
    characterSheetMaxPerCharacter: Number.isFinite(parsedCharacterSheetMaxPerCharacter)
      ? Math.max(1, Math.min(10, parsedCharacterSheetMaxPerCharacter))
      : 3,
    characterSheetCleanupEnabled,
    characterSheetCleanupDays: Number.isFinite(parsedCharacterSheetCleanupDays)
      ? Math.max(1, Math.min(90, parsedCharacterSheetCleanupDays))
      : 7,
    imageUploadOptimizationSettings,
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
  return Number((beatCost * COINS_PER_BEAT).toFixed(2));
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
