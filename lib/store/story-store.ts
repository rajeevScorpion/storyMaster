import { create } from 'zustand';
import { StorySession, StoryBeat, StoryConfig, StoryMap, StoryNode, Character, CharacterSheetGalleryEntry, StoryboardPlan, PortraitReferenceConfig, PortraitTask, SeedBeatOutline, Option, type EpisodeSessionContext, type StoryAspectRatio } from '../types/story';
import type { EpisodeContinuationSeed } from '@/lib/types/episodes';
import { recordEpisodeStarted } from '@/app/actions/episodes';
import { appendEpisodeTitleImageInstruction, filterCarriedPortraitTasks } from '@/lib/episodes/continuity';
import { v4 as uuidv4 } from 'uuid';
import {
  buildFinalStoryboardImagePrompt,
  buildReelPanelCaptions,
  composeStoryboardPlan,
  generateReelDraft,
  generateStoryBeat,
  generateImage,
  generateCharacterPortrait,
  materializeSeededBeat,
  renderStoryboardPlan,
  type StoryModelOverrides,
  type ReferenceImage,
} from '@/app/actions/story-runtime';
import { buildFinalPortraitPrompt } from '@/lib/ai/portrait-prompt.shared';
import { selectRelevantWorld } from '@/lib/references/reference-routing';
import { ensureNarratorVoiceLocked, generateAndPersistNarration, generateReelNarrationOnly, resolveNarrationVoiceServer } from '@/app/actions/narration';
import {
  generateAndPersistStoryNarrationWithOverlay,
  generateStoryNarrationOnlyWithOverlay,
  generateStoryTextOverlayForBeat as generateStoryTextOverlayForBeatAction,
  generateStoryTextOverlayForStory as generateStoryTextOverlayForStoryAction,
  type StoryTextOverlayBeatGenerationResult,
  type StoryTextOverlayStoryGenerationResult,
} from '@/app/actions/story-narration';
import { clearReelNarrationForBeatAction, saveReelNarrationSettingsAction } from '@/app/actions/reel-narration';
import { linkCostEventsToBeat } from '@/app/actions/cost-tracking';
import {
  generateBeatCore,
  processBeatVisuals,
  resolveBeatGenerationModeAction,
} from '@/app/actions/beat-bundle';
import { submitStoryImageBatch, submitStoryStatefulVisuals, reconcileStoryBatch } from '@/app/actions/image-batch';
import {
  enqueueBeatImageJob,
  getReadyBeatImages,
  getStoryImageJobStatuses,
  reconcileStoryImageJobs,
  resolveImageProcessingModeAction,
} from '@/app/actions/image-jobs';
import { normalizeStoryboardImageQualitySettings } from '@/lib/types/storyboard-settings';
import { submitStoryNarrationBatch, reconcileStoryNarration } from '@/app/actions/narration-batch';
import type { ImageBatchScope } from '@/lib/ai/image-batch.shared';
import {
  authorizeCurrentUserBillableAction,
  authorizeCurrentUserImageModelBillableAction,
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from '@/app/actions/pricing-enforcement';
import { DEFAULT_STORY_CONFIG, deriveVisualStyleSummary, getSeedPlan, isReelStoryConfig, normalizeStoryConfig } from '@/lib/ai/story-config';
import { DEFAULT_REEL_STORY_SETTINGS, findReelDefiner, normalizeReelStorySettings } from '@/lib/reel/settings';
import { normalizeEditedReelPanelTexts } from '@/lib/reel/captions';
import { DEFAULT_REEL_TEXT_OVERLAY_STYLE, normalizeReelTextOverlayStyle } from '@/lib/reel/styles';
import { buildStoryTextOverlayCaptions } from '@/lib/story-overlay/captions';
import {
  DEFAULT_STORY_TEXT_OVERLAY_STYLE,
  normalizeStoryTextOverlayStyle,
} from '@/lib/story-overlay/styles';
import { normalizeReelTransitionSettings, type ReelTransitionSettings } from '@/lib/reel/transitions';
import {
  normalizeStoryTransitionSettings,
  type StoryTransitionSettings,
} from '@/lib/story-transitions/settings';
import { copyStoryEffectConfig, normalizeStoryEffectConfig, type StoryEffectConfig } from '@/lib/story-effects/settings';
import { applyStoryEffectsToMap } from '@/lib/story-effects/story-map';
import { normalizeReelNarrationSettings, type ReelNarrationSettings } from '@/lib/reel/narration';
import { getStoryboardSettings, getStoryAssetSignedUrlSwapEnabled, getStoryModelOverrides } from '@/app/actions/admin';
import {
  addCustomOption as addCustomOptionAction,
  editBeatText as editBeatTextAction,
  getBeatControlRuntimeSettings,
  regenerateBeatOptions as regenerateBeatOptionsAction,
  restoreBeatImageVersion as restoreBeatImageVersionAction,
  type AddCustomOptionResult,
  type EditBeatTextResult,
  type RegenerateBeatOptionsResult,
  type RestoreBeatImageVersionResult,
} from '@/app/actions/beat-control';
import {
  buildRegenerationInstructionBlock,
  cleanPanelSuggestions,
  type BeatImageRegenerationOptions,
} from '@/lib/ai/image-regeneration.shared';
import {
  DEFAULT_BEAT_CONTROL_RUNTIME_SETTINGS,
  type BeatControlRuntimeSettings,
} from '@/lib/beat-control/settings';
import {
  DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS,
  type CharacterUniverseRuntimeSettings,
} from '@/lib/character-universe/settings';
import { getCharacterUniverseRuntimeSettings } from '@/app/actions/character-library';
import { saveStory as saveStoryAction, loadStory as loadStoryAction, saveBeat as saveBeatAction, autoPublishStoryline, copyCoverToPublicBucket, setStoryCoverImage, updateBeatMediaState } from '@/app/actions/persistence';
import {
  setCharacterReferenceSheetRecord,
  clearCharacterReferenceSheetRecord,
  selectCharacterReferenceSheetRecord,
  removeCharacterReferenceSheetEntryRecord,
} from '@/app/actions/character-assets';
import { loadStoryTree as loadStoryTreeAction, trackExploration as trackExplorationAction, refreshStoryMapSignedUrls as refreshStoryMapAction } from '@/app/actions/exploration';
import { uploadNodeAssets, replaceBase64WithUrls, stripBase64FromStoryMap, uploadCoverImage, extractStoragePath, signNodeAssetUrls, uploadAsset, deleteAsset, type NodeAssetUrlMap, type StorageUploadBody } from '@/lib/supabase/storage';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import type { PricingBillableActionAuthorization } from '@/lib/types/pricing';
import type { ImageCompressionMetadata } from '@/lib/media/imageUploadOptimization';
import { mergeRefreshedStoryMapAssetUrls } from '@/lib/media/refresh-merge';
import {
  normalizeBeatMediaFields,
  isBeatRowNotFoundError,
  getBeatPersistedImageUrl,
  hasBeatImpossibleImageState,
  getActiveGalleryStorageKey,
} from '@/lib/types/beat-media';
import { normalizeStoryboardNarrationTiming } from '@/lib/storyboard/narration-timing';
import { isStoryboardBeat } from '@/lib/storyboard/beat';
import {
  createStoryLoadingStage,
  type StoryLoadingFlow,
  type StoryLoadingStage,
} from '@/lib/story/loading-progress';
import { dispatchPricingRuntimeRefresh } from '@/lib/pricing/runtime-events';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import {
  extractImageContinuityState,
  type ImageContinuityStrategy,
  type ImageContinuityProviderState,
} from '@/lib/ai/image-continuity.shared';
import {
  putPendingBeatImage,
  getPendingBeatImage,
  listPendingBeatImagesForStory,
  updatePendingBeatImageAttempt,
  deletePendingBeatImage,
  type PendingBeatImageRecord,
} from '@/lib/story/pending-beat-images';
import { getPathToNode } from '../utils/story-map';
import {
  createStoryMap,
  addChildNode,
  findChildForOption,
  getBeatsToNode,
  getChoiceHistoryToNode,
  getCurrentNode,
  removeSubtree,
} from '../utils/story-map';
import {
  getLocalSessionUserId,
  loadCachedTreeStory,
  saveTreeProgress,
  saveTreeStoryAndPrefetch,
} from '@/lib/persistence/runtime';

interface PublishResult {
  alreadyPublished: boolean;
  storylineId: string;
  error?: string;
}

interface StoryErrorAction {
  label: string;
  href: string;
}

interface GenerationTimingStep {
  key: string;
  label: string;
  durationMs: number;
  meta?: Record<string, unknown>;
}

interface GenerationTimingSummary {
  scope: string;
  totalMs: number;
  steps: GenerationTimingStep[];
  meta?: Record<string, unknown>;
}

interface StorySaveRuntimeSettings {
  storyAssetSignedUrlSwapEnabled: boolean;
  storyIncrementalAssetSyncEnabled: boolean;
  storyAssetUploadPauseDuringGenerationEnabled: boolean;
  storyAssetSyncWarningTimeoutMs: number;
}

export interface LoadingReaderState {
  flow: StoryLoadingFlow;
  startedAt: number;
  storyTextReadyAt: number | null;
  message: string;
  selectedOptionLabel: string | null;
  fallbackTitle: string | null;
  fallbackText: string | null;
  generatedStoryText: string | null;
  generatedOptions: Pick<Option, 'id' | 'label' | 'intent'>[];
}

interface StoryState {
  session: StorySession | null;
  isLoading: boolean;
  loadingClues: string[];
  loadingStage: StoryLoadingStage | null;
  loadingReader: LoadingReaderState | null;
  error: string | null;
  errorAction: StoryErrorAction | null;
  isGeneratingAudio: boolean;
  isRegeneratingImage: boolean;
  /** Nodes with an in-flight server-pipeline image job (safe-to-close UI hint). */
  activeImageJobNodeIds: string[];
  isSubmittingImageBatch: boolean;
  imageBatchMessage: string | null;
  isGeneratingNarrationBatch: boolean;
  narrationBatchProgress: { current: number; total: number } | null;
  narrationBatchMessage: string | null;
  autoBuildProgress: { active: boolean; current: number; total: number } | null;
  audioReadyNodeId: string | null;
  storyMode: boolean;
  isSaving: boolean;
  saveStatus: 'idle' | 'unsaved' | 'saving' | 'saved';
  saveWarning: string | null;
  saveRuntimeSettings: StorySaveRuntimeSettings;
  lastPublishResult: PublishResult | null;
  startStory: (prompt: string, config?: StoryConfig, seed?: StorySeedOptions) => Promise<void>;
  continueAsEpisode: (premise: string, seed: EpisodeContinuationSeed) => Promise<void>;
  startReel: (prompt: string, config?: StoryConfig) => Promise<void>;
  continueStory: (optionId: string) => Promise<void>;
  navigateToNode: (nodeId: string) => void;
  resetStory: () => void;
  restartExploration: () => void;
  setLoadingClues: (clues: string[]) => void;
  generateNarrationForNode: (nodeId: string) => Promise<void>;
  updateStoryboardNarrationTiming: (
    nodeId: string,
    timing: StoryBeat['storyboardNarrationTiming'] | null
  ) => Promise<void>;
  updateReelPanelCaptions: (nodeId: string, panelTexts: string[]) => Promise<{
    clearedNarration: boolean;
    deletedPreviewIds: string[];
  }>;
  updateReelNarrationSettings: (
    settings: ReelNarrationSettings,
    options?: { preserveExistingNarration?: boolean }
  ) => Promise<{ clearedNarration: boolean }>;
  updateReelTextOverlaySettings: (settings: { enabled: boolean; style: StoryBeat['reelTextOverlayStyle'] }) => Promise<void>;
  updateReelTextOverlayStyle: (style: StoryBeat['reelTextOverlayStyle']) => Promise<void>;
  updateStoryTextOverlaySettings: (settings: {
    enabled: boolean;
    mode: NonNullable<StoryBeat['storyTextOverlayMode']>;
    style: StoryBeat['storyTextOverlayStyle'];
  }) => Promise<void>;
  updateStoryTransitionSettings: (settings: StoryTransitionSettings) => Promise<void>;
  updateStoryEffects: (nodeId: string, config: StoryEffectConfig) => Promise<void>;
  applyStoryEffectsToAll: (config: StoryEffectConfig) => Promise<number>;
  generateStoryTextOverlayForNode: (
    nodeId: string,
    settings: {
      enabled: boolean;
      mode: NonNullable<StoryBeat['storyTextOverlayMode']>;
      style: StoryBeat['storyTextOverlayStyle'];
    }
  ) => Promise<StoryTextOverlayBeatGenerationResult>;
  generateStoryTextOverlayForCurrentPath: (
    settings: {
      enabled: boolean;
      mode: NonNullable<StoryBeat['storyTextOverlayMode']>;
      style: StoryBeat['storyTextOverlayStyle'];
    }
  ) => Promise<StoryTextOverlayStoryGenerationResult>;
  updateReelTransitionSettings: (settings: ReelTransitionSettings) => Promise<void>;
  regenerateImageForNode: (nodeId: string, regenOptions?: BeatImageRegenerationOptions) => Promise<void>;
  beatControlSettings: BeatControlRuntimeSettings;
  loadBeatControlSettings: () => Promise<void>;
  characterUniverseSettings: CharacterUniverseRuntimeSettings;
  loadCharacterUniverseSettings: () => Promise<void>;
  applyTimelineRewrite: (nodeId: string, newText: string) => void;
  editBeatTextForNode: (nodeId: string, newText: string, confirmTimelineRewrite?: boolean) => Promise<EditBeatTextResult>;
  regenerateOptionsForNode: (nodeId: string, confirmTimelineRewrite?: boolean) => Promise<RegenerateBeatOptionsResult>;
  addCustomOptionForNode: (nodeId: string, optionText: string) => Promise<AddCustomOptionResult>;
  restoreImageVersionForNode: (nodeId: string, storageKey: string) => Promise<RestoreBeatImageVersionResult>;
  submitImageBatch: (scope?: ImageBatchScope) => Promise<void>;
  submitStatefulVisuals: (scope?: ImageBatchScope) => Promise<void>;
  generateNarrationBatch: () => Promise<void>;
  reconcileCurrentStoryBatch: () => Promise<void>;
  generateAutomatedStory: (prompt: string, config?: StoryConfig) => Promise<void>;
  clearAudioReady: () => void;
  toggleStoryMode: () => void;
  setSaveRuntimeSettings: (settings: Partial<StorySaveRuntimeSettings>) => void;
  saveStoryToCloud: (userId: string, options?: SaveStoryToCloudOptions) => Promise<void>;
  saveStoryToCloudImmediate: (userId: string, options?: SaveStoryToCloudOptions) => Promise<void>;
  loadStoryFromCloud: (storyId: string) => Promise<void>;
  refreshBatchImages: (storyId: string) => Promise<void>;
  exploreStoryTree: (storyId: string) => Promise<void>;
  refreshSignedUrls: () => Promise<boolean>;
  retryPendingBeatAssetSync: () => Promise<void>;
  setPromptOnlyBeatImage: (nodeId: string, imageDataUrl: string, options?: { uploadBody?: StorageUploadBody; maxImagesPerBeat?: number; optimizationMetadata?: ImageCompressionMetadata; storageExtension?: string }) => Promise<void>;
  selectPromptOnlyBeatImage: (nodeId: string, storageKey: string) => Promise<void>;
  deletePromptOnlyBeatImage: (nodeId: string) => Promise<void>;
  permanentlyDeletePromptOnlyBeatImage: (nodeId: string, storageKey: string) => Promise<void>;
  setCharacterReferenceSheet: (characterId: string, imageDataUrl: string, options?: { uploadBody?: StorageUploadBody; maxPerCharacter?: number; optimizationMetadata?: ImageCompressionMetadata; storageExtension?: string }) => Promise<void>;
  selectCharacterReferenceSheet: (characterId: string, storageKey: string) => Promise<void>;
  deleteCharacterReferenceSheet: (characterId: string) => Promise<void>;
  permanentlyDeleteCharacterReferenceSheet: (characterId: string, storageKey: string) => Promise<void>;
  clearPublishResult: () => void;
  clearError: () => void;
}

// Pack 2: optional seed for startStory — pre-carried characters (episodes,
// library mixing) and the episode series context injected into generation.
export interface StorySeedOptions {
  seedCharacters?: Character[];
  episodeContext?: EpisodeSessionContext;
}

interface SaveStoryToCloudOptions {
  signedUrlSwapEnabled?: boolean;
  incrementalAssetSyncEnabled?: boolean;
  pauseAssetUploadsDuringGenerationEnabled?: boolean;
  assetSyncWarningTimeoutMs?: number;
}

function deriveSessionFields(session: StorySession, storyMap: StoryMap): StorySession {
  const currentNode = getCurrentNode(storyMap);
  const beats = getBeatsToNode(storyMap, storyMap.currentNodeId);
  const choiceHistory = getChoiceHistoryToNode(storyMap, storyMap.currentNodeId);
  const storyConfig = normalizeStoryConfig(session.storyConfig);
  return {
    ...session,
    storyConfig,
    visualStyle: session.visualStyle || deriveVisualStyleSummary(storyConfig.visualSettings),
    storyMap,
    beats,
    choiceHistory,
    currentBeat: currentNode.data.beatNumber,
    characters: buildCharacterRegistry(beats, session.characters),
    openThreads: deriveOpenThreads(beats),
    status: currentNode.data.isEnding ? 'completed' : 'active',
  };
}

function buildCharacterRegistry(beats: StoryBeat[], fallbackCharacters: Character[]): Character[] {
  const registry = new Map<string, Character>();

  for (const beat of beats) {
    for (const character of beat.characters) {
      const existing = registry.get(character.id);
      registry.set(character.id, {
        ...existing,
        ...character,
        portraitBase64: character.portraitBase64 || existing?.portraitBase64,
        portraitUrl: character.portraitUrl || existing?.portraitUrl,
      });
    }
  }

  for (const character of fallbackCharacters) {
    const existing = registry.get(character.id);
    if (!existing) {
      registry.set(character.id, character);
      continue;
    }

    registry.set(character.id, {
      ...character,
      ...existing,
      portraitBase64: existing.portraitBase64 || character.portraitBase64,
      portraitUrl: existing.portraitUrl || character.portraitUrl,
      referenceSheetUrl: character.referenceSheetUrl || existing.referenceSheetUrl,
      referenceSheetStorageKey: character.referenceSheetStorageKey || existing.referenceSheetStorageKey,
      referenceSheetUploadedAt: character.referenceSheetUploadedAt || existing.referenceSheetUploadedAt,
      referenceSheetGallery: character.referenceSheetGallery ?? existing.referenceSheetGallery,
    });
  }

  return Array.from(registry.values());
}

function deriveOpenThreads(beats: StoryBeat[]): string[] {
  const threads = beats
    .filter((beat) => !beat.isEnding)
    .flatMap((beat) => [beat.nextBeatGoal, ...(beat.continuityNotes || [])])
    .map((entry) => entry.trim())
    .filter(Boolean);

  return Array.from(new Set(threads)).slice(-6);
}

function sanitizeCharactersForPersistence(characters: Character[]): Character[] {
  return characters.map((character) => ({
    ...character,
    portraitBase64: undefined,
  }));
}

function buildPersistableSessionSnapshot(
  session: StorySession,
  storyMap: StoryMap,
  overrides: Partial<StorySession> = {}
): StorySession {
  return {
    ...session,
    ...overrides,
    characters: sanitizeCharactersForPersistence(overrides.characters || session.characters),
    beats: [],
    storyMap,
  };
}

function buildSessionContextToNode(session: StorySession, nodeId: string | null): Partial<StorySession> {
  const beats = nodeId ? getBeatsToNode(session.storyMap, nodeId) : [];
  const choiceHistory = nodeId ? getChoiceHistoryToNode(session.storyMap, nodeId) : [];
  const storyConfig = normalizeStoryConfig(session.storyConfig);

  return {
    ...session,
    storyConfig,
    beats,
    choiceHistory,
    currentBeat: beats.length > 0 ? beats[beats.length - 1].beatNumber : 0,
    characters: buildCharacterRegistry(beats, session.characters),
    openThreads: deriveOpenThreads(beats),
    status: beats.length > 0 && beats[beats.length - 1].isEnding ? 'completed' : 'active',
  };
}

function stripSessionForPrompt(session: Partial<StorySession>): Partial<StorySession> {
  const stripped = { ...session } as Partial<StorySession> & {
    storyMap?: StoryMap;
    narratorVoice?: string;
    narrationVoiceMode?: string;
    narrationVoiceGenderBucket?: string;
    narrationLanguageCode?: string;
  };
  delete stripped.storyMap;
  delete stripped.narratorVoice;
  delete stripped.narrationVoiceMode;
  delete stripped.narrationVoiceGenderBucket;
  delete stripped.narrationLanguageCode;
  return stripped;
}

function buildReferenceFromValue(
  type: ReferenceImage['type'],
  value: string | undefined
): ReferenceImage | null {
  if (!value) return null;
  if (value.startsWith('data:')) {
    return { type, dataUrl: value };
  }
  return { type, url: value };
}

function collectPortraitReferences(characters: Character[]): ReferenceImage[] {
  return characters
    .map((character) => {
      const fallbackSheet = pickFallbackGalleryEntry(character.referenceSheetGallery ?? []);
      return buildReferenceFromValue(
        'character',
        character.portraitBase64
          || character.portraitUrl
          || character.referenceSheetUrl
          || fallbackSheet?.url
      );
    })
    .filter((reference): reference is ReferenceImage => Boolean(reference));
}

function mergeCharacterVisualReferences(
  beat: StoryBeat,
  referenceCharacters: Character[]
): StoryBeat {
  if (!referenceCharacters.length || !beat.characters.length) {
    return beat;
  }

  const referencesById = new Map(referenceCharacters.map((character) => [character.id, character]));
  // Pack 2 fallback: seeded characters (episode carry / library mixing) keep
  // their ids in castRegistry, but the LLM may still mint new ids on beat 1 —
  // matching by normalized name re-attaches the carried visuals and links.
  const referencesByName = new Map(
    referenceCharacters
      .filter((character) => character.name?.trim())
      .map((character) => [character.name.trim().toLowerCase(), character])
  );
  const nextCharacters = beat.characters.map((character) => {
    const reference =
      referencesById.get(character.id) ??
      referencesByName.get(character.name?.trim().toLowerCase() ?? '');
    if (!reference) {
      return character;
    }

    return {
      ...reference,
      ...character,
      portraitBase64: character.portraitBase64 || reference.portraitBase64,
      portraitUrl: character.portraitUrl || reference.portraitUrl,
      referenceSheetUrl: character.referenceSheetUrl || reference.referenceSheetUrl,
      referenceSheetStorageKey: character.referenceSheetStorageKey || reference.referenceSheetStorageKey,
      referenceSheetUploadedAt: character.referenceSheetUploadedAt || reference.referenceSheetUploadedAt,
      referenceSheetGallery: character.referenceSheetGallery ?? reference.referenceSheetGallery,
    };
  });

  return {
    ...beat,
    characters: nextCharacters,
  };
}

function collectBeatPortraitReferences(beat: StoryBeat): ReferenceImage[] {
  return collectPortraitReferences(beat.characters);
}

/**
 * Reference Personalization: resolve the world reference relevant to this beat.
 * Returns the compact anchor (for the image prompt) and, when the world has a
 * canonical visualization, a scene reference image. Characters route themselves
 * via the roster; only worlds need this selection. The world image is appended
 * AFTER character refs so characters keep priority under a provider's input cap.
 */
function resolveBeatWorldRouting(
  session: StorySession | null | undefined,
  beat: StoryBeat
): { worldAnchor?: string; worldReferenceImage?: ReferenceImage } {
  const worlds = session?.storyConfig?.references?.worlds;
  if (!worlds || worlds.length === 0) return {};
  const beatText = `${beat.title ?? ''} ${beat.sceneSummary ?? ''} ${beat.imagePrompt ?? ''}`;
  const selected = selectRelevantWorld(worlds, beatText, null);
  if (!selected) return {};
  const routing: { worldAnchor?: string; worldReferenceImage?: ReferenceImage } = {};
  if (selected.anchor.trim().length > 0) routing.worldAnchor = selected.anchor;
  if (selected.adoptionMode === 'description_plus_canonical_visual' && selected.canonicalStorageKey) {
    routing.worldReferenceImage = { type: 'scene', url: selected.canonicalStorageKey };
  }
  return routing;
}

function buildStoryboardReferenceImages(
  beat: StoryBeat,
  previousStoryboardUrl?: string,
  portraitReferences: ReferenceImage[] = []
): ReferenceImage[] {
  if (beat.beatNumber === 1) {
    return portraitReferences;
  }

  const references: ReferenceImage[] = [];
  references.push(...portraitReferences);
  const sceneReference = buildReferenceFromValue('scene', previousStoryboardUrl);
  if (sceneReference) {
    references.push(sceneReference);
  }
  return references;
}

function referenceKey(reference: ReferenceImage): string {
  return `${reference.type}:${reference.url || reference.dataUrl || ''}`;
}

function mergeReferenceImages(...groups: ReferenceImage[][]): ReferenceImage[] {
  const seen = new Set<string>();
  const merged: ReferenceImage[] = [];
  for (const group of groups) {
    for (const reference of group) {
      const key = referenceKey(reference);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(reference);
    }
  }
  return merged;
}

function imageContinuityOptions(
  storyConfig: StoryConfig,
  previousState?: ImageContinuityProviderState | null,
  strategyOverride?: ImageContinuityStrategy
) {
  return {
    requestedStrategy: strategyOverride ?? storyConfig.imageContinuityStrategy,
    previousState: previousState ?? null,
    allowRuntimeFallback: true,
  };
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

async function measureAsyncStep<T>(
  steps: GenerationTimingStep[],
  key: string,
  label: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>
): Promise<T> {
  const startedAt = nowMs();
  try {
    return await fn();
  } finally {
    steps.push({
      key,
      label,
      durationMs: Math.round(nowMs() - startedAt),
      ...(meta ? { meta } : {}),
    });
  }
}

function logGenerationTiming(summary: GenerationTimingSummary) {
  console.info(`[timing:${summary.scope}]`, summary);
}

const SIGNED_ASSET_PRELOAD_TIMEOUT_MS = 4000;
const LONG_SAVE_RETRY_MESSAGE = 'Cloud save is taking longer than usual. A retry is queued.';
const ASSET_SYNC_PENDING_MESSAGE = 'Beat media is syncing in the background.';
const ASSET_SYNC_FAILED_MESSAGE = 'A beat image still needs upload. Tap to retry.';
const ASSET_SYNC_REPAIR_MESSAGE = 'A beat image still needs repair. Tap to retry.';
const BEAT_IMAGE_RETRY_BACKOFF_MS = [10_000, 30_000, 60_000] as const;

// Transient/benign save-status notices that surface on the `error` channel but do
// not represent a real generation failure. The automated batch walk must not treat
// these as fatal — the store already queues and retries these saves on its own.
const BENIGN_SAVE_STATUS_MESSAGES = new Set<string>([
  LONG_SAVE_RETRY_MESSAGE,
  ASSET_SYNC_PENDING_MESSAGE,
  ASSET_SYNC_FAILED_MESSAGE,
  ASSET_SYNC_REPAIR_MESSAGE,
]);

// Whether an `error` value should abort the automated batch walk. Only genuine
// generation/billing failures are fatal; a queued-save notice is not.
function isWalkFatalError(error: string | null | undefined): boolean {
  return !!error && !BENIGN_SAVE_STATUS_MESSAGES.has(error);
}
const DEFAULT_STORY_SAVE_RUNTIME_SETTINGS: StorySaveRuntimeSettings = {
  storyAssetSignedUrlSwapEnabled: false,
  storyIncrementalAssetSyncEnabled: false,
  storyAssetUploadPauseDuringGenerationEnabled: false,
  storyAssetSyncWarningTimeoutMs: 15_000,
};

let activeSavePromise: Promise<void> | null = null;
let queuedSaveRequest: { userId: string; options?: SaveStoryToCloudOptions } | null = null;
let activeBeatAssetSyncPromise: Promise<void> | null = null;
const queuedBeatAssetSyncStoryIds = new Set<string>();
// Poll cadence for server-pipeline image jobs while the tab stays open. The
// jobs are durable server-side; polling only refreshes the visible session.
const IMAGE_JOB_POLL_INTERVAL_MS = 8_000;
let imageJobPollTimer: ReturnType<typeof setTimeout> | null = null;
let imageJobPollStoryId: string | null = null;
const beatAssetRetryTimers = new Map<string, number>();
let cachedStorySaveRuntimeSettings = DEFAULT_STORY_SAVE_RUNTIME_SETTINGS;
let cachedStorySaveRuntimeSettingsHydrated = false;

function isDataUrl(value: string | undefined): boolean {
  return !!value && value.startsWith('data:');
}

function preloadImageUrl(url: string, timeoutMs = SIGNED_ASSET_PRELOAD_TIMEOUT_MS): Promise<boolean> {
  if (typeof Image === 'undefined') {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);

    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(ok);
    };

    img.onload = () => settle(true);
    img.onerror = () => settle(false);
    img.src = url;
  });
}

async function buildPreloadedSignedAssetMap(
  storyMap: StoryMap,
  signedAssetMap: NodeAssetUrlMap
): Promise<NodeAssetUrlMap> {
  const entries = await Promise.all(
    Object.entries(signedAssetMap).map(async ([nodeId, urls]) => {
      const node = storyMap.nodes[nodeId];
      const nextUrls: { imageUrl?: string; audioUrl?: string } = {};

      if (urls.audioUrl) {
        nextUrls.audioUrl = urls.audioUrl;
      }

      if (urls.imageUrl) {
        const shouldPreload = isDataUrl(node?.data.imageUrl);
        const imageReady = shouldPreload
          ? await preloadImageUrl(urls.imageUrl)
          : true;
        if (imageReady) {
          nextUrls.imageUrl = urls.imageUrl;
        }
      }

      return [nodeId, nextUrls] as const;
    })
  );

  return entries.reduce<NodeAssetUrlMap>((acc, [nodeId, urls]) => {
    if (urls.imageUrl || urls.audioUrl) {
      acc[nodeId] = urls;
    }
    return acc;
  }, {});
}

async function resolveSignedUrlSwapEnabled(optionValue?: boolean): Promise<boolean> {
  if (typeof optionValue === 'boolean') {
    return optionValue;
  }

  try {
    return await getStoryAssetSignedUrlSwapEnabled();
  } catch {
    return false;
  }
}

function extractStorySaveRuntimeSettings(
  settings: Awaited<ReturnType<typeof getStoryboardSettings>>
): StorySaveRuntimeSettings {
  return {
    storyAssetSignedUrlSwapEnabled: settings.storyAssetSignedUrlSwapEnabled,
    storyIncrementalAssetSyncEnabled: settings.storyIncrementalAssetSyncEnabled,
    storyAssetUploadPauseDuringGenerationEnabled: settings.storyAssetUploadPauseDuringGenerationEnabled,
    storyAssetSyncWarningTimeoutMs: settings.storyAssetSyncWarningTimeoutMs,
  };
}

function mergeSaveRuntimeOverrides(options: SaveStoryToCloudOptions = {}): Partial<StorySaveRuntimeSettings> {
  return {
    ...(typeof options.signedUrlSwapEnabled === 'boolean'
      ? { storyAssetSignedUrlSwapEnabled: options.signedUrlSwapEnabled }
      : {}),
    ...(typeof options.incrementalAssetSyncEnabled === 'boolean'
      ? { storyIncrementalAssetSyncEnabled: options.incrementalAssetSyncEnabled }
      : {}),
    ...(typeof options.pauseAssetUploadsDuringGenerationEnabled === 'boolean'
      ? { storyAssetUploadPauseDuringGenerationEnabled: options.pauseAssetUploadsDuringGenerationEnabled }
      : {}),
    ...(typeof options.assetSyncWarningTimeoutMs === 'number'
      ? { storyAssetSyncWarningTimeoutMs: options.assetSyncWarningTimeoutMs }
      : {}),
  };
}

function cacheStorySaveRuntimeSettings(settings: Partial<StorySaveRuntimeSettings>) {
  cachedStorySaveRuntimeSettings = {
    ...cachedStorySaveRuntimeSettings,
    ...settings,
  };
  cachedStorySaveRuntimeSettingsHydrated = true;
}

async function resolveStorySaveRuntimeSettings(
  current: StorySaveRuntimeSettings,
  options: SaveStoryToCloudOptions = {}
): Promise<StorySaveRuntimeSettings> {
  if (!cachedStorySaveRuntimeSettingsHydrated) {
    try {
      const settings = await getStoryboardSettings();
      cacheStorySaveRuntimeSettings(extractStorySaveRuntimeSettings(settings));
    } catch {
      try {
        cacheStorySaveRuntimeSettings({
          storyAssetSignedUrlSwapEnabled: await getStoryAssetSignedUrlSwapEnabled(),
        });
      } catch {
        // Fall back to defaults already in cache.
      }
    }
  }

  return {
    ...cachedStorySaveRuntimeSettings,
    ...current,
    ...mergeSaveRuntimeOverrides(options),
  };
}

function updateStoryMapBeat(
  storyMap: StoryMap,
  nodeId: string,
  updater: (beat: StoryBeat) => StoryBeat
): StoryMap {
  const node = storyMap.nodes[nodeId];
  if (!node) {
    return storyMap;
  }

  return {
    ...storyMap,
    nodes: {
      ...storyMap.nodes,
      [nodeId]: {
        ...node,
        data: normalizeBeatMediaFields(updater(node.data)),
      },
    },
  };
}

function updateSessionBeat(
  session: StorySession,
  nodeId: string,
  updater: (beat: StoryBeat) => StoryBeat
): StorySession {
  return deriveSessionFields(session, updateStoryMapBeat(session.storyMap, nodeId, updater));
}

function slugifyCharacterName(name: string): string {
  const trimmed = (name || '').toLowerCase().trim();
  const slug = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'character';
}

function formatCharacterSheetTimestamp(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return 'unknown-date';
  }
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace('T', '_').replace(/:/g, '-');
}

function applyCharacterPatchEverywhere(
  session: StorySession,
  characterId: string,
  patcher: (character: Character) => Character,
  options: { includeGallery?: boolean } = { includeGallery: true }
): StorySession {
  const includeGallery = options.includeGallery ?? true;

  const nextCharacters = (session.characters ?? []).map((character) =>
    character.id === characterId ? patcher(character) : character
  );

  const nextNodes: StoryMap['nodes'] = {};
  for (const [id, node] of Object.entries(session.storyMap.nodes)) {
    const beatCharacters = node.data.characters ?? [];
    let touched = false;
    const patchedBeatCharacters = beatCharacters.map((character) => {
      if (character.id !== characterId) return character;
      touched = true;
      const patched = patcher(character);
      if (!includeGallery) {
        // Strip the gallery from beat-level character snapshots — it's stored
        // canonically on session.characters only.
        const { referenceSheetGallery: _gallery, ...rest } = patched;
        void _gallery;
        return rest as Character;
      }
      return patched;
    });
    nextNodes[id] = touched
      ? {
          ...node,
          data: {
            ...node.data,
            characters: patchedBeatCharacters,
          },
        }
      : node;
  }

  return deriveSessionFields(
    { ...session, characters: nextCharacters },
    { ...session.storyMap, nodes: nextNodes }
  );
}

function findCharacterAcrossSession(
  session: StorySession,
  characterId: string
): Character | undefined {
  const fromRoster = session.characters?.find((c) => c.id === characterId);
  if (fromRoster) return fromRoster;
  for (const node of Object.values(session.storyMap.nodes)) {
    const fromBeat = node.data.characters?.find((c) => c.id === characterId);
    if (fromBeat) return fromBeat;
  }
  return undefined;
}

function clearCharacterActiveSheetFields(character: Character): Character {
  const next = { ...character };
  delete next.referenceSheetUrl;
  delete next.referenceSheetStorageKey;
  delete next.referenceSheetUploadedAt;
  return next;
}

function pickFallbackGalleryEntry(
  entries: CharacterSheetGalleryEntry[]
): CharacterSheetGalleryEntry | undefined {
  if (entries.length === 0) return undefined;
  return [...entries].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
}

function shouldStageBeatImage(beat: StoryBeat): boolean {
  return isDataUrl(beat.imageUrl) && (beat.imageStatus !== 'ready' || !getBeatPersistedImageUrl(beat));
}

function hasPersistedReadyImage(beat: StoryBeat | undefined): boolean {
  if (!beat) {
    return false;
  }

  const normalizedBeat = normalizeBeatMediaFields(beat);
  return normalizedBeat.imageStatus === 'ready' && Boolean(getBeatPersistedImageUrl(normalizedBeat));
}

function markUploadedAssetStatusesReady(storyMap: StoryMap, assetMap: NodeAssetUrlMap): StoryMap {
  return Object.entries(assetMap).reduce((nextMap, [nodeId, urls]) => {
    if (!nextMap.nodes[nodeId]) {
      return nextMap;
    }

    return updateStoryMapBeat(nextMap, nodeId, (beat) => ({
      ...beat,
      ...(urls.imageUrl ? { imageStatus: 'ready', imageError: undefined, persistedImageUrl: urls.imageUrl } : {}),
      ...(urls.audioUrl ? { audioStatus: 'ready', audioError: undefined } : {}),
    }));
  }, storyMap);
}

function getStoryMapImageSyncSummary(storyMap: StoryMap | null | undefined): {
  pendingCount: number;
  failedCount: number;
  impossibleCount: number;
} {
  if (!storyMap) {
    return { pendingCount: 0, failedCount: 0, impossibleCount: 0 };
  }

  return Object.values(storyMap.nodes).reduce(
    (summary, node) => {
      const normalizedBeat = normalizeBeatMediaFields(node.data);
      if (hasBeatImpossibleImageState(normalizedBeat)) {
        summary.impossibleCount += 1;
      } else if (normalizedBeat.imageStatus === 'failed') {
        summary.failedCount += 1;
      } else if (normalizedBeat.imageStatus === 'pending') {
        summary.pendingCount += 1;
      }
      return summary;
    },
    { pendingCount: 0, failedCount: 0, impossibleCount: 0 }
  );
}

function deriveSaveWarning(
  storyMap: StoryMap | null | undefined,
  queueActive: boolean,
  storyConfig?: StoryConfig | null
): string | null {
  if (storyConfig && isPromptOnlyStoryConfig(storyConfig)) {
    return null;
  }
  const { failedCount, pendingCount, impossibleCount } = getStoryMapImageSyncSummary(storyMap);
  if (impossibleCount > 0) {
    return ASSET_SYNC_REPAIR_MESSAGE;
  }
  if (failedCount > 0) {
    return ASSET_SYNC_FAILED_MESSAGE;
  }
  if (pendingCount > 0 && !queueActive) {
    return ASSET_SYNC_PENDING_MESSAGE;
  }
  return null;
}

function syncSaveUiState(
  setState: (partial: Partial<StoryState>) => void,
  getState: () => StoryState,
  partial: Partial<StoryState> = {}
) {
  const current = getState();
  const nextSession = partial.session === undefined ? current.session : partial.session;
  const nextIsSaving = partial.isSaving === undefined ? current.isSaving : partial.isSaving;
  // saveStatus reflects ONLY user-facing saves (driven by isSaving). The
  // activeBeatAssetSyncPromise is a background-queue coordination flag and
  // must not flip the UI into 'saving' — doing so trips the cloud-save
  // recovery guard, which fires a phantom save 20 s later for stories that
  // are already up-to-date. saveWarning still consults the queue so that
  // pending uploads can surface their own message.
  const nextSaveStatus = partial.saveStatus ?? (
    nextSession ? (nextIsSaving ? 'saving' : 'saved') : 'idle'
  );
  const nextSaveWarning = partial.saveWarning === undefined
    ? (nextSaveStatus === 'unsaved' ? null : deriveSaveWarning(nextSession?.storyMap, Boolean(activeBeatAssetSyncPromise), nextSession?.storyConfig))
    : partial.saveWarning;

  setState({
    ...partial,
    saveStatus: nextSaveStatus,
    saveWarning: nextSaveWarning,
  });
}

// Admin-tuned model overrides and the image processing mode change rarely and
// are already cached ~60s server-side; caching them client-side too saves one
// round-trip per beat. 60s keeps parity with the server cache window.
const GENERATION_SETTINGS_CACHE_TTL_MS = 60_000;

let cachedModelOverrides: { data: StoryModelOverrides; fetchedAtMs: number } | null = null;
let cachedImageProcessingMode: { data: 'client_legacy' | 'server_pipeline'; fetchedAtMs: number } | null = null;

async function getStoryModelOverridesCached(): Promise<StoryModelOverrides> {
  if (cachedModelOverrides && Date.now() - cachedModelOverrides.fetchedAtMs < GENERATION_SETTINGS_CACHE_TTL_MS) {
    return cachedModelOverrides.data;
  }

  const data = await getStoryModelOverrides();
  cachedModelOverrides = { data, fetchedAtMs: Date.now() };
  return data;
}

async function resolveImageProcessingModeCached(): Promise<'client_legacy' | 'server_pipeline'> {
  if (cachedImageProcessingMode && Date.now() - cachedImageProcessingMode.fetchedAtMs < GENERATION_SETTINGS_CACHE_TTL_MS) {
    return cachedImageProcessingMode.data;
  }

  const data = await resolveImageProcessingModeAction();
  cachedImageProcessingMode = { data, fetchedAtMs: Date.now() };
  return data;
}

let cachedBeatGenerationMode: { data: 'legacy' | 'bundle'; fetchedAtMs: number } | null = null;

async function resolveBeatGenerationModeCached(): Promise<'legacy' | 'bundle'> {
  if (cachedBeatGenerationMode && Date.now() - cachedBeatGenerationMode.fetchedAtMs < GENERATION_SETTINGS_CACHE_TTL_MS) {
    return cachedBeatGenerationMode.data;
  }

  const data = await resolveBeatGenerationModeAction();
  cachedBeatGenerationMode = { data, fetchedAtMs: Date.now() };
  return data;
}

async function releaseBundleReservation(reservationId: string | null, reason: string): Promise<void> {
  if (!reservationId) return;
  try {
    await releaseCurrentUserBillableAction({ reservationId, reason });
  } catch (error) {
    console.error('Failed to release beat-bundle reservation:', error);
  }
}

async function resolveCurrentUserId(fallbackUserId?: string): Promise<string | null> {
  if (fallbackUserId) {
    return fallbackUserId;
  }

  try {
    const supabase = createBrowserClient();
    // The id here only tags recovery/cost rows (server actions re-check auth),
    // so the locally cached session is enough — avoid the getUser network hop.
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      return session.user.id;
    }

    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

function getPendingBeatImageTimerKey(storyId: string, nodeId: string): string {
  return `${storyId}:${nodeId}`;
}

function clearPendingBeatImageRetry(storyId: string, nodeId: string) {
  const key = getPendingBeatImageTimerKey(storyId, nodeId);
  const timer = beatAssetRetryTimers.get(key);
  if (timer) {
    window.clearTimeout(timer);
    beatAssetRetryTimers.delete(key);
  }
}

function schedulePendingBeatImageRetry(
  storyId: string,
  nodeId: string,
  delayMs: number,
  callback: () => void
) {
  if (typeof window === 'undefined') {
    return;
  }

  clearPendingBeatImageRetry(storyId, nodeId);
  const key = getPendingBeatImageTimerKey(storyId, nodeId);
  const timer = window.setTimeout(() => {
    beatAssetRetryTimers.delete(key);
    callback();
  }, delayMs);
  beatAssetRetryTimers.set(key, timer);
}

async function stagePendingBeatImagesForSession(
  session: StorySession,
  userId: string,
  storyId: string
): Promise<string[]> {
  const stagedNodeIds: string[] = [];

  for (const [nodeId, node] of Object.entries(session.storyMap.nodes)) {
    if (!shouldStageBeatImage(node.data) || !node.data.imageUrl) {
      continue;
    }

    await putPendingBeatImage({
      storyId,
      userId,
      nodeId,
      imageDataUrl: node.data.imageUrl,
    });
    stagedNodeIds.push(nodeId);
  }

  return stagedNodeIds;
}

type RecoverableGeneratedImageResult = {
  imageUrl?: string;
  imageGenerationMetadata?: Record<string, unknown>;
};

async function stageGeneratedBeatImageForLocalRecovery(input: {
  storyId?: string | null;
  userId?: string | null;
  nodeId: string;
  imageResult: RecoverableGeneratedImageResult;
}): Promise<boolean> {
  const imageUrl = input.imageResult.imageUrl;
  if (
    !input.storyId
    || !input.userId
    || !imageUrl
    || !isDataUrl(imageUrl)
    || input.imageResult.imageGenerationMetadata?.placeholder
  ) {
    return false;
  }

  try {
    await putPendingBeatImage({
      storyId: input.storyId,
      userId: input.userId,
      nodeId: input.nodeId,
      imageDataUrl: imageUrl,
    });
    return true;
  } catch (error) {
    console.error('Failed to stage generated beat image for local recovery:', error);
    return false;
  }
}

async function overlayPendingBeatImages(
  storyMap: StoryMap,
  storyId: string
): Promise<StoryMap> {
  const pendingImages = await listPendingBeatImagesForStory(storyId);
  if (pendingImages.length === 0) {
    return storyMap;
  }

  let nextMap = storyMap;

  for (const record of pendingImages) {
    const node = nextMap.nodes[record.nodeId];
    if (!node) {
      await deletePendingBeatImage(storyId, record.nodeId, record.updatedAt);
      continue;
    }

    if (hasPersistedReadyImage(node.data)) {
      await deletePendingBeatImage(storyId, record.nodeId, record.updatedAt);
      continue;
    }

    nextMap = updateStoryMapBeat(nextMap, record.nodeId, (beat) => ({
      ...beat,
      imageUrl: record.imageDataUrl,
    }));
  }

  return nextMap;
}

async function uploadBeatPortraits(
  userId: string,
  storyId: string,
  nodeId: string,
  characters: Character[]
): Promise<Character[]> {
  return Promise.all(
    characters.map(async (character) => {
      if (!isDataUrl(character.portraitBase64)) {
        return character;
      }
      const portraitBase64 = character.portraitBase64;
      if (!portraitBase64) {
        return character;
      }

      try {
        const portraitUrl = await uploadAsset(
          'story-assets',
          `stories/${storyId}/beats/${nodeId}/portrait_${character.id}.webp`,
          portraitBase64,
          {
            access: 'private',
            assetType: 'portrait',
            storyId,
            nodeId,
            objectKey: `stories/${storyId}/beats/${nodeId}/portrait_${character.id}.webp`,
            fallbackPath: `${userId}/${storyId}/${nodeId}/portrait_${character.id}.webp`,
          }
        );

        return {
          ...character,
          portraitUrl,
          portraitBase64: undefined,
        };
      } catch (error) {
        console.error(`Failed to upload portrait for ${character.id}:`, error);
        return character;
      }
    })
  );
}

function setLoadingStage(
  setState: (partial: Partial<StoryState>) => void,
  flow: StoryLoadingFlow,
  step: StoryLoadingStage['currentStepKey'],
  opts?: { deferImages?: boolean; note?: string }
) {
  setState({
    loadingStage: createStoryLoadingStage(flow, step, opts),
  });
}

/** Preloader reassurance shown once the beat + image job are durable server-side. */
const IMAGE_JOB_SAFE_TO_LEAVE_NOTE =
  'Your beat is saved and the image is being painted on our servers — you can '
  + 'close this tab or come back later and it will be ready here.';

const IMAGE_JOB_FOREGROUND_WAIT_MS = 150_000;
const IMAGE_JOB_FOREGROUND_POLL_MS = 4_000;

/**
 * Foreground wait for a queued image job: the user who stays on the preloader
 * should receive the beat *with* its image, exactly like the legacy inline
 * path. Polls the durable beats row (worker-written) until it turns ready or
 * failed; returns null on timeout, leaving the beat in its pending state for
 * the background poller to finish.
 */
async function waitForQueuedBeatImage(
  storyId: string,
  nodeId: string
): Promise<{ imageStatus: 'ready'; imageUrl: string } | { imageStatus: 'failed'; imageError: string | null } | null> {
  const deadline = Date.now() + IMAGE_JOB_FOREGROUND_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, IMAGE_JOB_FOREGROUND_POLL_MS));
    try {
      const [row] = await getReadyBeatImages(storyId, [nodeId]);
      if (row?.imageStatus === 'ready' && row.imageUrl) {
        return { imageStatus: 'ready', imageUrl: row.imageUrl };
      }
      if (row?.imageStatus === 'failed') {
        return { imageStatus: 'failed', imageError: row.imageError };
      }
    } catch {
      // Transient poll failure — keep waiting; the job itself is durable.
    }
  }
  return null;
}

function costPhase(
  context: CostTelemetryContext,
  phase: string,
  metadata?: Record<string, unknown>
): CostTelemetryContext {
  return {
    ...context,
    phase,
    metadata: {
      ...(context.metadata || {}),
      ...(metadata || {}),
    },
  };
}

async function resolveNarratorVoice(session: StorySession, costTelemetry?: CostTelemetryContext) {
  const storyVoiceConfig = session.storyConfig.narrationVoice;
  return resolveNarrationVoiceServer({
    savedStoryId: session.savedStoryId ?? null,
    requestedMode: session.narrationVoiceMode ?? storyVoiceConfig?.mode ?? null,
    requestedVoiceId: session.narratorVoice ?? storyVoiceConfig?.voiceId ?? null,
    requestedGenderBucket: session.narrationVoiceGenderBucket ?? storyVoiceConfig?.genderBucket ?? null,
    requestedAccent: storyVoiceConfig?.accent ?? null,
    language: session.storyConfig.language,
    genre: session.genre,
    tone: session.tone,
    targetAge: session.targetAge,
    costTelemetry,
  });
}

function getHardReservationId(
  authorization: PricingBillableActionAuthorization | null
): string | null {
  return authorization?.status === 'allowed' && authorization.mode === 'hard'
    ? authorization.reservationId
    : null;
}

function getPromptOnlyFallbackActionKey(actionKey: string) {
  switch (actionKey) {
    case 'start_story_initial_beat':
      return 'start_story_initial_beat_prompt_only' as const;
    case 'start_reel_full_generation':
      return 'start_reel_full_generation_prompt_only' as const;
    case 'continue_story_new_beat':
      return 'continue_story_new_beat_prompt_only' as const;
    default:
      return null;
  }
}

async function finalizeImageAwareReservation({
  reservationId,
  actionKey,
  fallbackIdempotencyKey,
  relatedStoryId,
  relatedNodeId,
  storyId,
  relatedEntityId,
  metadata,
  imageResult,
}: {
  reservationId: string;
  actionKey: ReturnType<typeof getStartStoryActionKey> | ReturnType<typeof getContinueStoryActionKey>;
  fallbackIdempotencyKey: string;
  relatedStoryId?: string | null;
  relatedNodeId?: string | null;
  storyId?: string | null;
  relatedEntityId?: string | null;
  metadata: Record<string, unknown>;
  imageResult: {
    imageUrl?: string;
    finalPromptText?: string;
    imageModelSnapshot?: import('@/lib/ai/image-models.shared').ImageModelSnapshot;
    imageGenerationMetadata?: Record<string, unknown>;
  };
}) {
  const placeholder = Boolean(imageResult.imageGenerationMetadata?.placeholder);
  const promptOnlyFallbackActionKey = placeholder ? getPromptOnlyFallbackActionKey(actionKey) : null;

  if (promptOnlyFallbackActionKey) {
    await releaseCurrentUserBillableAction({
      reservationId,
      reason: 'image_generation_placeholder',
      releaseStatus: 'released',
      metadata: {
        ...metadata,
        downgradedFromActionKey: actionKey,
        imageGenerationMetadata: imageResult.imageGenerationMetadata ?? null,
      },
    });

    const fallbackAuthorization = await authorizeCurrentUserBillableAction({
      actionKey: promptOnlyFallbackActionKey,
      idempotencyKey: fallbackIdempotencyKey,
      relatedStoryId: relatedStoryId ?? null,
      relatedNodeId: relatedNodeId ?? null,
      metadata: {
        ...metadata,
        downgradedFromActionKey: actionKey,
        billingPolicy: 'prompt_only_fallback_after_image_placeholder',
      },
    });
    const fallbackReservationId = getHardReservationId(fallbackAuthorization);
    if (fallbackReservationId) {
      await finalizeCurrentUserBillableAction({
        reservationId: fallbackReservationId,
        storyId: storyId ?? null,
        relatedEntityId: relatedEntityId ?? null,
        metadata: {
          ...metadata,
          action: promptOnlyFallbackActionKey,
          downgradedFromActionKey: actionKey,
        },
      });
    }
    return;
  }

  await finalizeCurrentUserBillableAction({
    reservationId,
    storyId: storyId ?? null,
    relatedEntityId: relatedEntityId ?? null,
    metadata: {
      ...metadata,
      imageModelSnapshot: imageResult.imageModelSnapshot ?? null,
      imageGenerationMetadata: imageResult.imageGenerationMetadata ?? null,
    },
  });
}

function buildPricingErrorState(
  authorization: PricingBillableActionAuthorization,
  actionLabel: 'start_story' | 'continue_story'
): { error: string; errorAction: StoryErrorAction | null } | null {
  const actionText = actionLabel === 'start_story' ? 'start this story' : 'create a new path';
  return buildPricingErrorStateForAction(authorization, actionText);
}

function buildPricingErrorStateForAction(
  authorization: PricingBillableActionAuthorization,
  actionText: string
): { error: string; errorAction: StoryErrorAction | null } | null {
  if (authorization.status === 'bypassed' || authorization.status === 'allowed') {
    return null;
  }

  if (authorization.reason === 'sign_in_required') {
    return {
      error: 'Sign in to keep creating stories with your coin wallet.',
      errorAction: null,
    };
  }

  const availableCoins = authorization.availableCoins.toLocaleString();

  if (authorization.reason === 'checkout_unavailable') {
    return {
      error: `You need ${authorization.coinCost.toLocaleString()} coins to ${actionText}, and checkout is still closed for this test. You currently have ${availableCoins} coins.`,
      errorAction: {
        label: 'Open Wallet',
        href: '/wallet',
      },
    };
  }

  return {
    error: `You need ${authorization.coinCost.toLocaleString()} coins to ${actionText}. You currently have ${availableCoins} coins.`,
    errorAction: {
      label: 'Open Wallet',
      href: '/wallet',
    },
  };
}

async function generatePortraitsForStoryboardPlan(
  beat: StoryBeat,
  storyboardPlan: StoryboardPlan,
  visualStyle: string,
  portraitReferenceConfig: PortraitReferenceConfig,
  modelOverrides?: StoryModelOverrides,
  costTelemetry?: CostTelemetryContext,
  imageModelSelection?: StoryConfig['imageModelSelection'],
  continuity?: ReturnType<typeof imageContinuityOptions>
): Promise<{ references: ReferenceImage[]; latestState: ImageContinuityProviderState | null }> {
  if (!storyboardPlan.portraitTasks.length) {
    return {
      references: [],
      latestState: continuity?.previousState ?? null,
    };
  }

  const orderedTasks = sortPortraitTasksForGeneration(beat.characters, storyboardPlan.portraitTasks);
  const prioritizedSheetTaskIds = resolvePrioritizedSheetTaskIds(orderedTasks, portraitReferenceConfig);

  const portraits: Array<{
    reference: ReferenceImage;
    metadata: Record<string, unknown>;
    state: ImageContinuityProviderState | null;
  }> = [];
  let latestState = continuity?.previousState ?? null;

  for (const task of orderedTasks) {
    const character = beat.characters.find((candidate) => candidate.id === task.characterId);
    if (!character) {
      continue;
    }

    const taskPortraitReferenceConfig =
      portraitReferenceConfig.mode === 'character_sheet' && prioritizedSheetTaskIds.has(task.characterId)
        ? portraitReferenceConfig
        : {
            mode: 'single_portrait' as const,
            quality: '0.5K' as const,
          };

    try {
      const portraitResult = await generateCharacterPortrait(
        character,
        visualStyle,
        taskPortraitReferenceConfig,
        modelOverrides,
        task.prompt,
        costTelemetry,
        imageModelSelection,
        continuity
          ? {
              ...continuity,
              previousState: latestState,
            }
          : null
      );
      const nextState = extractImageContinuityState(portraitResult.imageGenerationMetadata) ?? latestState;
      latestState = nextState;
      character.portraitBase64 = portraitResult.imageUrl;
      task.finalPromptText = portraitResult.finalPromptText;
      portraits.push({
        reference: { type: 'character' as const, dataUrl: portraitResult.imageUrl },
        state: nextState,
        metadata: {
          characterId: character.id,
          characterName: character.name,
          imageModelSnapshot: portraitResult.imageModelSnapshot,
          imageGenerationMetadata: portraitResult.imageGenerationMetadata,
          statefulContinuity: nextState,
        },
      });
    } catch (error) {
      console.error(`Portrait generation failed for storyboard task ${task.characterId}:`, error);
    }
  }

  if (portraits.length > 0) {
    beat.imageGenerationMetadata = {
      ...(beat.imageGenerationMetadata ?? {}),
      portraitGeneration: {
        count: portraits.length,
        latestState,
        portraits: portraits.map((portrait) => portrait.metadata),
      },
    };
  }

  return {
    references: portraits.map((portrait) => portrait.reference),
    latestState,
  };
}

function assignPortraitPromptTexts(
  beat: StoryBeat,
  storyboardPlan: StoryboardPlan,
  visualStyle: string,
  portraitReferenceConfig: PortraitReferenceConfig,
  modelOverrides?: StoryModelOverrides
) {
  if (!storyboardPlan.portraitTasks.length) {
    return;
  }

  const orderedTasks = sortPortraitTasksForGeneration(beat.characters, storyboardPlan.portraitTasks);
  const prioritizedSheetTaskIds = resolvePrioritizedSheetTaskIds(orderedTasks, portraitReferenceConfig);

  for (const task of orderedTasks) {
    const character = beat.characters.find((candidate) => candidate.id === task.characterId);
    if (!character) {
      continue;
    }

    const taskPortraitReferenceConfig =
      portraitReferenceConfig.mode === 'character_sheet' && prioritizedSheetTaskIds.has(task.characterId)
        ? portraitReferenceConfig
        : {
            mode: 'single_portrait' as const,
            quality: '0.5K' as const,
          };

    task.finalPromptText = buildFinalPortraitPrompt(
      character,
      visualStyle,
      taskPortraitReferenceConfig,
      modelOverrides,
      task.prompt
    );
  }
}

function sortPortraitTasksForGeneration(
  characters: Character[],
  portraitTasks: PortraitTask[]
): PortraitTask[] {
  const characterPriority = new Map(characters.map((character, index) => [character.id, index]));

  return [...portraitTasks].sort((left, right) => {
    const leftPriority = characterPriority.get(left.characterId) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = characterPriority.get(right.characterId) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.characterName.localeCompare(right.characterName);
  });
}

function resolvePrioritizedSheetTaskIds(
  portraitTasks: PortraitTask[],
  portraitReferenceConfig: PortraitReferenceConfig
): Set<string> {
  if (portraitReferenceConfig.mode !== 'character_sheet') {
    return new Set<string>();
  }

  return new Set(portraitTasks.slice(0, 2).map((task) => task.characterId));
}

function isSeededStoryConfig(storyConfig: StoryConfig): boolean {
  return storyConfig.authoring.mode === 'seeded' && Boolean(storyConfig.authoring.seedPlan?.beats.length);
}

function isPromptOnlyStoryConfig(storyConfig: StoryConfig): boolean {
  return storyConfig.imageGenerationMode === 'prompt_only';
}

// Deferred delivery: a "generate" story whose beat images are produced later by a
// background job rather than live during the walk — either the cost-saver provider
// batch ('batch') or the fast stateful sequential job ('stateful'). Non-reel only.
function isBatchImageDeliveryStoryConfig(storyConfig: StoryConfig): boolean {
  return storyConfig.storyKind !== 'reel'
    && storyConfig.imageGenerationMode === 'generate'
    && (storyConfig.imageDeliveryMode === 'batch' || storyConfig.imageDeliveryMode === 'stateful');
}

// Whether live beat-image generation should be skipped during interactive
// generation. True for prompt-only stories and for batch-delivery stories
// (images are produced later by the background batch). Portraits are handled
// separately and are generated at batch-submit time.
function defersLiveImageGeneration(storyConfig: StoryConfig): boolean {
  return isPromptOnlyStoryConfig(storyConfig) || isBatchImageDeliveryStoryConfig(storyConfig);
}

function getStoryAspectRatio(storyConfig: StoryConfig): StoryAspectRatio {
  return storyConfig.isVerticalStory || storyConfig.aspectRatio === '9:16' ? '9:16' : '16:9';
}

function getSeedBeatByIndex(storyConfig: StoryConfig, beatIndex: number): SeedBeatOutline | undefined {
  const seedPlan = getSeedPlan(storyConfig);
  return seedPlan?.beats.find((beat) => beat.beatIndex === beatIndex);
}

function isCanonicalSeedOption(beat: StoryBeat, optionId: string): boolean {
  if (!beat.canonicalOptionId) {
    return false;
  }

  return beat.canonicalOptionId === optionId;
}

function withGeneratedOrigin(beat: StoryBeat): StoryBeat {
  if (beat.originKind) {
    return beat;
  }

  return {
    ...beat,
    originKind: 'generated',
  };
}

function getStartStoryActionKey(storyConfig: StoryConfig) {
  if (isReelStoryConfig(storyConfig)) {
    return isPromptOnlyStoryConfig(storyConfig)
      ? 'start_reel_full_generation_prompt_only' as const
      : 'start_reel_full_generation' as const;
  }

  return defersLiveImageGeneration(storyConfig)
    ? 'start_story_initial_beat_prompt_only' as const
    : 'start_story_initial_beat' as const;
}

function getContinueStoryActionKey(storyConfig: StoryConfig) {
  if (isReelStoryConfig(storyConfig)) {
    throw new Error('continueStory is not supported for reel sessions; reels are generated in one shot.');
  }

  return defersLiveImageGeneration(storyConfig)
    ? 'continue_story_new_beat_prompt_only' as const
    : 'continue_story_new_beat' as const;
}

function enforceReelBeatCap(beat: StoryBeat, storyConfig: StoryConfig): StoryBeat {
  if (!isReelStoryConfig(storyConfig)) {
    return beat;
  }

  if (beat.beatNumber >= storyConfig.maxBeats) {
    return {
      ...beat,
      isEnding: true,
      options: [],
      nextBeatGoal: beat.nextBeatGoal || 'Resolve the reel story in this final beat.',
    };
  }

  return {
    ...beat,
    isEnding: false,
    options: Array.isArray(beat.options) ? beat.options.slice(0, 3) : [],
  };
}

function getReelNarrationStyle(modelOverrides: StoryModelOverrides | undefined, storyConfig: StoryConfig): string | undefined {
  if (!isReelStoryConfig(storyConfig)) return undefined;
  const settings = modelOverrides?.reelSettings;
  const style = settings?.narrationStyles.find((item) => item.key === storyConfig.reel.narrationStyleKey)
    ?? settings?.narrationStyles[0];
  return style ? `${style.label}: ${style.prompt}` : undefined;
}

function getReelVisualStylePromptOptions(modelOverrides: StoryModelOverrides | undefined, storyConfig: StoryConfig) {
  if (!isReelStoryConfig(storyConfig)) return {};

  const tableStyle = modelOverrides?.reelVisualStyles?.find((style) => (
    style.id === storyConfig.reel.visualStyleId || style.slug === storyConfig.reel.visualStyleKey
  ));
  const settings = normalizeReelStorySettings(modelOverrides?.reelSettings ?? DEFAULT_REEL_STORY_SETTINGS);
  const fallbackStyle = findReelDefiner(settings.visualStyles, storyConfig.reel.visualStyleKey);
  const label = tableStyle?.name || fallbackStyle.label;
  const prompt = tableStyle?.promptDefiner || fallbackStyle.prompt;
  const noFaceDefault = tableStyle?.noFaceDefault ?? true;

  return {
    visualStyleDefiner: `${label}: ${prompt}`,
    noFaceRule: noFaceDefault
      ? 'Default to no visible faces: use silhouettes, back views, hands, objects, spaces, symbolic landscapes, and abstract human presence.'
      : 'Faces may appear only when the beat explicitly needs them; still avoid celebrity likeness and unnecessary close-up portraits.',
    textOverlayMode: storyConfig.reel.textOverlayEnabled
      ? 'Visible overlay text is rendered by the player/export layer; reserve clean space and never place text inside the generated image.'
      : 'Overlay text is hidden for this reel; narration still runs, and generated images must contain no text.',
  };
}

function getImageTaskKey(storyConfig: StoryConfig): 'image_generation' | 'reel_image_generation' {
  return isReelStoryConfig(storyConfig) ? 'reel_image_generation' : 'image_generation';
}

function applyImageGenerationResultMetadata(
  beat: StoryBeat,
  imageResult: {
    imageUrl?: string;
    finalPromptText?: string;
    imageModelSnapshot?: import('@/lib/ai/image-models.shared').ImageModelSnapshot;
    imageGenerationMetadata?: Record<string, unknown>;
  }
): StoryBeat {
  if (!imageResult.imageModelSnapshot && !imageResult.imageGenerationMetadata) {
    return beat;
  }

  return {
    ...beat,
    imageProviderKey: imageResult.imageModelSnapshot?.providerKey ?? beat.imageProviderKey,
    imageModelKey: imageResult.imageModelSnapshot?.modelKey ?? beat.imageModelKey,
    imageGenerationMetadata: {
      ...(beat.imageGenerationMetadata ?? {}),
      ...(imageResult.imageGenerationMetadata ?? {}),
      ...(imageResult.imageModelSnapshot ? { imageModelSnapshot: imageResult.imageModelSnapshot } : {}),
    },
  };
}

function applyReelBeatMetadata(beat: StoryBeat, storyConfig: StoryConfig): StoryBeat {
  if (!isReelStoryConfig(storyConfig)) return beat;
  return {
    ...beat,
    reelTextOverlayEnabled: storyConfig.reel.textOverlayEnabled,
    reelTextOverlayStyle: normalizeReelTextOverlayStyle(storyConfig.reel.textOverlayStyle ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE),
  };
}

function applyStoryTextOverlayBeatMetadata(beat: StoryBeat, storyConfig: StoryConfig): StoryBeat {
  if (isReelStoryConfig(storyConfig)) return beat;
  const storyTextOverlay = normalizeStoryConfig(storyConfig).storyTextOverlay;
  return {
    ...beat,
    storyTextOverlayEnabled: beat.storyTextOverlayEnabled ?? storyTextOverlay.enabled,
    storyTextOverlayMode: beat.storyTextOverlayMode || storyTextOverlay.mode,
    storyTextOverlayStyle: normalizeStoryTextOverlayStyle(
      beat.storyTextOverlayStyle ?? storyTextOverlay.style ?? DEFAULT_STORY_TEXT_OVERLAY_STYLE
    ),
    storyTextOverlayCaptions: beat.storyTextOverlayCaptions?.length
      ? beat.storyTextOverlayCaptions
      : buildStoryTextOverlayCaptions({
          storyText: beat.storyText,
          storyTextParts: beat.storyTextParts,
        }),
  };
}

function canPublishStoryPathAsStandard(
  storyMap: StoryMap,
  endingNodeId: string
): boolean {
  return getPathToNode(storyMap, endingNodeId).every((node) => Boolean(node.data.imageUrl));
}

const LOADING_READER_MESSAGE = 'kissago is weaving the story';
const EXPLICIT_PUBLISH_COVER_SETUP_REQUIRED = true;

function formatSelectedOptionForPrompt(option: Option): string {
  const label = option.label.trim();
  const intent = option.intent?.trim() || '';
  return intent ? `Label: ${label}\nIntent: ${intent}` : `Label: ${label}`;
}

function formatChoiceHistoryOption(option: Option): string {
  const label = option.label.trim();
  const intent = option.intent?.trim() || '';
  return intent ? `${label} (intent: ${intent})` : label;
}

function createInitialLoadingReader({
  flow,
  selectedOptionLabel = null,
  fallbackTitle = null,
  fallbackText = null,
}: {
  flow: StoryLoadingFlow;
  selectedOptionLabel?: string | null;
  fallbackTitle?: string | null;
  fallbackText?: string | null;
}): LoadingReaderState {
  return {
    flow,
    startedAt: Date.now(),
    storyTextReadyAt: null,
    message: LOADING_READER_MESSAGE,
    selectedOptionLabel,
    fallbackTitle,
    fallbackText,
    generatedStoryText: null,
    generatedOptions: [],
  };
}

function updateLoadingReaderWithBeat(
  reader: LoadingReaderState | null,
  flow: StoryLoadingFlow,
  beat: StoryBeat
): LoadingReaderState {
  const base = reader || createInitialLoadingReader({ flow });

  return {
    ...base,
    flow,
    storyTextReadyAt: Date.now(),
    generatedStoryText: beat.storyText,
    generatedOptions: beat.options.map((option) => ({
      id: option.id,
      label: option.label,
      intent: option.intent,
    })),
  };
}

export const useStoryStore = create<StoryState>()(
    (set, get) => {
      const updateStoreSaveUi = (partial: Partial<StoryState> = {}) => {
        syncSaveUiState(
          (nextPartial) => set(nextPartial),
          get,
          partial
        );
      };

      const drainPendingBeatImagesForStory = async (
        storyId: string,
        runtimeSettings: StorySaveRuntimeSettings
      ) => {
        const pendingImages = await listPendingBeatImagesForStory(storyId);
        if (pendingImages.length === 0) {
          return;
        }

        for (const record of pendingImages.sort((left, right) => left.updatedAt - right.updatedAt)) {
          const latestState = get();
          if (
            runtimeSettings.storyAssetUploadPauseDuringGenerationEnabled
            && (latestState.isLoading || latestState.isRegeneratingImage)
          ) {
            queuedBeatAssetSyncStoryIds.add(storyId);
            return;
          }

          clearPendingBeatImageRetry(storyId, record.nodeId);

          const currentSession = latestState.session;
          const currentNode =
            currentSession?.savedStoryId === storyId
              ? currentSession.storyMap.nodes[record.nodeId]
              : undefined;
          if (hasPersistedReadyImage(currentNode?.data)) {
            await deletePendingBeatImage(storyId, record.nodeId, record.updatedAt);
            continue;
          }
          const userId = await resolveCurrentUserId(
            currentNode ? currentSession?.savedByUserId || record.userId : record.userId
          );

          if (!userId) {
            queuedBeatAssetSyncStoryIds.add(storyId);
            return;
          }

          if (currentSession?.savedStoryId === storyId && currentNode) {
            updateStoreSaveUi({
              session: updateSessionBeat(currentSession, record.nodeId, (beat) => ({
                ...beat,
                imageStatus: 'pending',
                imageError: undefined,
              })),
              error: null,
            });
          }

          try {
            const imageUrl = await uploadAsset(
              'story-assets',
              `stories/${storyId}/beats/${record.nodeId}/image.webp`,
              record.imageDataUrl,
              {
                access: 'private',
                assetType: 'beat_image',
                storyId,
                nodeId: record.nodeId,
                objectKey: `stories/${storyId}/beats/${record.nodeId}/image.webp`,
                fallbackPath: `${userId}/${storyId}/${record.nodeId}/image.webp`,
              }
            );

            const latestSession = get().session;
            const latestNode =
              latestSession?.savedStoryId === storyId
                ? latestSession.storyMap.nodes[record.nodeId]
                : undefined;
            const latestPendingRecord = await getPendingBeatImage(storyId, record.nodeId);
            if (latestPendingRecord && latestPendingRecord.updatedAt !== record.updatedAt) {
              queuedBeatAssetSyncStoryIds.add(storyId);
              continue;
            }
            const uploadedCharacters = latestNode
              ? await uploadBeatPortraits(userId, storyId, record.nodeId, latestNode.data.characters)
              : undefined;

            await updateBeatMediaState(storyId, record.nodeId, {
              imageUrl,
              imageStatus: 'ready',
              imageError: null,
              ...(uploadedCharacters ? { characters: uploadedCharacters } : {}),
            });

            await deletePendingBeatImage(storyId, record.nodeId, record.updatedAt);

            const newestSession = get().session;
            const newestNode =
              newestSession?.savedStoryId === storyId
                ? newestSession.storyMap.nodes[record.nodeId]
                : undefined;

            if (newestSession && newestNode) {
              const hasNewerLocalImage =
                isDataUrl(newestNode.data.imageUrl)
                && newestNode.data.imageUrl !== record.imageDataUrl;

              updateStoreSaveUi({
                session: updateSessionBeat(newestSession, record.nodeId, (beat) => ({
                  ...beat,
                  ...(uploadedCharacters ? { characters: uploadedCharacters } : {}),
                  persistedImageUrl: imageUrl,
                  imageStatus: hasNewerLocalImage ? 'pending' : 'ready',
                  imageError: undefined,
                  imageUrl: hasNewerLocalImage
                    ? beat.imageUrl
                    : isDataUrl(beat.imageUrl)
                    ? beat.imageUrl
                    : beat.imageUrl || imageUrl,
                })),
                error: null,
              });
            }
          } catch (error) {
            // Transient: beat row has not been persisted yet (saveBeat/saveStory race).
            // Don't count it as a retry attempt — just schedule a short re-drain so we
            // retry once the row exists.
            if (isBeatRowNotFoundError(error)) {
              queuedBeatAssetSyncStoryIds.add(storyId);
              schedulePendingBeatImageRetry(
                storyId,
                record.nodeId,
                BEAT_IMAGE_RETRY_BACKOFF_MS[0],
                () => {
                  void retryPendingBeatAssetSyncInternal();
                }
              );
              continue;
            }

            const message = error instanceof Error ? error.message : 'Beat image upload failed';
            const updateResult = await updatePendingBeatImageAttempt(
              storyId,
              record.nodeId,
              message,
              record.updatedAt
            );

            if (!updateResult.updated) {
              queuedBeatAssetSyncStoryIds.add(storyId);
              continue;
            }

            const failedRecord = updateResult.record;
            const exhaustedRetries = Boolean(
              failedRecord && failedRecord.attemptCount > BEAT_IMAGE_RETRY_BACKOFF_MS.length
            );
            const nextStatus = exhaustedRetries ? 'failed' as const : 'pending' as const;

            try {
              if (exhaustedRetries) {
                await updateBeatMediaState(storyId, record.nodeId, {
                  imageStatus: 'failed',
                  imageError: message,
                });
              }
            } catch (persistError) {
              console.error('Failed to persist beat image sync failure:', persistError);
            }

            const newestSession = get().session;
            if (newestSession?.savedStoryId === storyId && newestSession.storyMap.nodes[record.nodeId]) {
              updateStoreSaveUi({
                session: updateSessionBeat(newestSession, record.nodeId, (beat) => ({
                  ...beat,
                  imageStatus: nextStatus,
                  imageError: message,
                })),
              });
            }

            if (!exhaustedRetries && failedRecord) {
              schedulePendingBeatImageRetry(
                storyId,
                record.nodeId,
                BEAT_IMAGE_RETRY_BACKOFF_MS[Math.max(0, failedRecord.attemptCount - 1)],
                () => {
                  void retryPendingBeatAssetSyncInternal();
                }
              );
            }
          }
        }
      };

      const stopImageJobPolling = () => {
        if (imageJobPollTimer) {
          clearTimeout(imageJobPollTimer);
          imageJobPollTimer = null;
        }
        imageJobPollStoryId = null;
        if (get().activeImageJobNodeIds.length > 0) {
          set({ activeImageJobNodeIds: [] });
        }
      };

      // Merge worker-completed images into the live session and report whether
      // any jobs are still in flight for this story.
      const pollImageJobsOnce = async (storyId: string): Promise<boolean> => {
        const session = get().session;
        if (!session || session.savedStoryId !== storyId) return false;

        const statuses = await getStoryImageJobStatuses(storyId);
        if (statuses.length === 0) return false;

        const finishedNodes = statuses.filter((status) => {
          if (status.status !== 'ready') return false;
          const node = session.storyMap.nodes[status.nodeId];
          return node ? node.data.imageStatus !== 'ready' : false;
        });

        if (finishedNodes.length > 0) {
          const readyImages = await getReadyBeatImages(storyId, finishedNodes.map((status) => status.nodeId));
          for (const ready of readyImages) {
            if (!ready.imageUrl || ready.imageStatus !== 'ready') continue;
            const latestSession = get().session;
            if (!latestSession || latestSession.savedStoryId !== storyId) return false;
            if (!latestSession.storyMap.nodes[ready.nodeId]) continue;
            updateStoreSaveUi({
              session: updateSessionBeat(latestSession, ready.nodeId, (beat) => ({
                ...beat,
                imageUrl: ready.imageUrl ?? beat.imageUrl,
                persistedImageUrl: ready.imageUrl ?? beat.persistedImageUrl,
                imageStatus: 'ready',
                imageError: undefined,
              })),
            });
          }
        }

        for (const status of statuses) {
          if (status.status !== 'failed' && status.status !== 'cancelled') continue;
          const latestSession = get().session;
          if (!latestSession || latestSession.savedStoryId !== storyId) return false;
          const node = latestSession.storyMap.nodes[status.nodeId];
          if (!node || node.data.imageStatus === 'failed' || node.data.imageStatus === 'ready') continue;
          updateStoreSaveUi({
            session: updateSessionBeat(latestSession, status.nodeId, (beat) => ({
              ...beat,
              imageStatus: 'failed',
              imageError: status.error ?? 'Image generation failed. Please try again.',
            })),
          });
        }

        const pendingNodeIds = statuses
          .filter((status) => status.beatImageStatus === 'pending')
          .map((status) => status.nodeId);
        set({ activeImageJobNodeIds: pendingNodeIds });
        return pendingNodeIds.length > 0;
      };

      const startImageJobPolling = (storyId: string) => {
        if (imageJobPollStoryId === storyId && imageJobPollTimer) return;
        stopImageJobPolling();
        imageJobPollStoryId = storyId;

        const tick = async () => {
          if (imageJobPollStoryId !== storyId) return;
          let stillPending = false;
          try {
            stillPending = await pollImageJobsOnce(storyId);
          } catch (error) {
            console.error('Image job polling failed:', error);
            stillPending = true; // transient failure — keep watching
          }
          if (imageJobPollStoryId !== storyId) return;
          if (stillPending) {
            imageJobPollTimer = setTimeout(() => { void tick(); }, IMAGE_JOB_POLL_INTERVAL_MS);
          } else {
            stopImageJobPolling();
          }
        };

        imageJobPollTimer = setTimeout(() => { void tick(); }, IMAGE_JOB_POLL_INTERVAL_MS);
      };

      const retryPendingBeatAssetSyncInternal = async (storyId?: string) => {
        if (storyId) {
          queuedBeatAssetSyncStoryIds.add(storyId);
        } else {
          const currentStoryId = get().session?.savedStoryId;
          if (currentStoryId) {
            queuedBeatAssetSyncStoryIds.add(currentStoryId);
          }
        }

        if (activeBeatAssetSyncPromise) {
          return activeBeatAssetSyncPromise;
        }

        activeBeatAssetSyncPromise = (async () => {
          try {
            while (queuedBeatAssetSyncStoryIds.size > 0) {
              const [nextStoryId] = Array.from(queuedBeatAssetSyncStoryIds);
              queuedBeatAssetSyncStoryIds.delete(nextStoryId);
              const runtimeSettings = await resolveStorySaveRuntimeSettings(get().saveRuntimeSettings);
              await drainPendingBeatImagesForStory(nextStoryId, runtimeSettings);
            }
          } finally {
            activeBeatAssetSyncPromise = null;
            updateStoreSaveUi({ isSaving: false, error: null });
          }
        })();

        updateStoreSaveUi({ error: null });
        return activeBeatAssetSyncPromise;
      };

      return ({
      session: null,
      isLoading: false,
      loadingClues: [],
      loadingStage: null,
      loadingReader: null,
      error: null,
      errorAction: null,
      isGeneratingAudio: false,
      isRegeneratingImage: false,
      beatControlSettings: DEFAULT_BEAT_CONTROL_RUNTIME_SETTINGS,
      characterUniverseSettings: DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS,
      activeImageJobNodeIds: [],
      isSubmittingImageBatch: false,
      imageBatchMessage: null,
      isGeneratingNarrationBatch: false,
      narrationBatchProgress: null,
      narrationBatchMessage: null,
      autoBuildProgress: null,
      audioReadyNodeId: null,
      storyMode: false,
      isSaving: false,
      saveStatus: 'idle' as const,
      saveWarning: null,
      saveRuntimeSettings: DEFAULT_STORY_SAVE_RUNTIME_SETTINGS,
      lastPublishResult: null,

      setSaveRuntimeSettings: (settings: Partial<StorySaveRuntimeSettings>) => {
        cacheStorySaveRuntimeSettings(settings);
        set((state) => ({
          saveRuntimeSettings: {
            ...state.saveRuntimeSettings,
            ...settings,
          },
        }));
      },

      startStory: async (prompt: string, config?: StoryConfig, seed?: StorySeedOptions) => {
        const storyConfig = normalizeStoryConfig(config || DEFAULT_STORY_CONFIG);
        if (isReelStoryConfig(storyConfig)) {
          return get().startReel(prompt, storyConfig);
        }
        const seededStory = isSeededStoryConfig(storyConfig);
        const promptOnly = defersLiveImageGeneration(storyConfig);
        const storyAspectRatio = getStoryAspectRatio(storyConfig);
        const startStoryActionKey = getStartStoryActionKey(storyConfig);
        const storyPrompt = seededStory
          ? storyConfig.authoring.sourceText?.trim() || prompt
          : prompt;
        const openingSeedBeat = seededStory ? getSeedBeatByIndex(storyConfig, 1) : undefined;
        const visualStyle = deriveVisualStyleSummary(storyConfig.visualSettings);
        const initialSessionId = uuidv4();
        const rootNodeId = uuidv4();
        const baseCostTelemetry: CostTelemetryContext = {
          activityKey: startStoryActionKey,
          storySessionId: initialSessionId,
          nodeId: rootNodeId,
          beatNumber: 1,
          metadata: {
            authoringMode: storyConfig.authoring.mode,
            language: storyConfig.language,
            maxBeats: storyConfig.maxBeats,
          },
        };
        const generationStartedAt = nowMs();
        const timingSteps: GenerationTimingStep[] = [];
        let billingAuthorization: PricingBillableActionAuthorization;
        set({
          isLoading: true,
          error: null,
          errorAction: null,
          loadingClues: [LOADING_READER_MESSAGE],
          loadingStage: createStoryLoadingStage('start_story', 'wallet'),
          loadingReader: createInitialLoadingReader({
            flow: 'start_story',
            fallbackTitle: storyConfig.authoring.workingTitle?.trim() || 'Your story is beginning',
            fallbackText: storyConfig.authoring.preludeText?.trim() || prompt,
          }),
        });
        // Beat bundle (flag-gated): two server round-trips replace the legacy
        // authorize → generate → plan → portraits → save → enqueue client
        // orchestration. Seeded / episode-carry / prompt-only / mock starts
        // stay on the legacy path, and any 'legacy' answer from the server
        // falls through to the untouched flow below.
        if (
          !seededStory
          && !promptOnly
          && !seed?.seedCharacters?.length
          && !seed?.episodeContext
          && storyPrompt.toLowerCase() !== 'mock'
        ) {
          let bundleMode: 'legacy' | 'bundle' = 'legacy';
          try {
            bundleMode = await resolveBeatGenerationModeCached();
          } catch { /* resolver failure = legacy */ }

          if (bundleMode === 'bundle') {
            const runStartStoryBundle = async (): Promise<boolean> => {
              const requestedNarrationVoice = storyConfig.narrationVoice;
              const initialSession: Partial<StorySession> = {
                storySessionId: initialSessionId,
                userPrompt: storyPrompt,
                genre: 'adventure',
                tone: 'playful',
                targetAge: storyConfig.ageGroup,
                visualStyle,
                currentBeat: 0,
                maxBeats: storyConfig.maxBeats,
                status: 'active',
                characters: [],
                enableReferenceImages: true,
                setting: {
                  world: storyConfig.settingCountry !== 'generic' ? storyConfig.settingCountry : 'unknown',
                  timeOfDay: 'unknown',
                  mood: 'unknown',
                },
                storyConfig,
                beats: [],
                choiceHistory: [],
                openThreads: [],
                allowedEndings: ['friendship', 'moral', 'comedy', 'discovery', 'rescue', 'bittersweet'],
                safetyProfile: storyConfig.ageGroup.startsWith('kids') ? 'children' : 'all_ages',
                narratorVoice: requestedNarrationVoice?.mode === 'user_selected' ? requestedNarrationVoice.voiceId : undefined,
                narrationVoiceMode: requestedNarrationVoice?.mode,
                narrationVoiceGenderBucket: requestedNarrationVoice?.genderBucket,
                narrationLanguageCode: requestedNarrationVoice?.languageCode,
              };

              // Voice resolves in parallel with the core round-trip.
              const voicePromise = measureAsyncStep(
                timingSteps,
                'voice_resolution',
                'Resolve narrator voice',
                () => resolveNarrationVoiceServer({
                  requestedMode: initialSession.narrationVoiceMode ?? storyConfig.narrationVoice?.mode ?? null,
                  requestedVoiceId: initialSession.narratorVoice ?? storyConfig.narrationVoice?.voiceId ?? null,
                  requestedGenderBucket: initialSession.narrationVoiceGenderBucket ?? storyConfig.narrationVoice?.genderBucket ?? null,
                  requestedAccent: storyConfig.narrationVoice?.accent ?? null,
                  language: storyConfig.language || 'english',
                  genre: initialSession.genre!,
                  tone: initialSession.tone!,
                  targetAge: initialSession.targetAge!,
                  costTelemetry: costPhase(baseCostTelemetry, 'voice_selection'),
                }),
                { background: true }
              );
              voicePromise.catch(() => { /* surfaced where awaited */ });

              setLoadingStage(set, 'start_story', 'beat');
              const core = await measureAsyncStep(
                timingSteps,
                'beat_bundle_core',
                'Generate opening beat and plan (bundle)',
                () => generateBeatCore({
                  userPrompt: storyPrompt,
                  sessionForPrompt: initialSession,
                  visualStyle,
                  authorize: {
                    actionKey: startStoryActionKey,
                    idempotencyKey: `start_story:${initialSessionId}`,
                    storyConfig,
                    imageCount: 1,
                    taskKey: getImageTaskKey(storyConfig),
                    metadata: {
                      language: storyConfig.language,
                      ageGroup: storyConfig.ageGroup,
                      maxBeats: storyConfig.maxBeats,
                      settingCountry: storyConfig.settingCountry,
                      authoringMode: storyConfig.authoring.mode,
                      beatBundle: true,
                    },
                  },
                  storyTelemetry: costPhase(baseCostTelemetry, 'story_generation'),
                  composerTelemetry: costPhase(baseCostTelemetry, 'storyboard_plan'),
                })
              );

              if (core.status === 'legacy') {
                return false;
              }
              if (core.status === 'blocked') {
                const pricingErrorState = buildPricingErrorState(core.authorization, 'start_story');
                set({
                  isLoading: false,
                  loadingClues: [],
                  loadingStage: null,
                  loadingReader: null,
                  error: pricingErrorState?.error ?? 'Unable to check your wallet right now.',
                  errorAction: pricingErrorState?.errorAction ?? null,
                });
                return true;
              }

              let beat = enforceReelBeatCap(core.beat, storyConfig);
              const storyboardPlan = core.storyboardPlan;
              beat.storyboardPlan = storyboardPlan;
              beat.storyboardPromptText = renderStoryboardPlan(storyboardPlan);
              beat.isStoryboard = true;
              beat = applyStoryTextOverlayBeatMetadata(beat, storyConfig);

              set((state) => ({
                loadingClues: beat.clues,
                loadingReader: updateLoadingReaderWithBeat(state.loadingReader, 'start_story', beat),
              }));
              setLoadingStage(set, 'start_story', 'visual');

              const voiceResolution = await voicePromise;
              const resolvedTitle = storyConfig.authoring.workingTitle?.trim() || beat.title;
              const storyMap = createStoryMap(beat, rootNodeId);
              const fullSessionBase = {
                ...initialSession,
                title: resolvedTitle,
                narratorVoice: voiceResolution.voiceId,
                narrationVoiceMode: voiceResolution.mode,
                narrationVoiceGenderBucket: voiceResolution.genderBucket ?? undefined,
                narrationLanguageCode: voiceResolution.languageCode,
                storyMap,
              } as StorySession;

              setLoadingStage(set, 'start_story', 'image', { note: IMAGE_JOB_SAFE_TO_LEAVE_NOTE });
              let visuals: Awaited<ReturnType<typeof processBeatVisuals>>;
              try {
                visuals = await measureAsyncStep(
                  timingSteps,
                  'beat_bundle_visuals',
                  'Persist story and queue image (bundle)',
                  () => processBeatVisuals({
                    target: { kind: 'new_story', session: fullSessionBase, rootNodeId },
                    beat,
                    storyboardPlan,
                    visualStyle,
                    storyConfig,
                    storyAspectRatio,
                    reservationId: core.reservationId,
                    narrationVoiceId: voiceResolution.voiceId,
                    imageContinuityStrategy: storyConfig.imageContinuityStrategy,
                    storySessionId: initialSessionId,
                    portraitTelemetry: costPhase(baseCostTelemetry, 'portrait_generation'),
                    imageTelemetry: costPhase(baseCostTelemetry, getImageTaskKey(storyConfig), { beatBundle: true }),
                  })
                );
              } catch (error: any) {
                await releaseBundleReservation(core.reservationId, 'beat_bundle_visuals_failed');
                throw error;
              }

              if (visuals.status !== 'queued') {
                await releaseBundleReservation(core.reservationId, `beat_bundle_${visuals.reason}`);
                throw new Error(visuals.message || "The story couldn't be saved. Please try again.");
              }
              const queued = visuals;

              const jobOutcome = await measureAsyncStep(
                timingSteps,
                'image_job_wait',
                'Wait for background image render',
                () => waitForQueuedBeatImage(queued.storyId, rootNodeId)
              );
              const imageStillPending = !jobOutcome;
              const pendingNodeData = {
                ...normalizeBeatMediaFields({
                  ...queued.beat,
                  imageUrl: undefined,
                  persistedImageUrl: undefined,
                  imageStatus: 'pending' as const,
                  imageError: undefined,
                  audioStatus: 'not_requested' as const,
                  audioError: undefined,
                }),
                narrationVoiceId: voiceResolution.voiceId,
              };
              storyMap.nodes[rootNodeId] = {
                ...storyMap.nodes[rootNodeId],
                data: jobOutcome?.imageStatus === 'ready'
                  ? {
                      ...pendingNodeData,
                      imageUrl: jobOutcome.imageUrl,
                      persistedImageUrl: jobOutcome.imageUrl,
                      imageStatus: 'ready' as const,
                      imageError: undefined,
                    }
                  : jobOutcome?.imageStatus === 'failed'
                    ? {
                        ...pendingNodeData,
                        imageStatus: 'failed' as const,
                        imageError: jobOutcome.imageError ?? 'Image generation failed. You can retry it from the story.',
                      }
                    : pendingNodeData,
              };

              const fullSession = deriveSessionFields(
                {
                  ...fullSessionBase,
                  savedStoryId: queued.storyId,
                  savedByUserId: queued.savedByUserId,
                } as StorySession,
                storyMap
              );
              set({
                session: fullSession,
                isLoading: false,
                // Beat text + voice are already durably persisted server-side;
                // the worker owns the image writes — same reasoning as the
                // legacy server_pipeline branch.
                saveStatus: 'saved',
                loadingClues: [],
                loadingStage: null,
                loadingReader: null,
                error: null,
                errorAction: null,
                ...(imageStillPending
                  ? { activeImageJobNodeIds: Array.from(new Set([...get().activeImageJobNodeIds, rootNodeId])) }
                  : {}),
              });
              if (imageStillPending) {
                startImageJobPolling(queued.storyId);
              }
              dispatchPricingRuntimeRefresh();
              logGenerationTiming({
                scope: 'start_story',
                totalMs: Math.round(nowMs() - generationStartedAt),
                steps: timingSteps,
                meta: {
                  success: true,
                  beatNumber: beat.beatNumber,
                  storyId: queued.storyId,
                  promptOnly,
                  serverPipeline: true,
                  beatBundle: true,
                  imageWaitOutcome: jobOutcome?.imageStatus ?? 'pending',
                },
              });
              return true;
            };

            try {
              if (await runStartStoryBundle()) {
                return;
              }
              // Server said legacy — continue with the untouched flow below.
            } catch (error: any) {
              logGenerationTiming({
                scope: 'start_story',
                totalMs: Math.round(nowMs() - generationStartedAt),
                steps: timingSteps,
                meta: {
                  success: false,
                  failureStage: 'beat_bundle',
                  message: error?.message || 'Story generation failed.',
                },
              });
              set({
                isLoading: false,
                loadingClues: [],
                loadingStage: null,
                loadingReader: null,
                error: error?.message || "The story couldn't start. Please try again.",
                errorAction: null,
              });
              return;
            }
          }
        }

        // Independent of wallet authorization — run both round-trips in parallel.
        const modelOverridesPromise = getStoryModelOverridesCached().catch(() => undefined);
        try {
          billingAuthorization = await measureAsyncStep(
            timingSteps,
            'wallet_authorization',
            'Authorize story start',
            () => authorizeCurrentUserImageModelBillableAction({
              actionKey: startStoryActionKey,
              idempotencyKey: `start_story:${initialSessionId}`,
              storyConfig,
              imageCount: 1,
              taskKey: getImageTaskKey(storyConfig),
              metadata: {
                language: storyConfig.language,
                ageGroup: storyConfig.ageGroup,
                maxBeats: storyConfig.maxBeats,
                settingCountry: storyConfig.settingCountry,
                authoringMode: storyConfig.authoring.mode,
              },
            }),
            {
              maxBeats: storyConfig.maxBeats,
              language: storyConfig.language,
            }
          );
        } catch (error: any) {
          logGenerationTiming({
            scope: 'start_story',
            totalMs: Math.round(nowMs() - generationStartedAt),
            steps: timingSteps,
            meta: {
              success: false,
              failureStage: 'wallet_authorization',
              message: error?.message || 'Unable to check your wallet right now.',
            },
          });
          set({
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: error?.message || 'Unable to check your wallet right now.',
            errorAction: null,
          });
          return;
        }

        const pricingErrorState = buildPricingErrorState(billingAuthorization, 'start_story');
        if (pricingErrorState) {
          set({
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: pricingErrorState.error,
            errorAction: pricingErrorState.errorAction,
          });
          return;
        }

        const reservationId = getHardReservationId(billingAuthorization);
        let shouldReleaseReservation = Boolean(reservationId);

        // Active model config from DB, kicked off before authorization above
        // (falls back to hardcoded defaults on error)
        const modelOverrides: StoryModelOverrides | undefined = await measureAsyncStep(
          timingSteps,
          'model_overrides',
          'Load model and prompt overrides',
          () => modelOverridesPromise
        );

        try {
          const requestedNarrationVoice = storyConfig.narrationVoice;
          const initialSession: Partial<StorySession> = {
            storySessionId: initialSessionId,
            userPrompt: storyPrompt,
            genre: 'adventure',
            tone: 'playful',
            targetAge: storyConfig.ageGroup,
            visualStyle,
            currentBeat: 0,
            maxBeats: storyConfig.maxBeats,
            status: 'active',
            // Pack 2: carried episode cast / mixed-in library characters seed
            // the roster so castRegistry + usedCharacterNames see them from
            // beat 1 and their portraits are reused instead of regenerated.
            characters: seed?.seedCharacters ?? [],
            ...(seed?.episodeContext ? { episodeContext: seed.episodeContext } : {}),
            enableReferenceImages: true, // TODO: set from user tier (premium only)
            setting: {
              world: storyConfig.settingCountry !== 'generic' ? storyConfig.settingCountry : 'unknown',
              timeOfDay: 'unknown',
              mood: 'unknown',
            },
            storyConfig,
            beats: [],
            choiceHistory: [],
            openThreads: [],
            allowedEndings: ['friendship', 'moral', 'comedy', 'discovery', 'rescue', 'bittersweet'],
            safetyProfile: storyConfig.ageGroup.startsWith('kids') ? 'children' : 'all_ages',
            narratorVoice: requestedNarrationVoice?.mode === 'user_selected' ? requestedNarrationVoice.voiceId : undefined,
            narrationVoiceMode: requestedNarrationVoice?.mode,
            narrationVoiceGenderBucket: requestedNarrationVoice?.genderBucket,
            narrationLanguageCode: requestedNarrationVoice?.languageCode,
          };

          setLoadingStage(set, 'start_story', 'beat');
          let beat = await measureAsyncStep(
            timingSteps,
            seededStory ? 'seeded_beat_materialization' : 'story_generation',
            seededStory ? 'Materialize seeded opening beat' : 'Generate opening beat',
            async () => {
              if (seededStory) {
                if (!openingSeedBeat) {
                  throw new Error('Seeded story is missing its opening beat plan.');
                }

                return materializeSeededBeat(
                  openingSeedBeat,
                  initialSession,
                  modelOverrides,
                  costPhase(baseCostTelemetry, 'beat_materialization')
                );
              }

              return withGeneratedOrigin(
                await generateStoryBeat(
                  storyPrompt,
                  initialSession,
                  undefined,
                  modelOverrides,
                  costPhase(baseCostTelemetry, 'story_generation')
                )
              );
            }
          );
          beat = enforceReelBeatCap(
            mergeCharacterVisualReferences(beat, initialSession.characters || []),
            storyConfig
          );

          set((state) => ({
            loadingClues: beat.clues,
            loadingReader: updateLoadingReaderWithBeat(state.loadingReader, 'start_story', beat),
          }));

          const lang = initialSession.storyConfig?.language || 'english';
          setLoadingStage(set, 'start_story', 'visual');
          const composedStoryboardPlan = await measureAsyncStep(
            timingSteps,
            'storyboard_plan',
            'Compose storyboard plan',
            () => composeStoryboardPlan(
              beat,
              initialSession,
              initialSession.visualStyle!,
              modelOverrides,
              costPhase(baseCostTelemetry, 'storyboard_plan')
            )
          );
          // Pack 2: carried characters already have portraits/reference sheets
          // — drop their new_character portrait tasks so identity is reused.
          const storyboardPlan = seed?.seedCharacters?.length
            ? filterCarriedPortraitTasks(composedStoryboardPlan, beat.characters)
            : composedStoryboardPlan;
          beat.storyboardPlan = storyboardPlan;
          beat.storyboardPromptText = renderStoryboardPlan(storyboardPlan);
          if (seed?.episodeContext) {
            // The episode cover must visualize "Episode N" (explicit exception
            // to the storyboard no-text rules); stored on the beat so both the
            // server-pipeline and legacy paths, plus regenerations, include it.
            beat.storyboardPromptText = appendEpisodeTitleImageInstruction(
              beat.storyboardPromptText,
              seed.episodeContext.episodeNumber
            );
          }
          beat.isStoryboard = true;
          if (isReelStoryConfig(storyConfig)) {
            beat = applyReelBeatMetadata(beat, storyConfig);
            beat.reelCaptions = buildReelPanelCaptions(beat, storyboardPlan, {
              textLength: storyConfig.reel.textLength,
              reelSettings: modelOverrides?.reelSettings,
              storyConfig,
            });
          } else {
            beat = applyStoryTextOverlayBeatMetadata(beat, storyConfig);
          }

          const portraitGenerationResult = initialSession.enableReferenceImages && !promptOnly
            ? await measureAsyncStep(
                timingSteps,
                'portrait_generation',
                'Generate reference portraits',
                () => generatePortraitsForStoryboardPlan(
                  beat,
                  storyboardPlan,
                  initialSession.visualStyle!,
                  storyConfig.portraitReferences,
                  modelOverrides,
                  costPhase(baseCostTelemetry, 'portrait_generation'),
                  storyConfig.imageModelSelection,
                  imageContinuityOptions(storyConfig, null)
                ),
                {
                  portraitTaskCount: storyboardPlan.portraitTasks.length,
                  portraitReferenceMode: storyConfig.portraitReferences.mode,
                  portraitReferenceQuality: storyConfig.portraitReferences.quality,
                }
              )
            : { references: [], latestState: null };
          const portraitRefs = initialSession.enableReferenceImages && !promptOnly
            ? mergeReferenceImages(collectBeatPortraitReferences(beat), portraitGenerationResult.references)
            : [];
          if (promptOnly) {
            assignPortraitPromptTexts(
              beat,
              storyboardPlan,
              initialSession.visualStyle!,
              storyConfig.portraitReferences,
              modelOverrides
            );
          }
          const storyboardPrompt = beat.storyboardPromptText || renderStoryboardPlan(storyboardPlan);

          // Create storyMap once the canonical visual plan is ready so beat 1 persists
          // portraits, storyboard metadata, and later image continuity anchors together.
          const storyMap = createStoryMap(beat, rootNodeId);

          let earlySavedStoryId: string | undefined;
          let earlySavedByUserId: string | undefined;
          const resolvedTitle = storyConfig.authoring.workingTitle?.trim() || beat.title;

          // Resolve narration voice. User-led mode bypasses the legacy AI selector.
          const voicePromise = measureAsyncStep(
            timingSteps,
            'voice_resolution',
            'Resolve narrator voice',
            () => resolveNarrationVoiceServer({
              requestedMode: initialSession.narrationVoiceMode ?? storyConfig.narrationVoice?.mode ?? null,
              requestedVoiceId: initialSession.narratorVoice ?? storyConfig.narrationVoice?.voiceId ?? null,
              requestedGenderBucket: initialSession.narrationVoiceGenderBucket ?? storyConfig.narrationVoice?.genderBucket ?? null,
              requestedAccent: storyConfig.narrationVoice?.accent ?? null,
              language: lang,
              genre: initialSession.genre!,
              tone: initialSession.tone!,
              targetAge: initialSession.targetAge!,
              costTelemetry: costPhase(baseCostTelemetry, 'voice_selection'),
            }),
            { background: true }
          );

          // Early save: get a savedStoryId so narration can persist directly to Supabase
          const earlySavePromise = measureAsyncStep(
            timingSteps,
            'early_save',
            'Create initial story record',
            () => saveStoryAction(
              { ...initialSession, title: resolvedTitle } as StorySession,
              storyMap
            ).then(({ storyId }) => {
              earlySavedStoryId = storyId;
              return storyId;
            }).catch((err) => {
              console.error('Early save failed (narration will use base64 fallback):', err);
              return undefined;
            }),
            { background: true }
          );

          const lockedVoicePromise = measureAsyncStep(
            timingSteps,
            'voice_lock',
            'Lock narrator voice',
            () => Promise.all([voicePromise, earlySavePromise]).then(
              async ([voiceResolution, storyId]) => {
                if (!storyId) {
                  return voiceResolution;
                }

                try {
                  const voiceId = await ensureNarratorVoiceLocked(storyId, voiceResolution.voiceId, {
                    mode: voiceResolution.mode,
                    genderBucket: voiceResolution.genderBucket,
                    languageCode: voiceResolution.languageCode,
                  });
                  return { ...voiceResolution, voiceId };
                } catch (error) {
                  console.error('Failed to persist locked narrator voice:', error);
                  return voiceResolution;
                }
              }
            ),
            { background: true }
          );


          // Server-pipeline routing (admin processing mode): persist the opening
          // beat server-side, then hand the image to a durable background job —
          // from here the browser can close without losing anything. Mirrors the
          // continue-story branch; requires the early story save to have landed.
          let effectiveImageMode: 'client_legacy' | 'server_pipeline' = 'client_legacy';
          if (!promptOnly && storyPrompt.toLowerCase() !== 'mock') {
            try {
              effectiveImageMode = await resolveImageProcessingModeCached();
            } catch {
              // Resolver failure = legacy; the server re-checks on enqueue anyway.
            }
          }

          if (effectiveImageMode === 'server_pipeline') {
            const [voiceResolution, savedStoryId] = await Promise.all([
              lockedVoicePromise,
              earlySavePromise,
            ]);
            if (savedStoryId) {
              earlySavedByUserId = (await resolveCurrentUserId()) ?? undefined;
              // The worker replays generateSelectedImage with this exact final
              // prompt — built here because the prompt orchestrator is client code.
              const jobFinalPrompt = buildFinalStoryboardImagePrompt(
                storyboardPrompt,
                beat.characters,
                initialSession.visualStyle!,
                beat.beatNumber,
                modelOverrides,
                {
                  aspectRatio: storyAspectRatio,
                  task: getImageTaskKey(storyConfig),
                  ...getReelVisualStylePromptOptions(modelOverrides, storyConfig),
                }
              );
              beat.finalImagePromptText = jobFinalPrompt;

              storyMap.nodes[rootNodeId] = {
                ...storyMap.nodes[rootNodeId],
                data: {
                  ...normalizeBeatMediaFields({
                    ...beat,
                    imageUrl: undefined,
                    persistedImageUrl: undefined,
                    imageStatus: 'pending',
                    imageError: undefined,
                    audioStatus: 'not_requested',
                    audioError: undefined,
                  }),
                  narrationVoiceId: voiceResolution.voiceId,
                },
              };
              // DB copy: strip inline portrait payloads (the job carries its own
              // staged references; base64 must never land in story_map).
              const durableRootNode: StoryNode = {
                ...storyMap.nodes[rootNodeId],
                data: {
                  ...storyMap.nodes[rootNodeId].data,
                  characters: storyMap.nodes[rootNodeId].data.characters.map((character) => ({
                    ...character,
                    portraitBase64: undefined,
                  })),
                },
              };

              setLoadingStage(set, 'start_story', 'image');
              let earlyBeatSaved = false;
              try {
                const { beatId } = await measureAsyncStep(
                  timingSteps,
                  'early_beat_save',
                  'Persist opening beat before image job',
                  () => saveBeatAction(savedStoryId, rootNodeId, durableRootNode)
                );
                earlyBeatSaved = true;
                linkCostEventsToBeat({
                  storySessionId: initialSessionId,
                  storyId: savedStoryId,
                  nodeId: rootNodeId,
                  beatId,
                }).catch((error) => console.error('Failed to link opening beat cost events:', error));
              } catch (err) {
                console.error('Opening beat early save failed; falling back to inline image generation:', err);
              }

              if (earlyBeatSaved) {
                const enqueueResult = await measureAsyncStep(
                  timingSteps,
                  'image_job_enqueue',
                  'Queue background image job',
                  () => enqueueBeatImageJob({
                    storyId: savedStoryId,
                    nodeId: rootNodeId,
                    kind: 'beat_image',
                    beatNumber: beat.beatNumber,
                    reservationId,
                    payload: {
                      finalPrompt: jobFinalPrompt,
                      beatNumber: beat.beatNumber,
                      aspectRatio: storyAspectRatio,
                      imageTask: getImageTaskKey(storyConfig),
                      imageSize: normalizeStoryboardImageQualitySettings(modelOverrides?.storyboardImageSettings).imageSize,
                      imageModelSelection: storyConfig.imageModelSelection ?? null,
                      imageContinuity: imageContinuityOptions(
                        storyConfig,
                        portraitGenerationResult.latestState
                      ) ?? null,
                      costTelemetry: costPhase(baseCostTelemetry, getImageTaskKey(storyConfig), {
                        referenceCount: portraitRefs.length,
                      }),
                      references: portraitRefs,
                    },
                  })
                );

                if (enqueueResult.status === 'queued') {
                  // The worker owns the reservation now (finalizes on ready,
                  // releases on terminal failure).
                  shouldReleaseReservation = false;

                  // Everything is durable from here — tell the user they may
                  // leave, but keep the preloader on the image stage so a user
                  // who stays receives the beat complete with its image
                  // (background delivery is the safety net, not the UX).
                  setLoadingStage(set, 'start_story', 'image', { note: IMAGE_JOB_SAFE_TO_LEAVE_NOTE });
                  const jobOutcome = await measureAsyncStep(
                    timingSteps,
                    'image_job_wait',
                    'Wait for background image render',
                    () => waitForQueuedBeatImage(savedStoryId, rootNodeId)
                  );

                  const pendingRootNode = storyMap.nodes[rootNodeId];
                  if (jobOutcome?.imageStatus === 'ready') {
                    storyMap.nodes[rootNodeId] = {
                      ...pendingRootNode,
                      data: {
                        ...pendingRootNode.data,
                        imageUrl: jobOutcome.imageUrl,
                        persistedImageUrl: jobOutcome.imageUrl,
                        imageStatus: 'ready',
                        imageError: undefined,
                      },
                    };
                  } else if (jobOutcome?.imageStatus === 'failed') {
                    storyMap.nodes[rootNodeId] = {
                      ...pendingRootNode,
                      data: {
                        ...pendingRootNode.data,
                        imageStatus: 'failed',
                        imageError: jobOutcome.imageError ?? 'Image generation failed. You can retry it from the story.',
                      },
                    };
                  }
                  const imageStillPending = !jobOutcome;

                  const fullSession = deriveSessionFields(
                    {
                      ...initialSession,
                      title: resolvedTitle,
                      narratorVoice: voiceResolution.voiceId,
                      narrationVoiceMode: voiceResolution.mode,
                      narrationVoiceGenderBucket: voiceResolution.genderBucket ?? undefined,
                      narrationLanguageCode: voiceResolution.languageCode,
                      savedStoryId,
                      ...(earlySavedByUserId ? { savedByUserId: earlySavedByUserId } : {}),
                    } as StorySession,
                    storyMap
                  );
                  set({
                    session: fullSession,
                    isLoading: false,
                    // The opening beat (text, image state, narrator voice) is
                    // already durably persisted server-side by this point —
                    // via the early beat save and, once the job lands, the
                    // worker's own writes to beats + story_map. Marking this
                    // 'unsaved' would trigger the legacy full-session cloud
                    // save (asset scan + story_map rewrite) for a beat with
                    // nothing left to upload, racing the worker's own write
                    // to the same story row and surfacing a confusing "taking
                    // longer than usual" notice for a save that isn't needed.
                    saveStatus: 'saved',
                    loadingClues: [],
                    loadingStage: null,
                    loadingReader: null,
                    error: null,
                    errorAction: null,
                    ...(imageStillPending
                      ? { activeImageJobNodeIds: Array.from(new Set([...get().activeImageJobNodeIds, rootNodeId])) }
                      : {}),
                  });
                  if (imageStillPending) {
                    startImageJobPolling(savedStoryId);
                  }
                  dispatchPricingRuntimeRefresh();
                  logGenerationTiming({
                    scope: 'start_story',
                    totalMs: Math.round(nowMs() - generationStartedAt),
                    steps: timingSteps,
                    meta: {
                      success: true,
                      beatNumber: beat.beatNumber,
                      storyId: savedStoryId,
                      usedReferencePortraits: portraitRefs.length,
                      promptOnly,
                      serverPipeline: true,
                      imageWaitOutcome: jobOutcome?.imageStatus ?? 'pending',
                    },
                  });
                  return;
                }
                // legacy_mode / duplicate / error: the reservation is still ours —
                // fall through to inline generation below.
                console.warn('Opening image job enqueue did not queue; using inline generation:', enqueueResult.status);
              }
            }
          }

          // Step A: Generate portraits first (parallelized) so beat 1 scene can use
          // them as references - makes portrait the single source of truth from the very first image.
          // Beat 1 portraits are already resolved before storyboard rendering so Gemini can
          // use them as direct visual references during the first 2x2 board generation.
          setLoadingStage(set, 'start_story', 'image', { deferImages: promptOnly });
          const [imageResult, narratorVoiceResolution] = await Promise.all([
            promptOnly
              ? Promise.resolve({
                  imageUrl: '',
                  finalPromptText: buildFinalStoryboardImagePrompt(
                    storyboardPrompt,
                    beat.characters,
                    initialSession.visualStyle!,
                    beat.beatNumber,
                  modelOverrides,
                  {
                    aspectRatio: storyAspectRatio,
                    task: getImageTaskKey(storyConfig),
                    ...getReelVisualStylePromptOptions(modelOverrides, storyConfig),
                  }
                ),
              })
              : measureAsyncStep(
                  timingSteps,
                  getImageTaskKey(storyConfig),
                  'Render opening storyboard image',
                  async () => {
                    // The early save is a fast DB insert; waiting for it here
                    // lets the runtime persist the opening image server-side
                    // (durable, no base64 round trip) when the pipeline is on.
                    await earlySavePromise.catch(() => {});
                    return generateImage(
                      storyboardPrompt,
                      beat.characters,
                      initialSession.visualStyle!,
                      modelOverrides,
                      portraitRefs.length > 0 ? portraitRefs : undefined,
                      beat.beatNumber,
                      costPhase(baseCostTelemetry, getImageTaskKey(storyConfig), {
                        referenceCount: portraitRefs.length,
                      }),
                      storyAspectRatio,
                      getImageTaskKey(storyConfig),
                      getReelVisualStylePromptOptions(modelOverrides, storyConfig),
                      storyConfig.imageModelSelection,
                      imageContinuityOptions(storyConfig, portraitGenerationResult.latestState),
                      earlySavedStoryId
                        ? { persistTarget: { storyId: earlySavedStoryId, nodeId: rootNodeId } }
                        : undefined
                    );
                  },
                  {
                    referenceCount: portraitRefs.length,
                    beatNumber: beat.beatNumber,
                  }
                ),
            lockedVoicePromise,
          ]);

          beat.finalImagePromptText = imageResult.finalPromptText;
          beat.imageUrl = promptOnly ? undefined : imageResult.imageUrl;
          beat = applyImageGenerationResultMetadata(beat, imageResult);

          // Also await early save (should be done by now — DB insert is fast)
          await earlySavePromise;
          if (earlySavedStoryId) {
            earlySavedByUserId = (await resolveCurrentUserId()) ?? undefined;
            linkCostEventsToBeat({
              storySessionId: initialSessionId,
              storyId: earlySavedStoryId,
              nodeId: rootNodeId,
            }).catch((error) => console.error('Failed to link opening beat cost events:', error));
          }

          const openingImagePersisted = Boolean(
            ('imageGenerationMetadata' in imageResult
              ? (imageResult.imageGenerationMetadata as Record<string, unknown> | undefined)
              : undefined)?.persisted
          );
          if (earlySavedStoryId && imageResult.imageUrl && !openingImagePersisted) {
            const stagedForRecovery = await stageGeneratedBeatImageForLocalRecovery({
              storyId: earlySavedStoryId,
              userId: earlySavedByUserId,
              nodeId: rootNodeId,
              imageResult,
            });
            if (stagedForRecovery) {
              void retryPendingBeatAssetSyncInternal(earlySavedStoryId);
            }
          }

          if (reservationId) {
            setLoadingStage(set, 'start_story', 'finish');
            await measureAsyncStep(
              timingSteps,
              'billing_finalize',
              'Finalize story-start coin spend',
              () => finalizeImageAwareReservation({
                reservationId,
                actionKey: startStoryActionKey,
                fallbackIdempotencyKey: `start_story_prompt_only_fallback:${initialSessionId}`,
                relatedStoryId: earlySavedStoryId ?? null,
                relatedNodeId: rootNodeId,
                storyId: earlySavedStoryId ?? null,
                relatedEntityId: rootNodeId,
                metadata: {
                  action: startStoryActionKey,
                  storySessionId: initialSessionId,
                  title: resolvedTitle,
                },
                imageResult,
              })
            );
            shouldReleaseReservation = false;
          }

          // Update storyMap node with the final beat payload plus image/audio data.
          storyMap.nodes[rootNodeId] = {
            ...storyMap.nodes[rootNodeId],
            data: {
              ...normalizeBeatMediaFields({
                ...beat,
                persistedImageUrl: openingImagePersisted ? imageResult.imageUrl : undefined,
                imageStatus: promptOnly
                  ? 'not_requested'
                  : openingImagePersisted
                  ? 'ready'
                  : 'pending',
                // Narration is on-demand — the user triggers it per beat.
                audioStatus: 'not_requested',
              }),
              imageUrl: promptOnly ? undefined : imageResult.imageUrl,
              narrationVoiceId: narratorVoiceResolution.voiceId,
            },
          };

          const fullSession = deriveSessionFields(
            {
              ...initialSession,
              title: resolvedTitle,
              narratorVoice: narratorVoiceResolution.voiceId,
              narrationVoiceMode: narratorVoiceResolution.mode,
              narrationVoiceGenderBucket: narratorVoiceResolution.genderBucket ?? undefined,
              narrationLanguageCode: narratorVoiceResolution.languageCode,
              ...(earlySavedStoryId ? { savedStoryId: earlySavedStoryId } : {}),
              ...(earlySavedByUserId ? { savedByUserId: earlySavedByUserId } : {}),
            } as StorySession,
            storyMap
          );

          set({
            session: fullSession,
            isLoading: false,
            saveStatus: 'unsaved',
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: null,
            errorAction: null,
          });
          if (earlySavedStoryId) {
            const cleanRootNode = {
              ...storyMap.nodes[rootNodeId],
              data: {
                ...storyMap.nodes[rootNodeId].data,
                imageUrl: storyMap.nodes[rootNodeId].data.imageUrl?.startsWith('data:')
                  ? undefined
                  : storyMap.nodes[rootNodeId].data.imageUrl,
                audioUrl: storyMap.nodes[rootNodeId].data.audioUrl?.startsWith('data:')
                  ? undefined
                  : storyMap.nodes[rootNodeId].data.audioUrl,
                characters: storyMap.nodes[rootNodeId].data.characters.map((character) => ({
                  ...character,
                  portraitBase64: undefined,
                })),
              },
            };
            saveBeatAction(earlySavedStoryId, rootNodeId, cleanRootNode)
              .catch((err) => console.error('Opening beat save failed:', err));
          }
          dispatchPricingRuntimeRefresh();
          logGenerationTiming({
            scope: 'start_story',
            totalMs: Math.round(nowMs() - generationStartedAt),
            steps: timingSteps,
            meta: {
              success: true,
              beatNumber: beat.beatNumber,
              storyId: earlySavedStoryId ?? null,
              usedReferencePortraits: portraitRefs.length,
              promptOnly,
            },
          });
        } catch (error: any) {
          if (reservationId && shouldReleaseReservation) {
            try {
              await releaseCurrentUserBillableAction({
                reservationId,
                reason: 'start_story_failed',
                releaseStatus: 'failed',
                metadata: {
                  message: error?.message || 'Failed to start story',
                },
              });
            } catch (releaseError) {
              console.error('Failed to release start-story reservation:', releaseError);
            }
          }

          logGenerationTiming({
            scope: 'start_story',
            totalMs: Math.round(nowMs() - generationStartedAt),
            steps: timingSteps,
            meta: {
              success: false,
              failureStage: get().loadingStage?.currentStepKey ?? 'unknown',
              message: error?.message || 'Failed to start story',
            },
          });
          set({
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: error.message || 'Failed to start story',
            errorAction: null,
          });
        }
      },

      // Pack 2: starts Episode N+1 from a prepared continuation seed — the
      // inherited config recreates the origin universe, carried characters
      // seed the roster, and the series context flows into generation. The
      // branch bookkeeping is recorded fire-and-forget once the story saves.
      continueAsEpisode: async (premise: string, seed: EpisodeContinuationSeed) => {
        await get().startStory(premise, seed.inheritedConfig, {
          seedCharacters: seed.carriedCharacters,
          episodeContext: {
            branchId: seed.branchId,
            episodeNumber: seed.nextEpisodeNumber,
            parentStoryId: seed.parentStoryId,
            ...(seed.bible?.title ? { seriesTitle: seed.bible.title } : {}),
            ...(seed.bible?.bibleText ? { bibleText: seed.bible.bibleText } : {}),
            ...(seed.journalSummary ? { journalSummary: seed.journalSummary } : {}),
          },
        });
        const savedStoryId = get().session?.savedStoryId;
        if (savedStoryId) {
          void recordEpisodeStarted({ storyId: savedStoryId });
        }
      },

      startReel: async (prompt: string, config?: StoryConfig) => {
        const storyConfig = normalizeStoryConfig(config || DEFAULT_STORY_CONFIG);
        if (!isReelStoryConfig(storyConfig)) {
          return get().startStory(prompt, storyConfig);
        }

        const promptOnly = isPromptOnlyStoryConfig(storyConfig);
        const storyAspectRatio = getStoryAspectRatio(storyConfig);
        const startActionKey = getStartStoryActionKey(storyConfig);
        const beatCount = storyConfig.reel.beatCount;
        const visualStyle = deriveVisualStyleSummary(storyConfig.visualSettings);
        const initialSessionId = uuidv4();
        const rootNodeId = uuidv4();
        const baseCostTelemetry: CostTelemetryContext = {
          activityKey: startActionKey,
          storySessionId: initialSessionId,
          nodeId: rootNodeId,
          beatNumber: 1,
          metadata: {
            language: storyConfig.language,
            beatCount,
            imageGenerationMode: storyConfig.imageGenerationMode,
          },
        };

        let billingAuthorization: PricingBillableActionAuthorization;
        let reservationId: string | null = null;
        let shouldReleaseReservation = false;

        set({
          isLoading: true,
          error: null,
          errorAction: null,
          loadingClues: [LOADING_READER_MESSAGE],
          loadingStage: createStoryLoadingStage('start_story', 'wallet'),
          loadingReader: createInitialLoadingReader({
            flow: 'start_story',
            fallbackTitle: 'Your reel is coming together',
            fallbackText: prompt,
          }),
        });

        try {
          billingAuthorization = await authorizeCurrentUserImageModelBillableAction({
            actionKey: startActionKey,
            idempotencyKey: `start_reel:${initialSessionId}`,
            storyConfig,
            imageCount: beatCount,
            taskKey: getImageTaskKey(storyConfig),
            metadata: {
              language: storyConfig.language,
              beatCount,
              imageGenerationMode: storyConfig.imageGenerationMode,
            },
          });
        } catch (error: any) {
          set({
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: error?.message || 'Unable to check your wallet right now.',
            errorAction: null,
          });
          return;
        }

        const pricingErrorState = buildPricingErrorState(billingAuthorization, 'start_story');
        if (pricingErrorState) {
          set({
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: pricingErrorState.error,
            errorAction: pricingErrorState.errorAction,
          });
          return;
        }

        reservationId = getHardReservationId(billingAuthorization);
        shouldReleaseReservation = Boolean(reservationId);

        let modelOverrides: StoryModelOverrides | undefined;
        try {
          modelOverrides = await getStoryModelOverridesCached();
        } catch {
          // Non-critical: defaults are used when overrides can't be loaded
        }

        try {
          setLoadingStage(set, 'start_story', 'beat');

          const draftBeats = await generateReelDraft(
            prompt,
            storyConfig,
            modelOverrides,
            costPhase(baseCostTelemetry, 'reel_draft')
          );

          const requestedNarrationVoice = storyConfig.narrationVoice;
          const initialSession: Partial<StorySession> = {
            storySessionId: initialSessionId,
            userPrompt: prompt,
            title: draftBeats[0]?.title || 'Reel',
            genre: 'reel',
            tone: 'reflective',
            targetAge: storyConfig.ageGroup,
            visualStyle,
            currentBeat: 0,
            maxBeats: beatCount,
            status: 'active',
            characters: [],
            enableReferenceImages: false,
            setting: { world: 'unknown', timeOfDay: 'unknown', mood: 'unknown' },
            storyConfig,
            beats: [],
            choiceHistory: [],
            openThreads: [],
            allowedEndings: [],
            safetyProfile: 'all_ages',
            narratorVoice: requestedNarrationVoice?.mode === 'user_selected' ? requestedNarrationVoice.voiceId : undefined,
            narrationVoiceMode: requestedNarrationVoice?.mode,
            narrationVoiceGenderBucket: requestedNarrationVoice?.genderBucket,
            narrationLanguageCode: requestedNarrationVoice?.languageCode,
          };

          setLoadingStage(set, 'start_story', 'visual');

          const builtBeats: StoryBeat[] = [];
          const beatNodeIds: string[] = [];
          let storyMap: StoryMap | null = null;
          let parentNodeId = rootNodeId;

          for (let i = 0; i < draftBeats.length; i += 1) {
            const draft = draftBeats[i];
            const tempSession: Partial<StorySession> = {
              ...initialSession,
              beats: [...builtBeats],
              currentBeat: i,
            };
            let beat = applyReelBeatMetadata(draft, storyConfig);

            const plan = await composeStoryboardPlan(
              beat,
              tempSession,
              visualStyle,
              modelOverrides,
              costPhase(baseCostTelemetry, 'storyboard_plan', { beatNumber: beat.beatNumber })
            );
            beat.storyboardPlan = plan;
            beat.storyboardPromptText = renderStoryboardPlan(plan);
            beat.isStoryboard = true;
            beat.reelCaptions = buildReelPanelCaptions(beat, plan, {
              textLength: storyConfig.reel.textLength,
              reelSettings: modelOverrides?.reelSettings,
              storyConfig,
            });

            const storyboardPrompt = beat.storyboardPromptText;

            if (promptOnly) {
              beat.finalImagePromptText = buildFinalStoryboardImagePrompt(
                storyboardPrompt,
                [],
                visualStyle,
                beat.beatNumber,
                modelOverrides,
                {
                  aspectRatio: storyAspectRatio,
                  task: getImageTaskKey(storyConfig),
                  ...getReelVisualStylePromptOptions(modelOverrides, storyConfig),
                }
              );
              beat.imageUrl = undefined;
              beat.imageStatus = 'not_requested';
            } else {
              setLoadingStage(set, 'start_story', 'image');
              const imageResult = await generateImage(
                storyboardPrompt,
                [],
                visualStyle,
                modelOverrides,
                undefined,
                beat.beatNumber,
                costPhase(baseCostTelemetry, getImageTaskKey(storyConfig), { beatNumber: beat.beatNumber }),
                storyAspectRatio,
                getImageTaskKey(storyConfig),
                getReelVisualStylePromptOptions(modelOverrides, storyConfig),
                storyConfig.imageModelSelection
              );
              beat.imageUrl = imageResult.imageUrl;
              beat.finalImagePromptText = imageResult.finalPromptText;
              beat = applyImageGenerationResultMetadata(beat, imageResult);
              beat.imageStatus = 'pending';
            }

            builtBeats.push(beat);

            if (i === 0) {
              storyMap = createStoryMap(beat, rootNodeId);
              beatNodeIds.push(rootNodeId);
              parentNodeId = rootNodeId;
            } else {
              const newId = uuidv4();
              storyMap = addChildNode(storyMap!, parentNodeId, '', beat, newId);
              beatNodeIds.push(newId);
              parentNodeId = newId;
            }
          }

          if (!storyMap || builtBeats.length === 0) {
            throw new Error('Reel generation produced no beats.');
          }

          const finalMap: StoryMap = { ...storyMap, currentNodeId: rootNodeId };

          let savedStoryId: string | undefined;
          try {
            const result = await saveStoryAction(
              {
                ...(initialSession as StorySession),
                title: builtBeats[0]?.title || 'Reel',
                currentBeat: builtBeats.length,
                beats: builtBeats,
              } as StorySession,
              finalMap
            );
            savedStoryId = result.storyId;
          } catch (err) {
            console.error('Reel early save failed:', err);
          }

          if (savedStoryId) {
            const recoveryUserId = await resolveCurrentUserId(initialSession.savedByUserId);
            let stagedAnyReelImage = false;
            for (let i = 0; i < builtBeats.length; i += 1) {
              const staged = await stageGeneratedBeatImageForLocalRecovery({
                storyId: savedStoryId,
                userId: recoveryUserId,
                nodeId: beatNodeIds[i],
                imageResult: {
                  imageUrl: builtBeats[i]?.imageUrl,
                  imageGenerationMetadata: builtBeats[i]?.imageGenerationMetadata,
                },
              });
              stagedAnyReelImage = stagedAnyReelImage || staged;
            }
            if (stagedAnyReelImage) {
              void retryPendingBeatAssetSyncInternal(savedStoryId);
            }
          }

          if (reservationId) {
            setLoadingStage(set, 'start_story', 'finish');
            try {
              await finalizeImageAwareReservation({
                reservationId,
                actionKey: startActionKey,
                fallbackIdempotencyKey: `start_reel_prompt_only_fallback:${initialSessionId}`,
                relatedStoryId: savedStoryId ?? null,
                relatedNodeId: rootNodeId,
                storyId: savedStoryId ?? null,
                relatedEntityId: rootNodeId,
                metadata: {
                  action: startActionKey,
                  storySessionId: initialSessionId,
                  beatCount,
                },
                imageResult: {
                  imageModelSnapshot: builtBeats.find((beat) => beat.imageGenerationMetadata?.imageModelSnapshot)
                    ?.imageGenerationMetadata?.imageModelSnapshot as import('@/lib/ai/image-models.shared').ImageModelSnapshot | undefined,
                  imageGenerationMetadata: builtBeats.some((beat) => beat.imageGenerationMetadata?.placeholder)
                    ? { placeholder: true, reason: 'one_or_more_reel_images_placeholder' }
                    : builtBeats.find((beat) => beat.imageGenerationMetadata)?.imageGenerationMetadata,
                },
              });
              shouldReleaseReservation = false;
            } catch (err) {
              console.error('Failed to finalize reel billing reservation:', err);
            }
          }

          const finalSession = {
            ...initialSession,
            savedStoryId,
            currentBeat: builtBeats.length,
            beats: builtBeats,
            storyMap: finalMap,
          } as StorySession;

          set({
            session: deriveSessionFields(finalSession, finalMap),
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
          });

          // Reel narration is on-demand only — user triggers it via the speaker icon.
        } catch (error: any) {
          console.error('Reel generation failed:', error);
          if (shouldReleaseReservation && reservationId) {
            releaseCurrentUserBillableAction({
              reservationId,
              reason: 'reel_generation_failed',
              releaseStatus: 'failed',
            }).catch(() => {});
          }
          set({
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: error?.message || 'Failed to generate reel',
            errorAction: null,
          });
        }
      },

      continueStory: async (optionId: string) => {
        const { session } = get();
        if (!session) return;

        const currentNode = getCurrentNode(session.storyMap);
        const selectedOption = currentNode.data.options.find((o) => o.id === optionId);
        if (!selectedOption) return;
        const nextCanonicalSeedBeat =
          isSeededStoryConfig(session.storyConfig) && isCanonicalSeedOption(currentNode.data, optionId)
            ? getSeedBeatByIndex(session.storyConfig, currentNode.data.beatNumber + 1)
            : undefined;
        const promptOnly = defersLiveImageGeneration(session.storyConfig);
        const storyAspectRatio = getStoryAspectRatio(session.storyConfig);
        const continueStoryActionKey = getContinueStoryActionKey(session.storyConfig);
        const generationStartedAt = nowMs();
        const timingSteps: GenerationTimingStep[] = [];

        // Check if branch already exists — instant load, no API call
        const existingChildId = findChildForOption(session.storyMap, session.storyMap.currentNodeId, optionId);
        if (existingChildId) {
          const updatedMap = { ...session.storyMap, currentNodeId: existingChildId };
          set({ session: deriveSessionFields(session, updatedMap) });
          return;
        }

        const parentId = session.storyMap.currentNodeId;
        const newNodeId = uuidv4();
        const baseCostTelemetry: CostTelemetryContext = {
          activityKey: continueStoryActionKey,
          storySessionId: session.storySessionId,
          storyId: session.savedStoryId ?? null,
          nodeId: newNodeId,
          beatNumber: currentNode.data.beatNumber + 1,
          metadata: {
            parentNodeId: parentId,
            selectedOptionId: optionId,
            authoringMode: session.storyConfig.authoring.mode,
            language: session.storyConfig.language,
          },
        };

        // No existing branch - show the reader immediately while access is checked.
        set({
          isLoading: true,
          error: null,
          errorAction: null,
          loadingClues: currentNode.data.clues.length > 0
            ? currentNode.data.clues
            : [LOADING_READER_MESSAGE],
          loadingStage: createStoryLoadingStage('continue_story', 'wallet'),
          loadingReader: createInitialLoadingReader({
            flow: 'continue_story',
            selectedOptionLabel: selectedOption.label,
            fallbackTitle: currentNode.data.title,
            fallbackText: currentNode.data.storyText,
          }),
        });

        // Beat bundle (flag-gated): two server round-trips replace the legacy
        // authorize → generate → plan → save → enqueue client orchestration.
        // Seeded-canonical, prompt-only, shared-source, and mock continuations
        // stay on the legacy path; any 'legacy' answer falls through below.
        if (
          !promptOnly
          && !nextCanonicalSeedBeat
          && !isSeededStoryConfig(session.storyConfig)
          && Boolean(session.savedStoryId)
          && !session.sourceStoryOwnerId
          && session.userPrompt.toLowerCase() !== 'mock'
        ) {
          let bundleMode: 'legacy' | 'bundle' = 'legacy';
          try {
            bundleMode = await resolveBeatGenerationModeCached();
          } catch { /* resolver failure = legacy */ }

          if (bundleMode === 'bundle') {
            const runContinueStoryBundle = async (): Promise<boolean> => {
              const savedStoryId = session.savedStoryId!;
              // Linear-path context, exactly as the legacy flow builds it.
              const beatsForPrompt = getBeatsToNode(session.storyMap, session.storyMap.currentNodeId);
              const selectedOptionPrompt = formatSelectedOptionForPrompt(selectedOption);
              const choiceHistoryForPrompt = [
                ...getChoiceHistoryToNode(session.storyMap, session.storyMap.currentNodeId),
                formatChoiceHistoryOption(selectedOption),
              ];
              const sessionForPrompt: Partial<StorySession> = {
                ...session,
                beats: beatsForPrompt,
                choiceHistory: choiceHistoryForPrompt,
              };
              delete (sessionForPrompt as any).storyMap;
              delete (sessionForPrompt as any).narratorVoice;
              delete (sessionForPrompt as any).narrationVoiceMode;
              delete (sessionForPrompt as any).narrationVoiceGenderBucket;
              delete (sessionForPrompt as any).narrationLanguageCode;

              // The locked voice resolves in parallel with the core round-trip.
              const voiceResolutionPromise = resolveNarratorVoice(session, costPhase(baseCostTelemetry, 'voice_selection'));
              voiceResolutionPromise.catch(() => { /* surfaced where awaited */ });

              setLoadingStage(set, 'continue_story', 'beat');
              const core = await measureAsyncStep(
                timingSteps,
                'beat_bundle_core',
                'Generate continued beat and plan (bundle)',
                () => generateBeatCore({
                  userPrompt: session.userPrompt,
                  sessionForPrompt,
                  selectedOptionLabel: selectedOptionPrompt,
                  visualStyle: session.visualStyle,
                  authorize: {
                    actionKey: continueStoryActionKey,
                    idempotencyKey: `continue_story:${savedStoryId}:${session.storyMap.currentNodeId}:${optionId}:${uuidv4()}`,
                    relatedStoryId: savedStoryId,
                    relatedNodeId: session.storyMap.currentNodeId,
                    storyConfig: session.storyConfig,
                    imageCount: 1,
                    taskKey: getImageTaskKey(session.storyConfig),
                    metadata: {
                      selectedOptionId: optionId,
                      selectedOptionLabel: selectedOption.label,
                      currentBeat: currentNode.data.beatNumber,
                      beatBundle: true,
                    },
                  },
                  storyTelemetry: costPhase(baseCostTelemetry, 'story_generation'),
                  composerTelemetry: costPhase(baseCostTelemetry, 'storyboard_plan'),
                })
              );

              if (core.status === 'legacy') {
                return false;
              }
              if (core.status === 'blocked') {
                const pricingErrorState = buildPricingErrorState(core.authorization, 'continue_story');
                set({
                  isLoading: false,
                  loadingClues: [],
                  loadingStage: null,
                  loadingReader: null,
                  error: pricingErrorState?.error ?? 'Unable to check your wallet right now.',
                  errorAction: pricingErrorState?.errorAction ?? null,
                });
                return true;
              }

              let beat = enforceReelBeatCap(core.beat, session.storyConfig);
              const storyboardPlan = core.storyboardPlan;
              beat.storyboardPlan = storyboardPlan;
              beat.storyboardPromptText = renderStoryboardPlan(storyboardPlan);
              beat.isStoryboard = true;
              beat = applyStoryTextOverlayBeatMetadata(beat, session.storyConfig);

              set((state) => ({
                loadingClues: beat.clues,
                loadingReader: updateLoadingReaderWithBeat(state.loadingReader, 'continue_story', beat),
              }));
              setLoadingStage(set, 'continue_story', 'visual');

              const voiceResolution = await measureAsyncStep(
                timingSteps,
                'voice_resolution',
                'Resolve locked narrator voice',
                () => voiceResolutionPromise
              );
              const voiceForBeat = voiceResolution.voiceId;
              const narrationLanguageCode = voiceResolution.languageCode;

              const parentImageContinuityState = extractImageContinuityState(currentNode.data.imageGenerationMetadata);
              setLoadingStage(set, 'continue_story', 'image', { note: IMAGE_JOB_SAFE_TO_LEAVE_NOTE });
              let visuals: Awaited<ReturnType<typeof processBeatVisuals>>;
              try {
                visuals = await measureAsyncStep(
                  timingSteps,
                  'beat_bundle_visuals',
                  'Persist beat and queue image (bundle)',
                  () => processBeatVisuals({
                    target: {
                      kind: 'existing',
                      storyId: savedStoryId,
                      nodeId: newNodeId,
                      parentNodeId: parentId,
                      selectedOptionId: optionId,
                    },
                    beat,
                    storyboardPlan,
                    visualStyle: session.visualStyle,
                    storyConfig: session.storyConfig,
                    storyAspectRatio,
                    reservationId: core.reservationId,
                    narrationVoiceId: voiceForBeat,
                    previousImageUrl: currentNode.data.imageUrl ?? null,
                    parentContinuityState: parentImageContinuityState ?? null,
                    imageContinuityStrategy: session.storyConfig.imageContinuityStrategy,
                    storySessionId: session.storySessionId,
                    portraitTelemetry: costPhase(baseCostTelemetry, 'portrait_generation'),
                    imageTelemetry: costPhase(baseCostTelemetry, getImageTaskKey(session.storyConfig), { beatBundle: true }),
                  })
                );
              } catch (error: any) {
                await releaseBundleReservation(core.reservationId, 'beat_bundle_visuals_failed');
                throw error;
              }

              if (visuals.status !== 'queued') {
                await releaseBundleReservation(core.reservationId, `beat_bundle_${visuals.reason}`);
                throw new Error(visuals.message || "The next beat couldn't be saved. Please try again.");
              }
              const queued = visuals;

              const jobOutcome = await measureAsyncStep(
                timingSteps,
                'image_job_wait',
                'Wait for background image render',
                () => waitForQueuedBeatImage(savedStoryId, newNodeId)
              );
              const imageStillPending = !jobOutcome;
              const pendingNodeData = {
                ...normalizeBeatMediaFields({
                  ...queued.beat,
                  imageUrl: undefined,
                  persistedImageUrl: undefined,
                  imageStatus: 'pending' as const,
                  imageError: undefined,
                  audioStatus: 'not_requested' as const,
                  audioError: undefined,
                }),
                narrationVoiceId: voiceForBeat,
              };
              const settledNodeData = jobOutcome?.imageStatus === 'ready'
                ? {
                    ...pendingNodeData,
                    imageUrl: jobOutcome.imageUrl,
                    persistedImageUrl: jobOutcome.imageUrl,
                    imageStatus: 'ready' as const,
                    imageError: undefined,
                  }
                : jobOutcome?.imageStatus === 'failed'
                  ? {
                      ...pendingNodeData,
                      imageStatus: 'failed' as const,
                      imageError: jobOutcome.imageError ?? 'Image generation failed. You can retry it from the story.',
                    }
                  : pendingNodeData;

              const updatedMap = addChildNode(
                session.storyMap,
                session.storyMap.currentNodeId,
                optionId,
                settledNodeData,
                newNodeId
              );
              const latestSession = get().session;
              if (!latestSession) return true;
              const mergedMap = {
                ...updatedMap,
                nodes: {
                  ...updatedMap.nodes,
                  ...latestSession.storyMap.nodes,
                  [parentId]: {
                    ...(latestSession.storyMap.nodes[parentId] || updatedMap.nodes[parentId]),
                    children: updatedMap.nodes[parentId].children,
                  },
                  [newNodeId]: updatedMap.nodes[newNodeId],
                },
              };

              set({
                session: deriveSessionFields(
                  {
                    ...latestSession,
                    narratorVoice: voiceForBeat,
                    narrationVoiceMode: voiceResolution.mode,
                    narrationVoiceGenderBucket: voiceResolution.genderBucket ?? undefined,
                    narrationLanguageCode,
                  },
                  mergedMap
                ),
                isLoading: false,
                // Beat text is already durably persisted server-side and the
                // worker owns the image writes — same reasoning as the legacy
                // server_pipeline branch.
                saveStatus: 'saved',
                loadingClues: [],
                loadingStage: null,
                loadingReader: null,
                error: null,
                errorAction: null,
                ...(imageStillPending
                  ? { activeImageJobNodeIds: Array.from(new Set([...get().activeImageJobNodeIds, newNodeId])) }
                  : {}),
              });
              if (imageStillPending) {
                startImageJobPolling(savedStoryId);
              }
              dispatchPricingRuntimeRefresh();
              logGenerationTiming({
                scope: 'continue_story',
                totalMs: Math.round(nowMs() - generationStartedAt),
                steps: timingSteps,
                meta: {
                  success: true,
                  beatNumber: beat.beatNumber,
                  storyId: queued.storyId,
                  promptOnly,
                  serverPipeline: true,
                  beatBundle: true,
                  imageWaitOutcome: jobOutcome?.imageStatus ?? 'pending',
                },
              });
              return true;
            };

            try {
              if (await runContinueStoryBundle()) {
                return;
              }
              // Server said legacy — continue with the untouched flow below.
            } catch (error: any) {
              logGenerationTiming({
                scope: 'continue_story',
                totalMs: Math.round(nowMs() - generationStartedAt),
                steps: timingSteps,
                meta: {
                  success: false,
                  failureStage: 'beat_bundle',
                  optionId,
                  message: error?.message || 'Beat generation failed.',
                },
              });
              set({
                isLoading: false,
                loadingClues: [],
                loadingStage: null,
                loadingReader: null,
                error: error?.message || "The next beat couldn't be generated. Please try again.",
                errorAction: null,
              });
              return;
            }
          }
        }

        // Independent of wallet authorization — run both round-trips in parallel.
        const modelOverridesPromise = getStoryModelOverridesCached().catch(() => undefined);
        let billingAuthorization: PricingBillableActionAuthorization;
        try {
          billingAuthorization = await measureAsyncStep(
            timingSteps,
            'wallet_authorization',
            'Authorize branch continuation',
            () => authorizeCurrentUserImageModelBillableAction({
              actionKey: continueStoryActionKey,
              idempotencyKey: `continue_story:${session.savedStoryId || session.storySessionId}:${session.storyMap.currentNodeId}:${optionId}:${uuidv4()}`,
              relatedStoryId: session.savedStoryId ?? null,
              relatedNodeId: session.storyMap.currentNodeId,
              storyConfig: session.storyConfig,
              imageCount: 1,
              taskKey: getImageTaskKey(session.storyConfig),
              metadata: {
                selectedOptionId: optionId,
                selectedOptionLabel: selectedOption.label,
                currentBeat: currentNode.data.beatNumber,
              },
            }),
            {
              currentBeat: currentNode.data.beatNumber,
              selectedOptionId: optionId,
            }
          );
        } catch (error: any) {
          logGenerationTiming({
            scope: 'continue_story',
            totalMs: Math.round(nowMs() - generationStartedAt),
            steps: timingSteps,
            meta: {
              success: false,
              failureStage: 'wallet_authorization',
              optionId,
              message: error?.message || 'Unable to check your wallet right now.',
            },
          });
          set({
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: error?.message || 'Unable to check your wallet right now.',
            errorAction: null,
          });
          return;
        }

        const pricingErrorState = buildPricingErrorState(billingAuthorization, 'continue_story');
        if (pricingErrorState) {
          set({
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: pricingErrorState.error,
            errorAction: pricingErrorState.errorAction,
          });
          return;
        }

        // No existing branch — generate new beat
        const reservationId = getHardReservationId(billingAuthorization);
        let shouldReleaseReservation = Boolean(reservationId);

        try {
          // Build session state for Gemini with linear path beats
          const beatsForPrompt = getBeatsToNode(session.storyMap, session.storyMap.currentNodeId);
          const selectedOptionPrompt = formatSelectedOptionForPrompt(selectedOption);
          const choiceHistoryForPrompt = [
            ...getChoiceHistoryToNode(session.storyMap, session.storyMap.currentNodeId),
            formatChoiceHistoryOption(selectedOption),
          ];
          const sessionForPrompt: Partial<StorySession> = {
            ...session,
            beats: beatsForPrompt,
            choiceHistory: choiceHistoryForPrompt,
          };
          // Strip storyMap and heavy data from what we send to Gemini
          delete (sessionForPrompt as any).storyMap;
          delete (sessionForPrompt as any).narratorVoice;
          delete (sessionForPrompt as any).narrationVoiceMode;
          delete (sessionForPrompt as any).narrationVoiceGenderBucket;
          delete (sessionForPrompt as any).narrationLanguageCode;

          // Active model config, kicked off before authorization above
          // (non-blocking fallback to defaults)
          const modelOverrides: StoryModelOverrides | undefined = await measureAsyncStep(
            timingSteps,
            'model_overrides',
            'Load model and prompt overrides',
            () => modelOverridesPromise
          );

          // The locked voice depends only on session settings, so resolve it in
          // parallel with beat/image generation (mirrors startStory).
          const voiceResolutionPromise = resolveNarratorVoice(session, costPhase(baseCostTelemetry, 'voice_selection'));
          voiceResolutionPromise.catch(() => { /* surfaced where awaited below */ });

          setLoadingStage(set, 'continue_story', 'beat');
          let beat = await measureAsyncStep(
            timingSteps,
            nextCanonicalSeedBeat ? 'seeded_beat_materialization' : 'story_generation',
            nextCanonicalSeedBeat ? 'Materialize seeded canonical beat' : 'Generate continued beat',
            async () => {
              if (nextCanonicalSeedBeat) {
                return materializeSeededBeat(
                  nextCanonicalSeedBeat,
                  sessionForPrompt,
                  modelOverrides,
                  costPhase(baseCostTelemetry, 'beat_materialization')
                );
              }

              return withGeneratedOrigin(
                await generateStoryBeat(
                  session.userPrompt,
                  sessionForPrompt,
                  selectedOptionPrompt,
                  modelOverrides,
                  costPhase(baseCostTelemetry, 'story_generation')
                )
              );
            },
            {
              selectedOptionId: optionId,
              selectedOptionLabel: selectedOption.label,
              selectedOptionIntent: selectedOption.intent,
              isCanonicalSeedPath: Boolean(nextCanonicalSeedBeat),
            }
          );
          beat = enforceReelBeatCap(
            mergeCharacterVisualReferences(beat, sessionForPrompt.characters || []),
            session.storyConfig
          );

          set((state) => ({
            loadingClues: beat.clues,
            loadingReader: updateLoadingReaderWithBeat(state.loadingReader, 'continue_story', beat),
          }));

          setLoadingStage(set, 'continue_story', 'visual');
          const storyboardPlan = await measureAsyncStep(
            timingSteps,
            'storyboard_plan',
            'Compose storyboard plan',
            () => composeStoryboardPlan(
              beat,
              sessionForPrompt,
              session.visualStyle,
              modelOverrides,
              costPhase(baseCostTelemetry, 'storyboard_plan')
            )
          );
          beat.storyboardPlan = storyboardPlan;
          beat.storyboardPromptText = renderStoryboardPlan(storyboardPlan);
          beat.isStoryboard = true;
          if (isReelStoryConfig(session.storyConfig)) {
            beat = applyReelBeatMetadata(beat, session.storyConfig);
            beat.reelCaptions = buildReelPanelCaptions(beat, storyboardPlan, {
              textLength: session.storyConfig.reel.textLength,
              reelSettings: modelOverrides?.reelSettings,
            });
          } else {
            beat = applyStoryTextOverlayBeatMetadata(beat, session.storyConfig);
          }
          const parentImageContinuityState = extractImageContinuityState(currentNode.data.imageGenerationMetadata);
          const portraitGenerationResult = session.enableReferenceImages && !promptOnly
            ? await measureAsyncStep(
                timingSteps,
                'portrait_generation',
                'Generate reference portraits',
                () => generatePortraitsForStoryboardPlan(
                  beat,
                  storyboardPlan,
                  session.visualStyle,
                  session.storyConfig.portraitReferences,
                  modelOverrides,
                  costPhase(baseCostTelemetry, 'portrait_generation'),
                  session.storyConfig.imageModelSelection,
                  imageContinuityOptions(session.storyConfig, parentImageContinuityState)
                ),
                {
                  portraitTaskCount: storyboardPlan.portraitTasks.length,
                  portraitReferenceMode: session.storyConfig.portraitReferences.mode,
                  portraitReferenceQuality: session.storyConfig.portraitReferences.quality,
                }
              )
            : { references: [], latestState: parentImageContinuityState };
          const portraitRefs = session.enableReferenceImages && !promptOnly
            ? mergeReferenceImages(collectBeatPortraitReferences(beat), portraitGenerationResult.references)
            : [];
          if (promptOnly) {
            assignPortraitPromptTexts(
              beat,
              storyboardPlan,
              session.visualStyle,
              session.storyConfig.portraitReferences,
              modelOverrides
            );
          }
          const storyboardPrompt = beat.storyboardPromptText || renderStoryboardPlan(storyboardPlan);

          // Narration is on-demand (user clicks the speaker icon on the beat),
          // but the locked voice is still resolved here so the beat records the
          // voice it will narrate with. Resolution started before beat generation.
          const voiceResolution = await measureAsyncStep(
            timingSteps,
            'voice_resolution',
            'Resolve locked narrator voice',
            () => voiceResolutionPromise
          );
          const voiceForBeat = voiceResolution.voiceId;
          const narrationLanguageCode = voiceResolution.languageCode;
          if (
            session.narratorVoice !== voiceForBeat
            || session.narrationVoiceMode !== voiceResolution.mode
            || session.narrationVoiceGenderBucket !== (voiceResolution.genderBucket ?? undefined)
            || session.narrationLanguageCode !== narrationLanguageCode
          ) {
            set((state) => state.session ? {
              session: {
                ...state.session,
                narratorVoice: voiceForBeat,
                narrationVoiceMode: voiceResolution.mode,
                narrationVoiceGenderBucket: voiceResolution.genderBucket ?? undefined,
                narrationLanguageCode,
              },
            } : state);
          }

          const referenceImages = buildStoryboardReferenceImages(
            beat,
            currentNode.data.imageUrl,
            portraitRefs
          );
          const worldRouting = resolveBeatWorldRouting(session, beat);
          if (worldRouting.worldReferenceImage) {
            referenceImages.push(worldRouting.worldReferenceImage);
          }

          // Server-pipeline routing (admin processing mode): persist the beat
          // text server-side immediately, then hand the image to a durable
          // background job — from here the browser can close without losing
          // anything. Requires a saved story owned by this user.
          let effectiveImageMode: 'client_legacy' | 'server_pipeline' = 'client_legacy';
          if (
            !promptOnly
            && session.savedStoryId
            && !session.sourceStoryOwnerId
            && session.userPrompt.toLowerCase() !== 'mock'
          ) {
            try {
              effectiveImageMode = await resolveImageProcessingModeCached();
            } catch {
              // Resolver failure = legacy; the server re-checks on enqueue anyway.
            }
          }

          if (effectiveImageMode === 'server_pipeline' && session.savedStoryId) {
            const savedStoryId = session.savedStoryId;
            // The worker replays generateSelectedImage with this exact final
            // prompt — built here because the prompt orchestrator is client code.
            const jobFinalPrompt = buildFinalStoryboardImagePrompt(
              storyboardPrompt,
              beat.characters,
              session.visualStyle,
              beat.beatNumber,
              modelOverrides,
              {
                aspectRatio: storyAspectRatio,
                task: getImageTaskKey(session.storyConfig),
                ...getReelVisualStylePromptOptions(modelOverrides, session.storyConfig),
              }
            );
            beat.finalImagePromptText = jobFinalPrompt;

            // Durable early save: the beat text (with parent link and cursor)
            // lands in beats + story_map before any image work starts.
            const durableNode: StoryNode = {
              id: newNodeId,
              beatNumber: beat.beatNumber,
              parentId,
              selectedOptionId: optionId,
              data: normalizeBeatMediaFields({
                ...beat,
                imageUrl: undefined,
                persistedImageUrl: undefined,
                narrationVoiceId: voiceForBeat,
                imageStatus: 'pending',
                imageError: undefined,
                audioStatus: 'not_requested',
                audioError: undefined,
                characters: beat.characters.map((character) => ({
                  ...character,
                  portraitBase64: undefined,
                })),
              }),
              children: [],
            };

            setLoadingStage(set, 'continue_story', 'image');
            let earlySaved = false;
            try {
              const { beatId } = await measureAsyncStep(
                timingSteps,
                'early_beat_save',
                'Persist beat before image job',
                () => saveBeatAction(savedStoryId, newNodeId, durableNode, {
                  linkToParent: true,
                  setAsCurrent: true,
                })
              );
              earlySaved = true;
              linkCostEventsToBeat({
                storySessionId: session.storySessionId,
                storyId: savedStoryId,
                nodeId: newNodeId,
                beatId,
              }).catch((err) => console.error('Failed to link branch beat cost events:', err));
            } catch (err) {
              console.error('Early beat save failed; falling back to inline image generation:', err);
            }

            if (earlySaved) {
              const enqueueResult = await measureAsyncStep(
                timingSteps,
                'image_job_enqueue',
                'Queue background image job',
                () => enqueueBeatImageJob({
                  storyId: savedStoryId,
                  nodeId: newNodeId,
                  kind: isReelStoryConfig(session.storyConfig) ? 'reel_image' : 'beat_image',
                  beatNumber: beat.beatNumber,
                  reservationId,
                  payload: {
                    finalPrompt: jobFinalPrompt,
                    beatNumber: beat.beatNumber,
                    aspectRatio: storyAspectRatio,
                    imageTask: getImageTaskKey(session.storyConfig),
                    imageSize: normalizeStoryboardImageQualitySettings(modelOverrides?.storyboardImageSettings).imageSize,
                    imageModelSelection: session.storyConfig.imageModelSelection ?? null,
                    imageContinuity: imageContinuityOptions(
                      session.storyConfig,
                      portraitGenerationResult.latestState
                    ) ?? null,
                    costTelemetry: costPhase(baseCostTelemetry, getImageTaskKey(session.storyConfig), {
                      referenceCount: referenceImages.length,
                    }),
                    references: referenceImages,
                  },
                })
              );

              if (enqueueResult.status === 'queued') {
                // The worker owns the reservation now (finalizes on ready,
                // releases on terminal failure).
                shouldReleaseReservation = false;

                // Everything is durable from here — tell the user they may
                // leave, but keep the preloader on the image stage so a user
                // who stays receives the beat complete with its image
                // (background delivery is the safety net, not the UX).
                setLoadingStage(set, 'continue_story', 'image', { note: IMAGE_JOB_SAFE_TO_LEAVE_NOTE });
                const jobOutcome = await measureAsyncStep(
                  timingSteps,
                  'image_job_wait',
                  'Wait for background image render',
                  () => waitForQueuedBeatImage(savedStoryId, newNodeId)
                );
                const imageStillPending = !jobOutcome;
                const settledNodeData = jobOutcome?.imageStatus === 'ready'
                  ? {
                      ...durableNode.data,
                      imageUrl: jobOutcome.imageUrl,
                      persistedImageUrl: jobOutcome.imageUrl,
                      imageStatus: 'ready' as const,
                      imageError: undefined,
                    }
                  : jobOutcome?.imageStatus === 'failed'
                    ? {
                        ...durableNode.data,
                        imageStatus: 'failed' as const,
                        imageError: jobOutcome.imageError ?? 'Image generation failed. You can retry it from the story.',
                      }
                    : durableNode.data;

                const updatedMap = addChildNode(
                  session.storyMap,
                  session.storyMap.currentNodeId,
                  optionId,
                  settledNodeData,
                  newNodeId
                );
                const latestSession = get().session;
                if (!latestSession) return;
                const mergedMap = {
                  ...updatedMap,
                  nodes: {
                    ...updatedMap.nodes,
                    ...latestSession.storyMap.nodes,
                    [parentId]: {
                      ...(latestSession.storyMap.nodes[parentId] || updatedMap.nodes[parentId]),
                      children: updatedMap.nodes[parentId].children,
                    },
                    [newNodeId]: updatedMap.nodes[newNodeId],
                  },
                };

                set({
                  session: deriveSessionFields(
                    {
                      ...latestSession,
                      narratorVoice: voiceForBeat,
                      narrationVoiceMode: voiceResolution.mode,
                      narrationVoiceGenderBucket: voiceResolution.genderBucket ?? undefined,
                      narrationLanguageCode,
                    },
                    mergedMap
                  ),
                  isLoading: false,
                  // Same reasoning as the opening-beat branch in startStory:
                  // the branch beat is already durably persisted (early save
                  // + worker writes), so there's nothing left for the legacy
                  // full-session save to do — and running it anyway races
                  // the worker's own story_map write and produces a
                  // misleading "cloud save taking longer" notice.
                  saveStatus: 'saved',
                  loadingClues: [],
                  loadingStage: null,
                  loadingReader: null,
                  error: null,
                  errorAction: null,
                  ...(imageStillPending
                    ? { activeImageJobNodeIds: Array.from(new Set([...get().activeImageJobNodeIds, newNodeId])) }
                    : {}),
                });
                if (imageStillPending) {
                  startImageJobPolling(savedStoryId);
                }
                dispatchPricingRuntimeRefresh();
                logGenerationTiming({
                  scope: 'continue_story',
                  totalMs: Math.round(nowMs() - generationStartedAt),
                  steps: timingSteps,
                  meta: {
                    success: true,
                    beatNumber: beat.beatNumber,
                    optionId,
                    optionLabel: selectedOption.label,
                    newNodeId,
                    usedReferenceImages: referenceImages.length,
                    promptOnly,
                    serverPipeline: true,
                    imageWaitOutcome: jobOutcome?.imageStatus ?? 'pending',
                  },
                });
                return;
              }
              // legacy_mode / duplicate / error: the reservation is still ours —
              // fall through to inline generation below.
              console.warn('Image job enqueue did not queue; using inline generation:', enqueueResult.status);
            }
          }

          // Block loading on image only
          setLoadingStage(set, 'continue_story', 'image', { deferImages: promptOnly });
          const imageResult = promptOnly
            ? {
                imageUrl: '',
                finalPromptText: buildFinalStoryboardImagePrompt(
                  storyboardPrompt,
                  beat.characters,
                  session.visualStyle,
                  beat.beatNumber,
                  modelOverrides,
                  {
                    aspectRatio: storyAspectRatio,
                    task: getImageTaskKey(session.storyConfig),
                    ...getReelVisualStylePromptOptions(modelOverrides, session.storyConfig),
                  }
                ),
              }
            : await measureAsyncStep(
                timingSteps,
                getImageTaskKey(session.storyConfig),
                'Render branch storyboard image',
                () => generateImage(
                  storyboardPrompt,
                  beat.characters,
                  session.visualStyle,
                  modelOverrides,
                  referenceImages.length > 0 ? referenceImages : undefined,
                  beat.beatNumber,
                  costPhase(baseCostTelemetry, getImageTaskKey(session.storyConfig), {
                    referenceCount: referenceImages.length,
                  }),
                  storyAspectRatio,
                  getImageTaskKey(session.storyConfig),
                  { ...getReelVisualStylePromptOptions(modelOverrides, session.storyConfig), ...(worldRouting.worldAnchor ? { worldAnchor: worldRouting.worldAnchor } : {}) },
                  session.storyConfig.imageModelSelection,
                  imageContinuityOptions(session.storyConfig, portraitGenerationResult.latestState),
                  session.savedStoryId
                    ? { persistTarget: { storyId: session.savedStoryId, nodeId: newNodeId } }
                    : undefined
                ),
                {
                  beatNumber: beat.beatNumber,
                  referenceCount: referenceImages.length,
                }
              );
          beat.finalImagePromptText = imageResult.finalPromptText;
          beat.imageUrl = promptOnly ? undefined : imageResult.imageUrl;
          beat = applyImageGenerationResultMetadata(beat, imageResult);

          const branchImagePersisted = Boolean(imageResult.imageGenerationMetadata?.persisted);
          if (session.savedStoryId && imageResult.imageUrl && !branchImagePersisted) {
            const recoveryUserId = await resolveCurrentUserId(session.savedByUserId);
            const stagedForRecovery = await stageGeneratedBeatImageForLocalRecovery({
              storyId: session.savedStoryId,
              userId: recoveryUserId,
              nodeId: newNodeId,
              imageResult,
            });
            if (stagedForRecovery) {
              void retryPendingBeatAssetSyncInternal(session.savedStoryId);
            }
          }

          const updatedMap = addChildNode(
            session.storyMap,
            session.storyMap.currentNodeId,
            optionId,
            beat,
            newNodeId
          );

          // Merge: prefer latest store nodes (with audioUrl from concurrent narration)
          // but override parent (for updated children array) and new node (from addChildNode)
          const latestSession = get().session;
          if (!latestSession) return;
          const mergedMap = {
            ...updatedMap,
            nodes: {
              ...updatedMap.nodes,              // base: stale existing + updated parent + new node
              ...latestSession.storyMap.nodes,  // overlay: latest existing nodes (preserves audioUrl etc.)
              // Re-apply parent's children update (latestSession wouldn't have it)
              [parentId]: {
                ...(latestSession.storyMap.nodes[parentId] || updatedMap.nodes[parentId]),
                children: updatedMap.nodes[parentId].children,
              },
              // Re-apply new node (narration is generated on-demand later)
              [newNodeId]: {
                ...updatedMap.nodes[newNodeId],
                data: normalizeBeatMediaFields({
                  ...updatedMap.nodes[newNodeId].data,
                  narrationVoiceId: voiceForBeat,
                  persistedImageUrl: undefined,
                  imageStatus: promptOnly
                    ? 'not_requested'
                    : branchImagePersisted
                    ? 'ready'
                    : 'pending',
                  ...(branchImagePersisted ? { persistedImageUrl: imageResult.imageUrl } : {}),
                  audioStatus: 'not_requested',
                }),
              },
            },
          };

          if (reservationId) {
            setLoadingStage(set, 'continue_story', 'finish');
            await measureAsyncStep(
              timingSteps,
              'billing_finalize',
              'Finalize branch coin spend',
              () => finalizeImageAwareReservation({
                reservationId,
                actionKey: continueStoryActionKey,
                fallbackIdempotencyKey: `continue_story_prompt_only_fallback:${session.savedStoryId || session.storySessionId}:${newNodeId}`,
                relatedStoryId: session.savedStoryId ?? null,
                relatedNodeId: newNodeId,
                storyId: session.savedStoryId ?? null,
                relatedEntityId: newNodeId,
                metadata: {
                  action: continueStoryActionKey,
                  optionId,
                  optionLabel: selectedOption.label,
                  parentNodeId: parentId,
                  newNodeId,
                },
                imageResult,
              })
            );
            shouldReleaseReservation = false;
          }

          set({
            session: deriveSessionFields(
              {
                ...latestSession,
                narratorVoice: voiceForBeat,
                narrationVoiceMode: voiceResolution.mode,
                narrationVoiceGenderBucket: voiceResolution.genderBucket ?? undefined,
                narrationLanguageCode,
              },
              mergedMap
            ),
            isLoading: false,
            saveStatus: 'unsaved',
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: null,
            errorAction: null,
          });
          dispatchPricingRuntimeRefresh();
          logGenerationTiming({
            scope: 'continue_story',
            totalMs: Math.round(nowMs() - generationStartedAt),
            steps: timingSteps,
            meta: {
              success: true,
              beatNumber: beat.beatNumber,
              optionId,
              optionLabel: selectedOption.label,
              newNodeId,
              usedReferenceImages: referenceImages.length,
              promptOnly,
            },
          });

          // Fire-and-forget: incremental beat save if story is persisted
          if (session.savedStoryId) {
            const newNode = mergedMap.nodes[mergedMap.currentNodeId];
            // Strip base64 assets before sending — persistence discards them anyway
            const cleanNode = {
              ...newNode,
              data: {
                ...newNode.data,
                imageUrl: newNode.data.imageUrl?.startsWith('data:') ? undefined : newNode.data.imageUrl,
                audioUrl: newNode.data.audioUrl?.startsWith('data:') ? undefined : newNode.data.audioUrl,
                characters: newNode.data.characters.map((character) => ({
                  ...character,
                  portraitBase64: undefined,
                })),
              },
            };
            saveBeatAction(session.savedStoryId, mergedMap.currentNodeId, cleanNode)
              .then(({ beatId }) => linkCostEventsToBeat({
                storySessionId: session.storySessionId,
                storyId: session.savedStoryId!,
                nodeId: mergedMap.currentNodeId,
                beatId,
              }))
              .catch((err) => console.error('Incremental beat save failed:', err));

            // Publishing now stays explicit so creators can prepare the
            // dedicated share cover before the storyline goes public.
            if (!EXPLICIT_PUBLISH_COVER_SETUP_REQUIRED && beat.isEnding && canPublishStoryPathAsStandard(mergedMap, mergedMap.currentNodeId)) {
              (async () => {
                const storyPath = getPathToNode(updatedMap, updatedMap.currentNodeId);

                // Storyline cover = second beat (index 1), tree cover = first beat (index 0)
                const storylineCoverNode = storyPath.length > 1 ? storyPath[1] : storyPath[0];
                const treeCoverNode = storyPath[0];

                // Helper: resolve a node's image to a public-bucket URL
                const resolvePublicCoverUrl = async (
                  imageData: string | undefined,
                  destSuffix: string
                ): Promise<string | null> => {
                  if (!imageData) return null;
                  if (imageData.startsWith('data:')) {
                    const supabase = createBrowserClient();
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return null;
                    return uploadCoverImage(user.id, session!.savedStoryId!, imageData);
                  }
                  if (extractStoragePath(imageData, 'story-assets')) {
                    // Private-bucket URL — copy to public bucket via server action
                    return copyCoverToPublicBucket(session!.savedStoryId!, imageData);
                  }
                  if (extractStoragePath(imageData, 'public-storylines')) {
                    // Already in public bucket
                    return imageData;
                  }
                  // External URL (e.g. picsum placeholder) — skip
                  return null;
                };

                let coverImageUrl: string | null = null;
                try {
                  coverImageUrl = await resolvePublicCoverUrl(
                    storylineCoverNode?.data.imageUrl,
                    'cover.webp'
                  );
                } catch (err) {
                  console.error('Storyline cover upload failed:', err);
                }

                // Also set tree cover (beat 0) if not already set
                try {
                  const treeCoverData = treeCoverNode?.data.imageUrl;
                  if (treeCoverData && treeCoverNode !== storylineCoverNode) {
                    const treeCoverUrl = await resolvePublicCoverUrl(treeCoverData, 'tree-cover.webp');
                    if (treeCoverUrl) {
                      await setStoryCoverImage(session!.savedStoryId!, treeCoverUrl);
                    }
                  } else if (coverImageUrl) {
                    // Single-beat story: use same cover for tree
                    await setStoryCoverImage(session!.savedStoryId!, coverImageUrl);
                  }
                } catch (err) {
                  console.error('Tree cover upload failed:', err);
                }

                return autoPublishStoryline(
                  session!.savedStoryId!,
                  updatedMap.currentNodeId,
                  session!.title,
                  coverImageUrl
                );
              })()
                .then((result) => {
                  set({ lastPublishResult: result });
                })
                .catch((err) => {
                  console.error('Auto-publish failed:', err);
                  set({ lastPublishResult: { alreadyPublished: false, storylineId: '', error: err.message || 'Publishing failed' } });
                });
            }
          }
        } catch (error: any) {
          if (reservationId && shouldReleaseReservation) {
            try {
              await releaseCurrentUserBillableAction({
                reservationId,
                reason: 'continue_story_failed',
                releaseStatus: 'failed',
                metadata: {
                  message: error?.message || 'Failed to continue story',
                  optionId,
                  currentNodeId: session.storyMap.currentNodeId,
                },
              });
            } catch (releaseError) {
              console.error('Failed to release continue-story reservation:', releaseError);
            }
          }

          logGenerationTiming({
            scope: 'continue_story',
            totalMs: Math.round(nowMs() - generationStartedAt),
            steps: timingSteps,
            meta: {
              success: false,
              failureStage: get().loadingStage?.currentStepKey ?? 'unknown',
              optionId,
              optionLabel: selectedOption.label,
              message: error?.message || 'Failed to continue story',
            },
          });
          set({
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: error.message || 'Failed to continue story',
            errorAction: null,
          });
        }
      },

      navigateToNode: (nodeId: string) => {
        const { session } = get();
        if (!session || !session.storyMap.nodes[nodeId]) return;

        const updatedMap = { ...session.storyMap, currentNodeId: nodeId };
        const updatedSession = deriveSessionFields(session, updatedMap);
        set({ session: updatedSession });

        if (session.savedStoryId) {
          void getLocalSessionUserId().then((userId) => {
            if (!userId) return;
            const readerKind = session.explorationMode ? 'explore' : 'story';
            void saveTreeProgress({
              readerKind,
              storyId: session.savedStoryId!,
              userId,
              currentNodeId: nodeId,
              completed: updatedSession.status === 'completed',
            });
            void saveTreeStoryAndPrefetch({ readerKind, session: updatedSession, userId });
          });
        }

        // Fire-and-forget: track exploration position for non-owners
        if (session.explorationMode && session.savedStoryId) {
          trackExplorationAction(session.savedStoryId, nodeId).catch(() => {});
        }
      },

      resetStory: () => {
        updateStoreSaveUi({
          session: null,
          error: null,
          errorAction: null,
          isLoading: false,
          loadingClues: [],
          loadingStage: null,
          loadingReader: null,
          isSaving: false,
          saveStatus: 'idle',
          saveWarning: null,
        });
      },

      restartExploration: () => {
        const { session } = get();
        if (!session?.storyMap?.rootNodeId) return;
        const rootId = session.storyMap.rootNodeId;
        const updatedMap = { ...session.storyMap, currentNodeId: rootId };
        set({ session: deriveSessionFields(session, updatedMap) });
      },

      setLoadingClues: (clues: string[]) => {
        set({ loadingClues: clues });
      },

      generateNarrationForNode: async (nodeId: string) => {
        const { session } = get();
        if (!session) return;

        const node = session.storyMap.nodes[nodeId];
        if (!node || node.data.audioUrl) return;
        const baseCostTelemetry: CostTelemetryContext = {
          activityKey: 'regenerate_narration',
          storySessionId: session.storySessionId,
          storyId: session.savedStoryId ?? null,
          nodeId,
          beatNumber: node.data.beatNumber,
          metadata: {
            language: session.storyConfig.language,
          },
        };

        // Skip for mock stories
        if (session.userPrompt.toLowerCase() === 'mock') return;

        set({
          isGeneratingAudio: true,
          session: updateSessionBeat(session, nodeId, (beat) => ({
            ...beat,
            audioStatus: session.savedStoryId ? 'pending' : beat.audioStatus,
            audioError: undefined,
          })),
        });

        try {
          // Use locked voice — selected once at story start, never re-queried
          const voiceResolution = await resolveNarratorVoice(session, costPhase(baseCostTelemetry, 'voice_selection'));
          const voiceName = voiceResolution.voiceId;
          const narrationLanguageCode = voiceResolution.languageCode;
          const narrationAccent = voiceResolution.accent;
          const modelOverrides = isReelStoryConfig(session.storyConfig)
            ? await getStoryModelOverridesCached().catch(() => undefined)
            : undefined;
          if (
            session.narratorVoice !== voiceName
            || session.narrationVoiceMode !== voiceResolution.mode
            || session.narrationVoiceGenderBucket !== (voiceResolution.genderBucket ?? undefined)
            || session.narrationLanguageCode !== narrationLanguageCode
          ) {
            set((state) => state.session ? {
              session: {
                ...state.session,
                narratorVoice: voiceName,
                narrationVoiceMode: voiceResolution.mode,
                narrationVoiceGenderBucket: voiceResolution.genderBucket ?? undefined,
                narrationLanguageCode,
              },
            } : state);
          }

          let audioUrl: string;
          let reelCaptions: StoryBeat['reelCaptions'];
          let narrationMetadata: StoryBeat['narrationMetadata'];
          let storyTextOverlayCaptions: StoryBeat['storyTextOverlayCaptions'];
          let storyTextOverlayAlignment: StoryBeat['storyTextOverlayAlignment'];
          let storyTextOverlayEnabled: StoryBeat['storyTextOverlayEnabled'];
          let storyTextOverlayMode: StoryBeat['storyTextOverlayMode'];
          let storyTextOverlayStyle: StoryBeat['storyTextOverlayStyle'];
          const isReelNarration = isReelStoryConfig(session.storyConfig);
          const reelNarrationOptions = isReelNarration
            ? {
                reelCaptions: node.data.reelCaptions,
                reelSettings: modelOverrides?.reelSettings,
                narrationSettings: session.storyConfig.reel.narrationSettings,
                generationMode: 'final' as const,
                panelPauseMs: normalizeReelTransitionSettings(session.storyConfig.reel.transitionSettings).pauseMs,
              }
            : {};

          if (session.savedStoryId && isReelNarration) {
            // Server-side: generate + upload to Supabase in one round trip
            const result = await generateAndPersistNarration(
              node.data.storyText, session.tone, session.genre,
              voiceName, narrationLanguageCode, session.savedStoryId, nodeId,
              costPhase(baseCostTelemetry, 'tts'),
              {
                taskKey: isReelNarration ? 'reel_tts' : 'tts',
                narrationStyle: getReelNarrationStyle(modelOverrides, session.storyConfig),
                ...reelNarrationOptions,
              }
            );
            audioUrl = result.audioUrl;
            reelCaptions = result.reelCaptions;
            narrationMetadata = result.narrationMetadata;
          } else if (session.savedStoryId) {
            const result = await generateAndPersistStoryNarrationWithOverlay(
              node.data.storyText, session.tone, session.genre,
              voiceName, narrationLanguageCode, session.savedStoryId, nodeId,
              costPhase(baseCostTelemetry, 'tts'),
              {
                accent: narrationAccent,
                storyTextParts: node.data.storyTextParts,
                overlayConfig: session.storyConfig.storyTextOverlay,
              }
            );
            audioUrl = result.audioUrl;
            narrationMetadata = result.narrationMetadata;
            storyTextOverlayCaptions = result.storyTextOverlayCaptions;
            storyTextOverlayAlignment = result.storyTextOverlayAlignment;
            storyTextOverlayEnabled = result.storyTextOverlayEnabled;
            storyTextOverlayMode = result.storyTextOverlayMode;
            storyTextOverlayStyle = result.storyTextOverlayStyle;
          } else if (isReelNarration) {
            const result = await generateReelNarrationOnly(
              node.data.storyText, session.tone, session.genre,
              voiceName, narrationLanguageCode,
              costPhase(baseCostTelemetry, 'tts'),
              {
                narrationStyle: getReelNarrationStyle(modelOverrides, session.storyConfig),
                ...reelNarrationOptions,
              }
            );
            audioUrl = result.audioUrl;
            reelCaptions = result.reelCaptions;
            narrationMetadata = result.narrationMetadata;
          } else {
            // No cloud save yet — generate only, returns base64
            const result = await generateStoryNarrationOnlyWithOverlay(
              node.data.storyText, session.tone, session.genre,
              voiceName, narrationLanguageCode,
              costPhase(baseCostTelemetry, 'tts'),
              {
                accent: narrationAccent,
                storyTextParts: node.data.storyTextParts,
                overlayConfig: session.storyConfig.storyTextOverlay,
              }
            );
            audioUrl = result.audioUrl;
            narrationMetadata = result.narrationMetadata;
            storyTextOverlayCaptions = result.storyTextOverlayCaptions;
            storyTextOverlayAlignment = result.storyTextOverlayAlignment;
            storyTextOverlayEnabled = result.storyTextOverlayEnabled;
            storyTextOverlayMode = result.storyTextOverlayMode;
            storyTextOverlayStyle = result.storyTextOverlayStyle;
          }

          // Update the node with audio — re-read session in case it changed
          const latestSession = get().session;
          if (!latestSession) return;

          const updatedNodes = {
            ...latestSession.storyMap.nodes,
            [nodeId]: {
              ...latestSession.storyMap.nodes[nodeId],
              data: normalizeBeatMediaFields({
                ...latestSession.storyMap.nodes[nodeId].data,
                audioUrl,
                storyboardNarrationTiming: undefined,
                ...(reelCaptions?.length ? { reelCaptions } : {}),
                ...(narrationMetadata ? {
                  narrationMetadata,
                  activeNarrationPreviewId: undefined,
                } : {}),
                ...(typeof storyTextOverlayEnabled === 'boolean'
                  ? { storyTextOverlayEnabled }
                  : {}),
                ...(storyTextOverlayMode ? { storyTextOverlayMode } : {}),
                ...(storyTextOverlayStyle ? { storyTextOverlayStyle } : {}),
                ...(storyTextOverlayCaptions?.length ? { storyTextOverlayCaptions } : {}),
                ...(storyTextOverlayAlignment ? { storyTextOverlayAlignment } : {}),
                narrationVoiceId: voiceName,
                audioStatus: session.savedStoryId ? 'ready' : 'not_requested',
                audioError: undefined,
              }),
            },
          };
          const updatedMap = { ...latestSession.storyMap, nodes: updatedNodes };
          set({
            session: deriveSessionFields(
              {
                ...latestSession,
                narratorVoice: voiceName,
                narrationVoiceMode: voiceResolution.mode,
                narrationVoiceGenderBucket: voiceResolution.genderBucket ?? undefined,
                narrationLanguageCode,
              },
              updatedMap
            ),
            isGeneratingAudio: false,
            audioReadyNodeId: nodeId,
          });
        } catch (error) {
          console.error('Narration generation failed:', error);
          const latestSession = get().session;
          if (session.savedStoryId && latestSession?.storyMap.nodes[nodeId]) {
            set({
              session: updateSessionBeat(latestSession, nodeId, (beat) => ({
                ...beat,
                audioStatus: 'failed',
                audioError: error instanceof Error ? error.message : 'Narration generation failed',
              })),
              isGeneratingAudio: false,
            });
          } else {
            set({ isGeneratingAudio: false });
          }
        }
      },

      updateStoryboardNarrationTiming: async (nodeId, timing) => {
        const { session } = get();
        if (!session || isReelStoryConfig(session.storyConfig)) return;

        const node = session.storyMap.nodes[nodeId];
        if (
          !node?.data.audioUrl
          || !isStoryboardBeat(node.data, {
            assumeGeneratedStoryboard: session.storyConfig.imageGenerationMode !== 'prompt_only',
          })
        ) return;

        const normalizedTiming = timing
          ? normalizeStoryboardNarrationTiming(timing, timing.audioDurationMs)
          : null;
        if (timing && !normalizedTiming) {
          throw new Error('Story narration timing is invalid. Each panel must be at least 100 ms long.');
        }

        updateStoreSaveUi({
          session: updateSessionBeat(session, nodeId, (beat) => ({
            ...beat,
            storyboardNarrationTiming: normalizedTiming || undefined,
          })),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
        });

        if (!session.savedStoryId) return;

        try {
          await updateBeatMediaState(session.savedStoryId, nodeId, {
            storyboardNarrationTiming: normalizedTiming,
          });
          updateStoreSaveUi({ saveStatus: 'saved' });
        } catch (error) {
          const latestSession = get().session;
          if (latestSession) {
            updateStoreSaveUi({
              session: updateSessionBeat(latestSession, nodeId, (beat) => ({
                ...beat,
                storyboardNarrationTiming: node.data.storyboardNarrationTiming,
              })),
              saveStatus: 'unsaved',
            });
          }
          throw error;
        }
      },

      updateReelPanelCaptions: async (nodeId: string, panelTexts: string[]) => {
        const { session } = get();
        if (!session || !isReelStoryConfig(session.storyConfig)) {
          return { clearedNarration: false, deletedPreviewIds: [] };
        }

        const node = session.storyMap.nodes[nodeId];
        if (!node) {
          return { clearedNarration: false, deletedPreviewIds: [] };
        }

        const normalizedTexts = normalizeEditedReelPanelTexts(panelTexts);
        if (!normalizedTexts.some(Boolean)) {
          throw new Error('Add text to at least one panel before saving.');
        }

        const nextStoryText = normalizedTexts.filter(Boolean).join(' ');
        const nextCaptions: NonNullable<StoryBeat['reelCaptions']> = normalizedTexts.map((text, panelIndex) => ({
          panelIndex,
          text,
        }));
        const hadActiveNarration = Boolean(
          node.data.audioUrl
          || node.data.audioStatus === 'ready'
          || node.data.audioStatus === 'pending'
          || node.data.narrationMetadata
          || node.data.activeNarrationPreviewId
        );

        const nextMap = updateStoryMapBeat(session.storyMap, nodeId, (beat) => ({
          ...beat,
          storyText: nextStoryText,
          reelCaptions: nextCaptions,
          audioUrl: undefined,
          audioStatus: 'not_requested' as const,
          audioError: undefined,
          narrationVoiceId: undefined,
          narrationMetadata: undefined,
          activeNarrationPreviewId: undefined,
        }));

        updateStoreSaveUi({
          session: deriveSessionFields(session, nextMap),
          isSaving: Boolean(session.savedStoryId),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
          error: null,
          audioReadyNodeId: hadActiveNarration && get().audioReadyNodeId === nodeId ? null : get().audioReadyNodeId,
        });

        if (!session.savedStoryId) {
          return { clearedNarration: hadActiveNarration, deletedPreviewIds: [] };
        }

        try {
          await saveBeatAction(session.savedStoryId, nodeId, nextMap.nodes[nodeId]);
          const { deletedPreviewIds } = await clearReelNarrationForBeatAction(session.savedStoryId, nodeId);
          const clearedNarration = hadActiveNarration || deletedPreviewIds.length > 0;

          const latestSession = get().session;
          if (latestSession?.storyMap.nodes[nodeId]) {
            const confirmedMap = updateStoryMapBeat(latestSession.storyMap, nodeId, (beat) => ({
              ...beat,
              storyText: nextStoryText,
              reelCaptions: nextCaptions,
              audioUrl: undefined,
              audioStatus: 'not_requested' as const,
              audioError: undefined,
              narrationVoiceId: undefined,
              narrationMetadata: undefined,
              activeNarrationPreviewId: undefined,
            }));
            updateStoreSaveUi({
              session: deriveSessionFields(latestSession, confirmedMap),
              isSaving: false,
              saveStatus: 'saved',
              error: null,
            });
          } else {
            updateStoreSaveUi({
              isSaving: false,
              saveStatus: 'saved',
              error: null,
            });
          }
          return { clearedNarration, deletedPreviewIds };
        } catch (error) {
          updateStoreSaveUi({
            isSaving: false,
            saveStatus: 'unsaved',
            error: error instanceof Error ? error.message : 'Failed to save reel text.',
          });
          throw error;
        }
      },

      updateReelNarrationSettings: async (
        settings: ReelNarrationSettings,
        options: { preserveExistingNarration?: boolean } = {}
      ) => {
        const { session } = get();
        if (!session || !isReelStoryConfig(session.storyConfig)) {
          return { clearedNarration: false };
        }

        const normalizedSettings = normalizeReelNarrationSettings(settings, {
          storyLanguage: session.storyConfig.language,
        });
        const clearedNarration = options.preserveExistingNarration
          ? false
          : Object.values(session.storyMap.nodes).some((node) => {
              const beat = normalizeBeatMediaFields(node.data);
              return Boolean(beat.audioUrl || beat.audioStatus === 'ready' || beat.audioStatus === 'pending');
            });
        const nextStoryConfig = normalizeStoryConfig({
          ...session.storyConfig,
          reel: {
            ...session.storyConfig.reel,
            narrationSettings: normalizedSettings,
          },
        });
        const nextMap: StoryMap = {
          ...session.storyMap,
          nodes: Object.fromEntries(
            Object.entries(session.storyMap.nodes).map(([nodeId, node]) => [
              nodeId,
              {
                ...node,
                data: normalizeBeatMediaFields({
                  ...node.data,
                  ...(clearedNarration
                    ? {
                        audioUrl: undefined,
                        audioStatus: 'not_requested' as const,
                        audioError: undefined,
                        narrationVoiceId: undefined,
                      }
                    : {}),
                }),
              },
            ])
          ),
        };
        const nextSession = deriveSessionFields(
          {
            ...session,
            storyConfig: nextStoryConfig,
          },
          nextMap
        );

        updateStoreSaveUi({
          session: nextSession,
          isSaving: Boolean(session.savedStoryId),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
          error: null,
          audioReadyNodeId: clearedNarration ? null : get().audioReadyNodeId,
        });

        if (!session.savedStoryId) {
          return { clearedNarration };
        }

        try {
          await saveStoryAction(nextSession, nextMap);
          await saveReelNarrationSettingsAction({
            storyId: session.savedStoryId,
            settings: normalizedSettings,
            clearExistingAudio: clearedNarration,
          });
          const latestSession = get().session;
          if (latestSession) {
            updateStoreSaveUi({
              session: {
                ...latestSession,
                storyConfig: nextStoryConfig,
              },
              isSaving: false,
              saveStatus: 'saved',
              error: null,
            });
          } else {
            updateStoreSaveUi({
              isSaving: false,
              saveStatus: 'saved',
              error: null,
            });
          }
        } catch (error) {
          updateStoreSaveUi({
            isSaving: false,
            saveStatus: 'unsaved',
            error: error instanceof Error ? error.message : 'Failed to save reel narration settings.',
          });
          throw error;
        }

        return { clearedNarration };
      },

      updateReelTextOverlaySettings: async ({ enabled, style }: { enabled: boolean; style: StoryBeat['reelTextOverlayStyle'] }) => {
        const { session } = get();
        if (!session || !isReelStoryConfig(session.storyConfig)) {
          return;
        }

        const normalizedEnabled = Boolean(enabled);
        const normalizedStyle = normalizeReelTextOverlayStyle(style ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE);
        const nextStoryConfig = normalizeStoryConfig({
          ...session.storyConfig,
          reel: {
            ...session.storyConfig.reel,
            textOverlayEnabled: normalizedEnabled,
            textOverlayStyle: normalizedStyle,
          },
        });
        const nextMap: StoryMap = {
          ...session.storyMap,
          nodes: Object.fromEntries(
            Object.entries(session.storyMap.nodes).map(([nodeId, node]) => [
              nodeId,
              {
                ...node,
                data: normalizeBeatMediaFields({
                  ...node.data,
                  reelTextOverlayEnabled: normalizedEnabled,
                  reelTextOverlayStyle: normalizedStyle,
                }),
              },
            ])
          ),
        };
        const nextSession = deriveSessionFields(
          {
            ...session,
            storyConfig: nextStoryConfig,
          },
          nextMap
        );

        updateStoreSaveUi({
          session: nextSession,
          isSaving: Boolean(session.savedStoryId),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
          error: null,
        });

        if (!session.savedStoryId) {
          return;
        }

        try {
          await saveStoryAction(nextSession, nextMap);
          const latestSession = get().session;
          if (latestSession && isReelStoryConfig(latestSession.storyConfig)) {
            const confirmedConfig = normalizeStoryConfig({
              ...latestSession.storyConfig,
              reel: {
                ...latestSession.storyConfig.reel,
                textOverlayEnabled: normalizedEnabled,
                textOverlayStyle: normalizedStyle,
              },
            });
            const confirmedMap: StoryMap = {
              ...latestSession.storyMap,
              nodes: Object.fromEntries(
                Object.entries(latestSession.storyMap.nodes).map(([nodeId, node]) => [
                  nodeId,
                  {
                    ...node,
                    data: normalizeBeatMediaFields({
                      ...node.data,
                      reelTextOverlayEnabled: normalizedEnabled,
                      reelTextOverlayStyle: normalizedStyle,
                    }),
                  },
                ])
              ),
            };
            updateStoreSaveUi({
              session: deriveSessionFields(
                {
                  ...latestSession,
                  storyConfig: confirmedConfig,
                },
                confirmedMap
              ),
              isSaving: false,
              saveStatus: 'saved',
              error: null,
            });
          } else {
            updateStoreSaveUi({
              isSaving: false,
              saveStatus: 'saved',
              error: null,
            });
          }
        } catch (error) {
          updateStoreSaveUi({
            isSaving: false,
            saveStatus: 'unsaved',
            error: error instanceof Error ? error.message : 'Failed to save reel text style.',
          });
          throw error;
        }
      },

      updateReelTextOverlayStyle: async (style: StoryBeat['reelTextOverlayStyle']) => {
        const { session } = get();
        await get().updateReelTextOverlaySettings({
          enabled: session?.storyConfig.reel.textOverlayEnabled !== false,
          style,
        });
      },

      updateStoryTextOverlaySettings: async ({ enabled, mode, style }) => {
        const { session } = get();
        if (!session || isReelStoryConfig(session.storyConfig)) {
          return;
        }

        const normalizedMode = mode === 'line' ? 'line' : 'word';
        const normalizedStyle = normalizeStoryTextOverlayStyle(style ?? DEFAULT_STORY_TEXT_OVERLAY_STYLE);
        const nextStoryConfig = normalizeStoryConfig({
          ...session.storyConfig,
          storyTextOverlay: {
            enabled: Boolean(enabled),
            mode: normalizedMode,
            style: normalizedStyle,
          },
        });
        const applyOverlayToBeat = (beat: StoryBeat): StoryBeat => ({
          ...beat,
          storyTextOverlayEnabled: Boolean(enabled),
          storyTextOverlayMode: normalizedMode,
          storyTextOverlayStyle: normalizedStyle,
          storyTextOverlayCaptions: beat.storyTextOverlayCaptions?.length
            ? beat.storyTextOverlayCaptions
            : buildStoryTextOverlayCaptions({
                storyText: beat.storyText,
                storyTextParts: beat.storyTextParts,
              }),
        });
        const nextMap: StoryMap = {
          ...session.storyMap,
          nodes: Object.fromEntries(
            Object.entries(session.storyMap.nodes).map(([nodeId, node]) => [
              nodeId,
              {
                ...node,
                data: normalizeBeatMediaFields(applyOverlayToBeat(node.data)),
              },
            ])
          ),
        };
        const nextSession = deriveSessionFields(
          {
            ...session,
            storyConfig: nextStoryConfig,
          },
          nextMap
        );

        updateStoreSaveUi({
          session: nextSession,
          isSaving: Boolean(session.savedStoryId),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
          error: null,
        });

        if (!session.savedStoryId) {
          return;
        }

        try {
          await saveStoryAction(nextSession, nextMap);
          const latestSession = get().session;
          const savePartial: Partial<StoryState> = {
            isSaving: false,
            saveStatus: 'saved',
            error: null,
          };
          if (latestSession) {
            savePartial.session = deriveSessionFields(
                  {
                    ...latestSession,
                    storyConfig: nextStoryConfig,
                  },
                  {
                    ...latestSession.storyMap,
                    nodes: Object.fromEntries(
                      Object.entries(latestSession.storyMap.nodes).map(([nodeId, node]) => [
                        nodeId,
                        {
                          ...node,
                          data: normalizeBeatMediaFields(applyOverlayToBeat(node.data)),
                        },
                      ])
                    ),
                  }
                );
          }
          updateStoreSaveUi(savePartial);
        } catch (error) {
          updateStoreSaveUi({
            isSaving: false,
            saveStatus: 'unsaved',
            error: error instanceof Error ? error.message : 'Failed to save story text overlay settings.',
          });
          throw error;
        }
      },

      updateStoryTransitionSettings: async (settings) => {
        const { session } = get();
        if (!session || isReelStoryConfig(session.storyConfig)) return;

        const storyTransition = normalizeStoryTransitionSettings(settings);
        const nextStoryConfig = normalizeStoryConfig({
          ...session.storyConfig,
          storyTransition,
        });
        const nextSession = deriveSessionFields({
          ...session,
          storyConfig: nextStoryConfig,
        }, session.storyMap);

        updateStoreSaveUi({
          session: nextSession,
          isSaving: Boolean(session.savedStoryId),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
          error: null,
        });
        if (!session.savedStoryId) return;

        try {
          await saveStoryAction(nextSession, nextSession.storyMap);
          updateStoreSaveUi({ isSaving: false, saveStatus: 'saved', error: null });
        } catch (error) {
          updateStoreSaveUi({
            isSaving: false,
            saveStatus: 'unsaved',
            error: error instanceof Error ? error.message : 'Failed to save story transitions.',
          });
          throw error;
        }
      },

      updateStoryEffects: async (nodeId, config) => {
        const { session } = get();
        if (!session || isReelStoryConfig(session.storyConfig) || !session.storyMap.nodes[nodeId]) return;
        const storyEffects = copyStoryEffectConfig(normalizeStoryEffectConfig(config), config.sourcePresetId);
        const previousSession = session;
        const nextSession = updateSessionBeat(session, nodeId, (beat) => ({ ...beat, storyEffects }));
        updateStoreSaveUi({
          session: nextSession,
          isSaving: Boolean(session.savedStoryId),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
          error: null,
        });
        if (!session.savedStoryId) return;
        try {
          await updateBeatMediaState(session.savedStoryId, nodeId, { storyEffects });
          updateStoreSaveUi({ isSaving: false, saveStatus: 'saved', error: null });
        } catch (error) {
          updateStoreSaveUi({
            session: previousSession,
            isSaving: false,
            saveStatus: 'unsaved',
            error: error instanceof Error ? error.message : 'Failed to save story effects.',
          });
          throw error;
        }
      },

      applyStoryEffectsToAll: async (config) => {
        const { session } = get();
        if (!session || isReelStoryConfig(session.storyConfig)) return 0;
        const previousSession = session;
        const nextMap = applyStoryEffectsToMap(session.storyMap, normalizeStoryEffectConfig(config));
        const nextSession = deriveSessionFields(session, nextMap);
        const affected = Object.keys(nextMap.nodes).length;
        updateStoreSaveUi({
          session: nextSession,
          isSaving: Boolean(session.savedStoryId),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
          error: null,
        });
        if (!session.savedStoryId) return affected;
        try {
          await saveStoryAction(nextSession, nextMap);
          updateStoreSaveUi({ isSaving: false, saveStatus: 'saved', error: null });
          return affected;
        } catch (error) {
          updateStoreSaveUi({
            session: previousSession,
            isSaving: false,
            saveStatus: 'unsaved',
            error: error instanceof Error ? error.message : 'Failed to apply story effects.',
          });
          throw error;
        }
      },

      generateStoryTextOverlayForNode: async (nodeId, settings) => {
        const { session } = get();
        if (!session || isReelStoryConfig(session.storyConfig)) {
          throw new Error('Story text overlay generation is available for stories only.');
        }
        if (!session.savedStoryId) {
          throw new Error('Save this story before generating text overlay timing.');
        }
        const node = session.storyMap.nodes[nodeId];
        if (!node) {
          throw new Error('Story beat was not found.');
        }

        updateStoreSaveUi({
          isSaving: true,
          saveStatus: 'saving',
          error: null,
        });

        try {
          const result = await generateStoryTextOverlayForBeatAction({
            storyId: session.savedStoryId,
            nodeId,
            overlayConfig: {
              enabled: settings.enabled,
              mode: settings.mode,
              style: normalizeStoryTextOverlayStyle(settings.style ?? DEFAULT_STORY_TEXT_OVERLAY_STYLE),
            },
          });
          const latestSession = get().session;
          if (latestSession) {
            const latestNode = latestSession.storyMap.nodes[nodeId];
            if (latestNode) {
              const nextMap: StoryMap = {
                ...latestSession.storyMap,
                nodes: {
                  ...latestSession.storyMap.nodes,
                  [nodeId]: {
                    ...latestNode,
                    data: normalizeBeatMediaFields({
                      ...latestNode.data,
                      storyTextOverlayEnabled: result.storyTextOverlayEnabled,
                      storyTextOverlayMode: result.storyTextOverlayMode,
                      storyTextOverlayStyle: result.storyTextOverlayStyle,
                      storyTextOverlayCaptions: result.storyTextOverlayCaptions,
                      storyTextOverlayAlignment: result.storyTextOverlayAlignment,
                    }),
                  },
                },
              };
              updateStoreSaveUi({
                session: deriveSessionFields(latestSession, nextMap),
                isSaving: false,
                saveStatus: 'saved',
                error: null,
              });
            } else {
              updateStoreSaveUi({
                isSaving: false,
                saveStatus: 'saved',
                error: null,
              });
            }
          } else {
            updateStoreSaveUi({
              isSaving: false,
              saveStatus: 'saved',
              error: null,
            });
          }
          return result;
        } catch (error) {
          updateStoreSaveUi({
            isSaving: false,
            saveStatus: 'unsaved',
            error: error instanceof Error ? error.message : 'Failed to generate story text overlay timing.',
          });
          throw error;
        }
      },

      generateStoryTextOverlayForCurrentPath: async (settings) => {
        const { session } = get();
        if (!session || isReelStoryConfig(session.storyConfig)) {
          throw new Error('Story text overlay generation is available for stories only.');
        }
        if (!session.savedStoryId) {
          throw new Error('Save this story before generating text overlay timing.');
        }

        const nodeIds = getPathToNode(session.storyMap, session.storyMap.currentNodeId).map((node) => node.id);
        updateStoreSaveUi({
          isSaving: true,
          saveStatus: 'saving',
          error: null,
        });

        try {
          const result = await generateStoryTextOverlayForStoryAction({
            storyId: session.savedStoryId,
            nodeIds,
            overlayConfig: {
              enabled: settings.enabled,
              mode: settings.mode,
              style: normalizeStoryTextOverlayStyle(settings.style ?? DEFAULT_STORY_TEXT_OVERLAY_STYLE),
            },
          });
          const latestSession = get().session;
          if (latestSession) {
            const nextNodes = { ...latestSession.storyMap.nodes };
            for (const item of result.results) {
              if (item.status !== 'synced' && item.status !== 'fallback') continue;
              const node = nextNodes[item.nodeId];
              if (!node) continue;
              nextNodes[item.nodeId] = {
                ...node,
                data: normalizeBeatMediaFields({
                  ...node.data,
                  storyTextOverlayEnabled: item.storyTextOverlayEnabled,
                  storyTextOverlayMode: item.storyTextOverlayMode,
                  storyTextOverlayStyle: item.storyTextOverlayStyle,
                  storyTextOverlayCaptions: item.storyTextOverlayCaptions,
                  storyTextOverlayAlignment: item.storyTextOverlayAlignment,
                }),
              };
            }
            const nextMap: StoryMap = {
              ...latestSession.storyMap,
              nodes: nextNodes,
            };
            updateStoreSaveUi({
              session: deriveSessionFields(latestSession, nextMap),
              isSaving: false,
              saveStatus: result.failed > 0 ? 'unsaved' : 'saved',
              error: result.failed > 0 ? 'Some story text overlay timings could not be generated.' : null,
            });
          } else {
            updateStoreSaveUi({
              isSaving: false,
              saveStatus: result.failed > 0 ? 'unsaved' : 'saved',
              error: result.failed > 0 ? 'Some story text overlay timings could not be generated.' : null,
            });
          }
          return result;
        } catch (error) {
          updateStoreSaveUi({
            isSaving: false,
            saveStatus: 'unsaved',
            error: error instanceof Error ? error.message : 'Failed to generate story text overlay timing.',
          });
          throw error;
        }
      },

      updateReelTransitionSettings: async (settings: ReelTransitionSettings) => {
        const { session } = get();
        if (!session || !isReelStoryConfig(session.storyConfig)) {
          return;
        }

        const transitionSettings = normalizeReelTransitionSettings(settings);
        const nextStoryConfig = normalizeStoryConfig({
          ...session.storyConfig,
          reel: {
            ...session.storyConfig.reel,
            transitionSettings,
          },
        });
        const nextSession = {
          ...session,
          storyConfig: nextStoryConfig,
        };

        updateStoreSaveUi({
          session: nextSession,
          isSaving: Boolean(session.savedStoryId),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
          error: null,
        });

        if (!session.savedStoryId) {
          return;
        }

        try {
          await saveStoryAction(nextSession, nextSession.storyMap);
          updateStoreSaveUi({
            isSaving: false,
            saveStatus: 'saved',
            error: null,
          });
        } catch (error) {
          updateStoreSaveUi({
            isSaving: false,
            saveStatus: 'unsaved',
            error: error instanceof Error ? error.message : 'Failed to save reel transitions.',
          });
          throw error;
        }
      },

      regenerateImageForNode: async (nodeId: string, regenOptions?: BeatImageRegenerationOptions) => {
        const { session } = get();
        if (!session) return;

        const node = session.storyMap.nodes[nodeId];
        if (!node) return;

        const regenPanelSuggestions = cleanPanelSuggestions(regenOptions?.panelSuggestions);
        const regenOverallSuggestion = regenOptions?.overallSuggestion?.trim() || undefined;
        const baseCostTelemetry: CostTelemetryContext = {
          activityKey: 'regenerate_image',
          storySessionId: session.storySessionId,
          storyId: session.savedStoryId ?? null,
          nodeId,
          beatNumber: node.data.beatNumber,
          metadata: {
            language: session.storyConfig.language,
          },
        };

        set({ isRegeneratingImage: true });
        const promptOnly = isPromptOnlyStoryConfig(session.storyConfig);
        let reservationId: string | null = null;
        let shouldReleaseReservation = false;

        // Server-pipeline routing (admin processing mode). Requires a saved
        // story (jobs reference the story row); unsaved sessions stay legacy.
        let effectiveImageMode: 'client_legacy' | 'server_pipeline' = 'client_legacy';
        if (!promptOnly && session.savedStoryId) {
          try {
            effectiveImageMode = await resolveImageProcessingModeCached();
          } catch {
            // Resolver failure = legacy; the server re-checks on enqueue anyway.
          }
        }

        try {
          if (!promptOnly) {
            const billingAuthorization = await authorizeCurrentUserImageModelBillableAction({
              actionKey: 'regenerate_image',
              idempotencyKey: `regenerate_image:${session.savedStoryId || session.storySessionId}:${nodeId}:${uuidv4()}`,
              relatedStoryId: session.savedStoryId ?? null,
              relatedNodeId: nodeId,
              storyConfig: session.storyConfig,
              imageCount: 1,
              taskKey: getImageTaskKey(session.storyConfig),
              metadata: {
                nodeId,
                beatNumber: node.data.beatNumber,
              },
            });
            const pricingErrorState = buildPricingErrorStateForAction(billingAuthorization, 'regenerate this image');
            if (pricingErrorState) {
              set({
                isRegeneratingImage: false,
                error: pricingErrorState.error,
                errorAction: pricingErrorState.errorAction,
              });
              return;
            }
            reservationId = getHardReservationId(billingAuthorization);
            shouldReleaseReservation = Boolean(reservationId);
          }

          let modelOverrides: StoryModelOverrides | undefined;
          try {
            modelOverrides = await getStoryModelOverridesCached();
          } catch {
            // Falls back to default prompt and model config inside generateImage.
          }

          const parentNode = node.parentId ? session.storyMap.nodes[node.parentId] : undefined;
          const storyAspectRatio = getStoryAspectRatio(session.storyConfig);
          let beatForRender: StoryBeat = {
            ...node.data,
            characters: node.data.characters.map((character) => ({ ...character })),
          };
          beatForRender = mergeCharacterVisualReferences(beatForRender, session.characters);

          let storyboardPlan = beatForRender.storyboardPlan;
          if (!storyboardPlan) {
            const composerSession = stripSessionForPrompt(buildSessionContextToNode(session, node.parentId));
            storyboardPlan = await composeStoryboardPlan(
              beatForRender,
              composerSession,
              session.visualStyle,
              modelOverrides,
              costPhase(baseCostTelemetry, 'storyboard_plan')
            );
          }
          beatForRender.storyboardPlan = storyboardPlan;
          beatForRender.storyboardPromptText = renderStoryboardPlan(storyboardPlan);
          beatForRender.isStoryboard = true;
          if (isReelStoryConfig(session.storyConfig)) {
            beatForRender = applyReelBeatMetadata(beatForRender, session.storyConfig);
            beatForRender.reelCaptions = beatForRender.reelCaptions || buildReelPanelCaptions(beatForRender, storyboardPlan, {
              textLength: session.storyConfig.reel.textLength,
              reelSettings: modelOverrides?.reelSettings,
            });
          } else {
            beatForRender = applyStoryTextOverlayBeatMetadata(beatForRender, session.storyConfig);
          }

          let portraitReferences = session.enableReferenceImages
            ? collectBeatPortraitReferences(beatForRender)
            : [];
          let regenerationContinuityState = extractImageContinuityState(parentNode?.data.imageGenerationMetadata);

          if (!promptOnly && session.enableReferenceImages && portraitReferences.length === 0 && storyboardPlan.portraitTasks.length > 0) {
            const portraitGenerationResult = await generatePortraitsForStoryboardPlan(
              beatForRender,
              storyboardPlan,
              session.visualStyle,
              session.storyConfig.portraitReferences,
              modelOverrides,
              costPhase(baseCostTelemetry, 'portrait_generation'),
              session.storyConfig.imageModelSelection,
              imageContinuityOptions(session.storyConfig, regenerationContinuityState)
            );
            regenerationContinuityState = portraitGenerationResult.latestState;
            portraitReferences = mergeReferenceImages(
              collectBeatPortraitReferences(beatForRender),
              portraitGenerationResult.references
            );
          }
          if (promptOnly) {
            assignPortraitPromptTexts(
              beatForRender,
              storyboardPlan,
              session.visualStyle,
              session.storyConfig.portraitReferences,
              modelOverrides
            );
          }

          const referenceImages = buildStoryboardReferenceImages(
            beatForRender,
            parentNode?.data.imageUrl || (parentNode ? getBeatPersistedImageUrl(parentNode.data) ?? undefined : undefined),
            portraitReferences
          );
          const worldRouting = resolveBeatWorldRouting(session, beatForRender);
          if (worldRouting.worldReferenceImage) {
            referenceImages.push(worldRouting.worldReferenceImage);
          }
          // Refine mode stays visually anchored to the current image by
          // sending it as an extra scene reference; reimagine deliberately
          // does not, so the provider can re-stage the scene.
          if (regenOptions?.mode === 'refine') {
            const currentImage = node.data.imageUrl || getBeatPersistedImageUrl(node.data) || undefined;
            if (currentImage && !currentImage.startsWith('r2://')) {
              referenceImages.unshift(
                currentImage.startsWith('data:')
                  ? { type: 'scene', dataUrl: currentImage }
                  : { type: 'scene', url: currentImage }
              );
            }
          }
          const regenerationContinuityStrategy =
            regenerationContinuityState ? undefined : 'resend_refs';
          const baseStoryboardPrompt = beatForRender.storyboardPromptText || renderStoryboardPlan(storyboardPlan);
          // Pack 1: append the user's regeneration directions (mode behavior,
          // overall + per-panel suggestions, strict continuity rules).
          const storyboardPrompt = regenOptions
            ? `${baseStoryboardPrompt}\n\n${buildRegenerationInstructionBlock({
                mode: regenOptions.mode,
                overallSuggestion: regenOverallSuggestion,
                panelSuggestions: regenPanelSuggestions,
                isStoryboard: true,
              })}`
            : baseStoryboardPrompt;

          if (effectiveImageMode === 'server_pipeline' && !promptOnly && session.savedStoryId) {
            // The worker replays generateSelectedImage with this exact final
            // prompt — built here because the prompt orchestrator is client code.
            const jobFinalPrompt = buildFinalStoryboardImagePrompt(
              storyboardPrompt,
              beatForRender.characters,
              session.visualStyle,
              beatForRender.beatNumber,
              modelOverrides,
              {
                aspectRatio: storyAspectRatio,
                task: getImageTaskKey(session.storyConfig),
                ...getReelVisualStylePromptOptions(modelOverrides, session.storyConfig),
              }
            );
            const enqueueResult = await enqueueBeatImageJob({
              storyId: session.savedStoryId,
              nodeId,
              kind: isReelStoryConfig(session.storyConfig) ? 'reel_image' : 'beat_image',
              beatNumber: beatForRender.beatNumber,
              reservationId,
              payload: {
                finalPrompt: jobFinalPrompt,
                beatNumber: beatForRender.beatNumber,
                aspectRatio: storyAspectRatio,
                imageTask: getImageTaskKey(session.storyConfig),
                imageSize: normalizeStoryboardImageQualitySettings(modelOverrides?.storyboardImageSettings).imageSize,
                imageModelSelection: session.storyConfig.imageModelSelection ?? null,
                imageContinuity: imageContinuityOptions(
                  session.storyConfig,
                  regenerationContinuityState,
                  regenerationContinuityStrategy
                ) ?? null,
                costTelemetry: costPhase(baseCostTelemetry, getImageTaskKey(session.storyConfig), {
                  referenceCount: referenceImages.length,
                }),
                references: referenceImages,
                regeneration: regenOptions
                  ? {
                      mode: regenOptions.mode,
                      ...(regenOverallSuggestion ? { overallSuggestion: regenOverallSuggestion } : {}),
                      ...(regenPanelSuggestions ? { panelSuggestions: regenPanelSuggestions } : {}),
                      source: 'user',
                    }
                  : null,
              },
            });

            if (enqueueResult.status === 'queued') {
              // The worker finalizes/releases the reservation from here on.
              shouldReleaseReservation = false;

              const latestSession = get().session;
              if (!latestSession) return;
              const currentData = latestSession.storyMap.nodes[nodeId]?.data;
              if (!currentData) return;
              const updatedNodes = {
                ...latestSession.storyMap.nodes,
                [nodeId]: {
                  ...latestSession.storyMap.nodes[nodeId],
                  data: normalizeBeatMediaFields({
                    ...currentData,
                    ...beatForRender,
                    // Keep the previous image visible while the job runs.
                    imageUrl: currentData.imageUrl,
                    persistedImageUrl: currentData.persistedImageUrl,
                    isStoryboard: true,
                    imageStatus: 'pending',
                    imageError: undefined,
                  }),
                },
              };
              const updatedMap = { ...latestSession.storyMap, nodes: updatedNodes };
              const updatedSession = deriveSessionFields(latestSession, updatedMap);
              set({
                session: updatedSession,
                isRegeneratingImage: false,
                activeImageJobNodeIds: Array.from(new Set([...get().activeImageJobNodeIds, nodeId])),
                saveStatus: 'idle',
              });
              startImageJobPolling(session.savedStoryId);

              // Persist the refreshed storyboard plan/prompt text; the image
              // itself is attached to beats/story_map by the worker.
              const authClient = createBrowserClient();
              const { data: { user } } = await authClient.auth.getUser();
              const saveUserId = user?.id || updatedSession.savedByUserId;
              if (saveUserId && !updatedSession.sourceStoryOwnerId) {
                const runtimeSettings = await resolveStorySaveRuntimeSettings(get().saveRuntimeSettings);
                await get().saveStoryToCloud(saveUserId, {
                  signedUrlSwapEnabled: runtimeSettings.storyAssetSignedUrlSwapEnabled,
                  incrementalAssetSyncEnabled: runtimeSettings.storyIncrementalAssetSyncEnabled,
                  pauseAssetUploadsDuringGenerationEnabled: runtimeSettings.storyAssetUploadPauseDuringGenerationEnabled,
                  assetSyncWarningTimeoutMs: runtimeSettings.storyAssetSyncWarningTimeoutMs,
                });
              }
              return;
            }

            if (enqueueResult.status === 'duplicate' || enqueueResult.status === 'error') {
              if (reservationId) {
                await releaseCurrentUserBillableAction({
                  reservationId,
                  reason: enqueueResult.status === 'duplicate' ? 'image_job_duplicate' : 'image_job_enqueue_failed',
                  releaseStatus: 'released',
                  metadata: { nodeId },
                });
                shouldReleaseReservation = false;
              }
              set({
                isRegeneratingImage: false,
                error: enqueueResult.status === 'duplicate'
                  ? 'This image is already being generated in the background. It will appear automatically when ready.'
                  : enqueueResult.message,
              });
              return;
            }
            // 'legacy_mode': the admin flipped the setting mid-flight — fall
            // through to the legacy path with the reservation we already hold.
          }

          const imageResult = promptOnly
            ? {
                imageUrl: '',
                finalPromptText: buildFinalStoryboardImagePrompt(
                  storyboardPrompt,
                  beatForRender.characters,
                  session.visualStyle,
                  beatForRender.beatNumber,
                modelOverrides,
                {
                  aspectRatio: storyAspectRatio,
                  task: getImageTaskKey(session.storyConfig),
                  ...getReelVisualStylePromptOptions(modelOverrides, session.storyConfig),
                  ...(worldRouting.worldAnchor ? { worldAnchor: worldRouting.worldAnchor } : {}),
                }
              ),
            }
            : await generateImage(
                storyboardPrompt,
                beatForRender.characters,
                session.visualStyle,
                modelOverrides,
                referenceImages.length > 0 ? referenceImages : undefined,
                beatForRender.beatNumber,
                costPhase(baseCostTelemetry, getImageTaskKey(session.storyConfig), {
                  referenceCount: referenceImages.length,
                }),
                storyAspectRatio,
                getImageTaskKey(session.storyConfig),
                { ...getReelVisualStylePromptOptions(modelOverrides, session.storyConfig), ...(worldRouting.worldAnchor ? { worldAnchor: worldRouting.worldAnchor } : {}) },
                session.storyConfig.imageModelSelection,
                imageContinuityOptions(
                  session.storyConfig,
                  regenerationContinuityState,
                  regenerationContinuityStrategy
                )
              );
          beatForRender.finalImagePromptText = imageResult.finalPromptText;
          beatForRender = applyImageGenerationResultMetadata(beatForRender, imageResult);
          const generatedPlaceholder = Boolean(imageResult.imageGenerationMetadata?.placeholder);

          if (!generatedPlaceholder && session.savedStoryId && imageResult.imageUrl) {
            const recoveryUserId = await resolveCurrentUserId(session.savedByUserId);
            const stagedForRecovery = await stageGeneratedBeatImageForLocalRecovery({
              storyId: session.savedStoryId,
              userId: recoveryUserId,
              nodeId,
              imageResult,
            });
            if (stagedForRecovery) {
              void retryPendingBeatAssetSyncInternal(session.savedStoryId);
            }
          }

          if (reservationId) {
            if (generatedPlaceholder) {
              await releaseCurrentUserBillableAction({
                reservationId,
                reason: 'regenerate_image_placeholder',
                releaseStatus: 'released',
                metadata: {
                  nodeId,
                  message: imageResult.imageGenerationMetadata?.reason ?? 'No provider image generated.',
                },
              });
            } else {
              await finalizeCurrentUserBillableAction({
                reservationId,
                storyId: session.savedStoryId ?? null,
                relatedEntityId: nodeId,
                metadata: {
                  action: 'regenerate_image',
                  nodeId,
                  beatNumber: node.data.beatNumber,
                  imageModelSnapshot: imageResult.imageModelSnapshot ?? null,
                },
              });
            }
            shouldReleaseReservation = false;
          }

          // Update the node with the new image
          const latestSession = get().session;
          if (!latestSession) return;

          const updatedNodes = {
            ...latestSession.storyMap.nodes,
            [nodeId]: {
              ...latestSession.storyMap.nodes[nodeId],
              data: normalizeBeatMediaFields({
                ...latestSession.storyMap.nodes[nodeId].data,
                ...beatForRender,
                imageUrl: promptOnly ? undefined : imageResult.imageUrl,
                persistedImageUrl: undefined,
                isStoryboard: true,
                imageStatus: promptOnly ? 'not_requested' : 'pending',
                imageError: undefined,
              }),
            },
          };
          const updatedMap = { ...latestSession.storyMap, nodes: updatedNodes };
          const updatedSession = deriveSessionFields(latestSession, updatedMap);
          set({
            session: updatedSession,
            isRegeneratingImage: false,
            saveStatus: 'idle',
          });

          const authClient = createBrowserClient();
          const { data: { user } } = await authClient.auth.getUser();
          const saveUserId = user?.id || updatedSession.savedByUserId;
          const runtimeSettings = await resolveStorySaveRuntimeSettings(get().saveRuntimeSettings);

          if (saveUserId && !updatedSession.sourceStoryOwnerId) {
            await get().saveStoryToCloud(saveUserId, {
              signedUrlSwapEnabled: runtimeSettings.storyAssetSignedUrlSwapEnabled,
              incrementalAssetSyncEnabled: runtimeSettings.storyIncrementalAssetSyncEnabled,
              pauseAssetUploadsDuringGenerationEnabled: runtimeSettings.storyAssetUploadPauseDuringGenerationEnabled,
              assetSyncWarningTimeoutMs: runtimeSettings.storyAssetSyncWarningTimeoutMs,
            });
          } else if (!updatedSession.sourceStoryOwnerId) {
            set({ saveStatus: 'unsaved' });
          }
        } catch (error) {
          console.error('Image regeneration failed:', error);
          if (reservationId && shouldReleaseReservation) {
            try {
              await releaseCurrentUserBillableAction({
                reservationId,
                reason: 'regenerate_image_failed',
                releaseStatus: 'failed',
                metadata: {
                  message: error instanceof Error ? error.message : 'Image regeneration failed',
                },
              });
            } catch (releaseError) {
              console.error('Failed to release image-regeneration reservation:', releaseError);
            }
          }
          set({ isRegeneratingImage: false });
        }
      },

      loadBeatControlSettings: async () => {
        try {
          const settings = await getBeatControlRuntimeSettings();
          set({ beatControlSettings: settings });
        } catch {
          // Fail closed: controls stay hidden with the defaults.
        }
      },

      loadCharacterUniverseSettings: async () => {
        try {
          const settings = await getCharacterUniverseRuntimeSettings();
          set({ characterUniverseSettings: settings });
        } catch {
          // Fail closed: controls stay hidden with the defaults.
        }
      },

      // Applies a server-confirmed timeline rewrite to the local session:
      // removes the descendant subtree, optionally applies the new beat text,
      // and recomputes the flat session fields from the pruned tree. The
      // server already wrote both persistence halves, so no client re-save.
      applyTimelineRewrite: (nodeId: string, newText: string) => {
        const { session } = get();
        if (!session) return;
        const source = session.storyMap.nodes[nodeId];
        if (!source) return;

        const prunedMap = removeSubtree(session.storyMap, nodeId);
        const patchedMap: StoryMap = {
          ...prunedMap,
          nodes: {
            ...prunedMap.nodes,
            [nodeId]: {
              ...prunedMap.nodes[nodeId],
              data: {
                ...prunedMap.nodes[nodeId].data,
                ...(newText
                  ? {
                      storyText: newText,
                      storyTextParts: undefined,
                      storyTextOverlayCaptions: undefined,
                      storyTextOverlayAlignment: undefined,
                    }
                  : {}),
              },
            },
          },
        };
        const survivingNodeIds = new Set(Object.keys(patchedMap.nodes));
        const updatedSession = deriveSessionFields(session, patchedMap);
        set({
          session: updatedSession,
          activeImageJobNodeIds: get().activeImageJobNodeIds.filter((id) => survivingNodeIds.has(id)),
          audioReadyNodeId:
            get().audioReadyNodeId && survivingNodeIds.has(get().audioReadyNodeId!)
              ? get().audioReadyNodeId
              : null,
          saveStatus: 'saved',
          error: null,
          errorAction: null,
        });
      },

      editBeatTextForNode: async (nodeId: string, newText: string, confirmTimelineRewrite?: boolean) => {
        const { session } = get();
        if (!session?.savedStoryId) {
          return { status: 'failed', error: 'Save the story before editing beats.' } as EditBeatTextResult;
        }
        const result = await editBeatTextAction({
          storyId: session.savedStoryId,
          nodeId,
          newText,
          confirmTimelineRewrite,
        });
        if (result.status === 'updated') {
          if (result.wipedNodeIds && result.wipedNodeIds.length > 0) {
            get().applyTimelineRewrite(nodeId, newText.trim());
          } else {
            const latest = get().session;
            const node = latest?.storyMap.nodes[nodeId];
            if (latest && node) {
              const patchedMap: StoryMap = {
                ...latest.storyMap,
                nodes: {
                  ...latest.storyMap.nodes,
                  [nodeId]: {
                    ...node,
                    data: {
                      ...node.data,
                      storyText: newText.trim(),
                      storyTextParts: undefined,
                      storyTextOverlayCaptions: undefined,
                      storyTextOverlayAlignment: undefined,
                    },
                  },
                },
              };
              set({ session: deriveSessionFields(latest, patchedMap), saveStatus: 'saved' });
            }
          }
        }
        return result;
      },

      regenerateOptionsForNode: async (nodeId: string, confirmTimelineRewrite?: boolean) => {
        const { session } = get();
        if (!session?.savedStoryId) {
          return { status: 'failed', error: 'Save the story before regenerating options.' } as RegenerateBeatOptionsResult;
        }
        const result = await regenerateBeatOptionsAction({
          storyId: session.savedStoryId,
          nodeId,
          confirmTimelineRewrite,
        });
        if (result.status === 'updated') {
          // A confirmed regeneration on a beat with downstream content wiped
          // that content server-side; mirror it locally before patching options.
          if (confirmTimelineRewrite) {
            get().applyTimelineRewrite(nodeId, '');
          }
          const latest = get().session;
          const node = latest?.storyMap.nodes[nodeId];
          if (latest && node) {
            const patchedMap: StoryMap = {
              ...latest.storyMap,
              nodes: {
                ...latest.storyMap.nodes,
                [nodeId]: { ...node, data: { ...node.data, options: result.options } },
              },
            };
            set({ session: deriveSessionFields(latest, patchedMap), saveStatus: 'saved' });
          }
        }
        return result;
      },

      addCustomOptionForNode: async (nodeId: string, optionText: string) => {
        const { session } = get();
        if (!session?.savedStoryId) {
          return { status: 'failed', error: 'Save the story before adding your own option.' } as AddCustomOptionResult;
        }
        const result = await addCustomOptionAction({
          storyId: session.savedStoryId,
          nodeId,
          optionText,
        });
        if (result.status === 'added') {
          const latest = get().session;
          const node = latest?.storyMap.nodes[nodeId];
          if (latest && node) {
            const patchedMap: StoryMap = {
              ...latest.storyMap,
              nodes: {
                ...latest.storyMap.nodes,
                [nodeId]: {
                  ...node,
                  data: { ...node.data, options: [...(node.data.options ?? []), result.option] },
                },
              },
            };
            set({ session: deriveSessionFields(latest, patchedMap), saveStatus: 'saved' });
          }
        }
        return result;
      },

      restoreImageVersionForNode: async (nodeId: string, storageKey: string) => {
        const { session } = get();
        if (!session?.savedStoryId) {
          return { status: 'failed', error: 'Save the story before restoring image versions.' } as RestoreBeatImageVersionResult;
        }
        const result = await restoreBeatImageVersionAction({
          storyId: session.savedStoryId,
          nodeId,
          storageKey,
        });
        if (result.status === 'restored') {
          const latest = get().session;
          const node = latest?.storyMap.nodes[nodeId];
          if (latest && node) {
            const patchedMap: StoryMap = {
              ...latest.storyMap,
              nodes: {
                ...latest.storyMap.nodes,
                [nodeId]: {
                  ...node,
                  data: normalizeBeatMediaFields({
                    ...node.data,
                    imageUrl: result.displayUrl,
                    persistedImageUrl: result.imageUrl,
                    imageStatus: 'ready',
                    imageError: undefined,
                    imageVersion: new Date().toISOString(),
                  }),
                },
              },
            };
            set({ session: deriveSessionFields(latest, patchedMap), saveStatus: 'saved' });
          }
        }
        return result;
      },

      clearAudioReady: () => {
        set({ audioReadyNodeId: null });
      },

      toggleStoryMode: () => {
        set((state) => ({ storyMode: !state.storyMode }));
      },

      saveStoryToCloud: async (userId: string, options: SaveStoryToCloudOptions = {}) => {
        if (activeSavePromise) {
          queuedSaveRequest = { userId, options };
          set({ error: LONG_SAVE_RETRY_MESSAGE });
          return activeSavePromise;
        }

        activeSavePromise = (async () => {
          let nextRequest: { userId: string; options?: SaveStoryToCloudOptions } | null = {
            userId,
            options,
          };

          try {
            while (nextRequest) {
              queuedSaveRequest = null;
              await get().saveStoryToCloudImmediate(nextRequest.userId, nextRequest.options);
              nextRequest = queuedSaveRequest;
            }
          } finally {
            activeSavePromise = null;
          }
        })();

        return activeSavePromise;
      },

      saveStoryToCloudImmediate: async (userId: string, options: SaveStoryToCloudOptions = {}) => {
        const { session } = get();
        if (!session) return;

        const saveStartedSession = session;
        const runtimeSettings = await resolveStorySaveRuntimeSettings(get().saveRuntimeSettings, options);
        cacheStorySaveRuntimeSettings(runtimeSettings);
        updateStoreSaveUi({
          isSaving: true,
          saveRuntimeSettings: runtimeSettings,
          saveWarning: null,
          error: null,
        });

        try {
          if (runtimeSettings.storyIncrementalAssetSyncEnabled) {
            const strippedMap = stripBase64FromStoryMap(session.storyMap);
            const strippedSession = buildPersistableSessionSnapshot(session, strippedMap, {
              savedByUserId: userId,
            });
            const { storyId } = await saveStoryAction(strippedSession, strippedMap);

            const latestSession = get().session;
            if (latestSession && latestSession !== saveStartedSession) {
              queuedSaveRequest = { userId, options };
            }

            const updatedSession = deriveSessionFields(
              { ...(latestSession || session), savedStoryId: storyId, savedByUserId: userId },
              (latestSession || session).storyMap
            );

            updateStoreSaveUi({
              session: updatedSession,
              isSaving: false,
              saveRuntimeSettings: runtimeSettings,
              error: queuedSaveRequest ? LONG_SAVE_RETRY_MESSAGE : null,
            });

            await stagePendingBeatImagesForSession(updatedSession, userId, storyId);
            void retryPendingBeatAssetSyncInternal(storyId);
            return;
          }

          // Persist story to DB first to get a stable storyId for asset paths.
          // On first save this inserts and returns a new ID; on subsequent saves it updates.
          const signedUrlSwapEnabled = await resolveSignedUrlSwapEnabled(runtimeSettings.storyAssetSignedUrlSwapEnabled);
          const strippedForId = buildPersistableSessionSnapshot(
            session,
            stripBase64FromStoryMap(session.storyMap)
          );
          const { storyId } = await saveStoryAction(strippedForId, strippedForId.storyMap);

          // Upload assets using the stable storyId so images + audio always share the same folder
          const nodeIds = Object.keys(session.storyMap.nodes);
          const basePath = `${userId}/${storyId}`;
          const assetMap = await uploadNodeAssets('story-assets', basePath, session.storyMap, nodeIds);

          // Replace base64 with storage URLs in the map
          const updatedMap = replaceBase64WithUrls(session.storyMap, assetMap);

          // Strip any remaining base64 and re-save with asset URLs
          const cleanMap = stripBase64FromStoryMap(updatedMap);
          const strippedSession = buildPersistableSessionSnapshot(session, cleanMap, {
            savedStoryId: storyId,
          });
          const { beatsWarning: w2 } = await saveStoryAction(strippedSession, cleanMap);

          // Update local session with savedStoryId but keep original base64 URLs
          // (storage URLs are for DB only — story-assets bucket is private)
          // Re-read latest session to preserve audioUrls written by concurrent narration
          const latestSession = get().session;
          const latestMap = latestSession?.storyMap || session.storyMap;
          let localDisplayMap = markUploadedAssetStatusesReady(latestMap, assetMap);

          if (signedUrlSwapEnabled) {
            try {
              const signedAssetMap = await signNodeAssetUrls('story-assets', assetMap);
              const preloadedSignedAssetMap = await buildPreloadedSignedAssetMap(localDisplayMap, signedAssetMap);
              if (Object.keys(preloadedSignedAssetMap).length > 0) {
                localDisplayMap = replaceBase64WithUrls(localDisplayMap, preloadedSignedAssetMap);
              }
            } catch (signError) {
              console.warn('Signed asset URL swap failed; keeping local base64 assets:', signError);
            }
          }

          if (latestSession && latestSession !== saveStartedSession) {
            queuedSaveRequest = { userId, options };
          }

          const updatedSession = deriveSessionFields(
            { ...(latestSession || session), savedStoryId: storyId, savedByUserId: userId },
            localDisplayMap
          );
          updateStoreSaveUi({
            session: updatedSession,
            isSaving: Boolean(queuedSaveRequest),
            saveRuntimeSettings: runtimeSettings,
            saveWarning: w2 ?? undefined,
            error: queuedSaveRequest ? LONG_SAVE_RETRY_MESSAGE : null,
          });
        } catch (error: any) {
          updateStoreSaveUi({
            isSaving: false,
            saveStatus: 'unsaved',
            error: error.message || 'Failed to save story',
          });
        }
      },

      loadStoryFromCloud: async (storyId: string) => {
        set({ isLoading: true, error: null, loadingClues: [], loadingStage: null, loadingReader: null });

        const persistenceUserId = await getLocalSessionUserId().catch(() => null);
        const cached = persistenceUserId
          ? await loadCachedTreeStory({ readerKind: 'story', storyId, userId: persistenceUserId }).catch(() => null)
          : null;
        const cachedNodeId = cached?.session.storyMap.currentNodeId;
        if (cached) {
          updateStoreSaveUi({
            session: deriveSessionFields(cached.session, cached.session.storyMap),
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            isSaving: false,
            saveStatus: 'saved',
          });
        }

        try {
          const session = await loadStoryAction(storyId);
          const hydratedMap = session.savedStoryId
            ? await overlayPendingBeatImages(session.storyMap, session.savedStoryId)
            : session.storyMap;
          const restoredMap = cachedNodeId && hydratedMap.nodes[cachedNodeId]
            ? { ...hydratedMap, currentNodeId: cachedNodeId }
            : hydratedMap;
          const fullSession = deriveSessionFields(session, restoredMap);

          if (process.env.NODE_ENV === 'development') {
            const nodeCount = Object.keys(fullSession.storyMap.nodes).length;
            const branchPoints = Object.values(fullSession.storyMap.nodes)
              .filter((n) => n.children.length > 1).length;
            console.log(`[loadStory] Loaded ${nodeCount} nodes, ${branchPoints} branch points`);
          }

          updateStoreSaveUi({
            session: fullSession,
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            isSaving: false,
            saveStatus: 'saved',
          });
          if (session.savedStoryId) {
            void retryPendingBeatAssetSyncInternal(session.savedStoryId);
            // Self-heal a narration batch job that stalled (e.g. a dropped worker
            // re-kick left a beat stuck 'pending'). Fire-and-forget: it only acts
            // on an in-flight job whose heartbeat has gone stale, so it can't fight
            // a worker that's actively running.
            void reconcileStoryNarration(session.savedStoryId).catch(() => {});
          }
          if (persistenceUserId) {
            void saveTreeStoryAndPrefetch({ readerKind: 'story', session: fullSession, userId: persistenceUserId });
          }
        } catch (error: any) {
          set({
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: cached ? null : error.message || 'Failed to load story',
          });
        }
      },

      // Lightweight poll for background (stateful/batch) image jobs: pull the
      // latest beat image fields from the cloud and merge ONLY those into the
      // in-memory map. Unlike loadStoryFromCloud this never flips isLoading (no
      // full-screen preloader flash) and never resets currentNodeId (so it can't
      // fight the reader's navigation). All beats already exist locally for these
      // stories — only their images stream in — so a field-level merge is safe.
      refreshBatchImages: async (storyId: string) => {
        const current = get().session;
        if (!current) return;
        const preservedNodeId = current.storyMap.currentNodeId;
        try {
          const fresh = await loadStoryAction(storyId);
          const mergedNodes = { ...current.storyMap.nodes };
          let changed = false;
          for (const [id, freshNode] of Object.entries(fresh.storyMap.nodes)) {
            const existing = mergedNodes[id];
            if (!existing) continue;
            const freshData = freshNode.data;
            const existingData = existing.data;
            const imageArrived =
              freshData.imageStatus !== existingData.imageStatus ||
              freshData.imageUrl !== existingData.imageUrl ||
              freshData.imageError !== existingData.imageError;
            // The same poll streams in background narration audio (server job).
            const audioArrived =
              freshData.audioStatus !== existingData.audioStatus ||
              freshData.audioUrl !== existingData.audioUrl ||
              freshData.audioError !== existingData.audioError;
            if (!imageArrived && !audioArrived) continue;
            changed = true;
            mergedNodes[id] = {
              ...existing,
              data: {
                ...existingData,
                ...(imageArrived
                  ? {
                      imageUrl: freshData.imageUrl ?? existingData.imageUrl,
                      imageStatus: freshData.imageStatus ?? existingData.imageStatus,
                      imageError: freshData.imageError,
                      imageGenerationMetadata:
                        freshData.imageGenerationMetadata ?? existingData.imageGenerationMetadata,
                    }
                  : {}),
                ...(audioArrived
                  ? {
                      audioUrl: freshData.audioUrl ?? existingData.audioUrl,
                      audioStatus: freshData.audioStatus ?? existingData.audioStatus,
                      audioError: freshData.audioError,
                      narrationMetadata: freshData.narrationMetadata ?? existingData.narrationMetadata,
                      storyTextOverlayEnabled:
                        freshData.storyTextOverlayEnabled ?? existingData.storyTextOverlayEnabled,
                      storyTextOverlayMode:
                        freshData.storyTextOverlayMode ?? existingData.storyTextOverlayMode,
                      storyTextOverlayStyle:
                        freshData.storyTextOverlayStyle ?? existingData.storyTextOverlayStyle,
                      storyTextOverlayCaptions:
                        freshData.storyTextOverlayCaptions ?? existingData.storyTextOverlayCaptions,
                      storyTextOverlayAlignment:
                        freshData.storyTextOverlayAlignment ?? existingData.storyTextOverlayAlignment,
                    }
                  : {}),
              },
            };
          }
          if (!changed) return;
          const mergedMap: StoryMap = {
            ...current.storyMap,
            nodes: mergedNodes,
            currentNodeId: preservedNodeId,
          };
          set({ session: deriveSessionFields({ ...current, storyMap: mergedMap }, mergedMap) });
        } catch {
          // Silent — the poll retries on its next tick.
        }
      },

      exploreStoryTree: async (storyId: string) => {
        set({ isLoading: true, error: null, loadingClues: [], loadingStage: null, loadingReader: null, lastPublishResult: null });

        const persistenceUserId = await getLocalSessionUserId().catch(() => null);
        const cached = persistenceUserId
          ? await loadCachedTreeStory({ readerKind: 'explore', storyId, userId: persistenceUserId }).catch(() => null)
          : null;
        const cachedNodeId = cached?.session.storyMap.currentNodeId;
        if (cached) {
          updateStoreSaveUi({
            session: deriveSessionFields(cached.session, cached.session.storyMap),
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            isSaving: false,
            saveStatus: 'saved',
          });
        }

        try {
          const session = await loadStoryTreeAction(storyId);
          const hydratedMap = session.savedStoryId
            ? await overlayPendingBeatImages(session.storyMap, session.savedStoryId)
            : session.storyMap;
          const restoredMap = cachedNodeId && hydratedMap.nodes[cachedNodeId]
            ? { ...hydratedMap, currentNodeId: cachedNodeId }
            : hydratedMap;
          const fullSession = deriveSessionFields(session, restoredMap);

          if (process.env.NODE_ENV === 'development') {
            const nodeCount = Object.keys(fullSession.storyMap.nodes).length;
            console.log(`[exploreStory] Loaded ${nodeCount} nodes, exploration=${fullSession.explorationMode}`);
          }

          updateStoreSaveUi({
            session: fullSession,
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            isSaving: false,
            saveStatus: 'saved',
          });
          if (session.savedStoryId) {
            void retryPendingBeatAssetSyncInternal(session.savedStoryId);
          }
          if (persistenceUserId) {
            void saveTreeStoryAndPrefetch({ readerKind: 'explore', session: fullSession, userId: persistenceUserId });
          }
        } catch (error: any) {
          set({
            isLoading: false,
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: cached ? null : error.message || 'Failed to load story for exploration',
          });
        }
      },

      refreshSignedUrls: async () => {
        const session = get().session;
        if (!session?.savedStoryId) return false;
        try {
          const refreshedMap = await refreshStoryMapAction(session.savedStoryId);
          const current = get().session;
          if (!current || current.savedStoryId !== session.savedStoryId) return false;
          const mergedMap = mergeRefreshedStoryMapAssetUrls(current.storyMap, refreshedMap);
          const hydratedMap = await overlayPendingBeatImages(mergedMap, session.savedStoryId);
          updateStoreSaveUi({
            session: deriveSessionFields(current, hydratedMap),
          });
          void retryPendingBeatAssetSyncInternal(session.savedStoryId);
          return true;
        } catch {
          // Existing URLs may still be valid; foreground or online events will retry.
          return false;
        }
      },

      retryPendingBeatAssetSync: async () => {
        const currentSession = get().session;
        if (!currentSession?.savedStoryId) return;
        const userId = await resolveCurrentUserId(currentSession.savedByUserId);
        if (userId) {
          await stagePendingBeatImagesForSession(currentSession, userId, currentSession.savedStoryId);
        }
        await retryPendingBeatAssetSyncInternal(currentSession.savedStoryId);
      },

      setPromptOnlyBeatImage: async (nodeId: string, imageDataUrl: string, options?: { uploadBody?: StorageUploadBody; maxImagesPerBeat?: number; optimizationMetadata?: ImageCompressionMetadata; storageExtension?: string }) => {
        const { session } = get();
        if (!session) return;

        const node = session.storyMap.nodes[nodeId];
        if (!node) return;

        const previousBeat = normalizeBeatMediaFields(node.data);
        const cap = Math.max(1, options?.maxImagesPerBeat ?? 3);
        if ((previousBeat.imageGallery?.length ?? 0) >= cap) {
          throw new Error(`You can only keep ${cap} images per beat. Delete one before uploading another.`);
        }

        const storageExtension = (options?.storageExtension || 'webp').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webp';
        const storageKeySuffix = `image-${crypto.randomUUID()}.${storageExtension}`;
        const uploadedAt = new Date().toISOString();
        const baseGalleryEntry = {
          url: imageDataUrl,
          uploadedAt,
          ...(options?.optimizationMetadata ? { optimizationMetadata: options.optimizationMetadata } : {}),
        };

        if (session.savedStoryId) {
          const userId = await resolveCurrentUserId(session.savedByUserId);
          if (userId) {
            const storageKey = `stories/${session.savedStoryId}/beats/${nodeId}/${storageKeySuffix}`;
            const fallbackStorageKey = `${userId}/${session.savedStoryId}/${nodeId}/${storageKeySuffix}`;

            // Optimistic local render — surface the chosen image instantly while the
            // cloud upload runs in the background.
            const optimisticGallery = [
              ...(previousBeat.imageGallery ?? []),
              { ...baseGalleryEntry, storageKey },
            ];
            updateStoreSaveUi({
              session: updateSessionBeat(session, nodeId, (beat) => ({
                ...beat,
                imageUrl: imageDataUrl,
                persistedImageUrl: undefined,
                imageStatus: 'pending',
                imageError: undefined,
                imageGallery: optimisticGallery,
              })),
              saveStatus: 'saving',
            });

            try {
              const uploadedUrl = await uploadAsset('story-assets', storageKey, options?.uploadBody ?? imageDataUrl, {
                access: 'private',
                assetType: 'storyboard_image',
                storyId: session.savedStoryId,
                nodeId,
                objectKey: storageKey,
                fallbackPath: fallbackStorageKey,
                contentType: options?.uploadBody instanceof Blob ? options.uploadBody.type : undefined,
              });
              const persistedStorageKey = uploadedUrl.startsWith('r2://') ? storageKey : fallbackStorageKey;
              const persistedGallery = optimisticGallery.map((entry) =>
                entry.storageKey === storageKey ? { ...entry, storageKey: persistedStorageKey, url: uploadedUrl } : entry
              );
              await updateBeatMediaState(session.savedStoryId, nodeId, {
                imageUrl: uploadedUrl,
                imageStatus: 'ready',
                imageError: null,
                imageGallery: persistedGallery,
              });

              // Local store keeps the data URL for display because the bucket is
              // private; the cloud URL only lives on persistedImageUrl + DB and is
              // re-signed on the next page load.
              const latestSession = get().session;
              if (!latestSession) return;
              updateStoreSaveUi({
                session: updateSessionBeat(latestSession, nodeId, (beat) => ({
                  ...beat,
                  imageUrl: isDataUrl(beat.imageUrl) ? beat.imageUrl : uploadedUrl,
                  persistedImageUrl: uploadedUrl,
                  imageStatus: 'ready',
                  imageError: undefined,
                  imageGallery: optimisticGallery,
                })),
                saveStatus: 'saved',
              });
              return;
            } catch (error) {
              const latestSession = get().session;
              if (latestSession) {
                updateStoreSaveUi({
                  session: updateSessionBeat(latestSession, nodeId, () => previousBeat),
                });
              }
              throw error;
            }
          }
        }

        // Unsaved local-only fallback — gallery still grows so users see the image
        // before any cloud sync happens. Storage key is provisional.
        const provisionalKey = `pending/${nodeId}/${storageKeySuffix}`;
        updateStoreSaveUi({
          session: updateSessionBeat(session, nodeId, (beat) => ({
            ...beat,
            imageUrl: imageDataUrl,
            persistedImageUrl: undefined,
            imageStatus: 'pending',
            imageError: undefined,
            imageGallery: [
              ...(previousBeat.imageGallery ?? []),
              { ...baseGalleryEntry, storageKey: provisionalKey },
            ],
          })),
          saveStatus: 'unsaved',
        });
      },

      selectPromptOnlyBeatImage: async (nodeId: string, storageKey: string) => {
        const { session } = get();
        if (!session) return;

        const node = session.storyMap.nodes[nodeId];
        if (!node) return;
        const beat = normalizeBeatMediaFields(node.data);
        const target = beat.imageGallery?.find((entry) => entry.storageKey === storageKey);
        if (!target) return;
        if (beat.imageUrl === target.url) return;

        if (session.savedStoryId) {
          await updateBeatMediaState(session.savedStoryId, nodeId, {
            imageUrl: target.url,
            imageStatus: 'ready',
            imageError: null,
          });
        }

        const latestSession = get().session;
        if (!latestSession) return;
        updateStoreSaveUi({
          session: updateSessionBeat(latestSession, nodeId, (existing) => ({
            ...existing,
            imageUrl: target.url,
            persistedImageUrl: target.url,
            imageStatus: 'ready',
            imageError: undefined,
          })),
          saveStatus: session.savedStoryId ? 'saved' : 'unsaved',
        });
      },

      deletePromptOnlyBeatImage: async (nodeId: string) => {
        const { session } = get();
        if (!session) return;

        if (session.savedStoryId) {
          await updateBeatMediaState(session.savedStoryId, nodeId, {
            imageUrl: null,
            imageStatus: 'not_requested',
            imageError: null,
          });
        }

        const latestSession = get().session;
        if (!latestSession) return;
        updateStoreSaveUi({
          session: updateSessionBeat(latestSession, nodeId, (beat) => ({
            ...beat,
            imageUrl: undefined,
            persistedImageUrl: undefined,
            imageStatus: 'not_requested',
            imageError: undefined,
          })),
          saveStatus: session.savedStoryId ? 'saved' : 'unsaved',
        });
      },

      permanentlyDeletePromptOnlyBeatImage: async (nodeId: string, storageKey: string) => {
        const { session } = get();
        if (!session) return;

        const node = session.storyMap.nodes[nodeId];
        if (!node) return;
        const beat = normalizeBeatMediaFields(node.data);
        const target = beat.imageGallery?.find((entry) => entry.storageKey === storageKey);
        if (!target) return;

        const remaining = (beat.imageGallery ?? []).filter((entry) => entry.storageKey !== storageKey);
        // Compare by storage key, not URL — the local store keeps data URLs while DB
        // holds public URLs and signed URLs are time-limited copies of either.
        const activeStorageKey = getActiveGalleryStorageKey(beat);
        const wasActive = activeStorageKey === storageKey;
        const fallback = wasActive
          ? [...remaining].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0]
          : undefined;

        if (!storageKey.startsWith('pending/')) {
          await deleteAsset('story-assets', storageKey);
        }

        if (session.savedStoryId) {
          await updateBeatMediaState(session.savedStoryId, nodeId, {
            imageGallery: remaining,
            ...(wasActive
              ? {
                  imageUrl: fallback?.url ?? null,
                  imageStatus: fallback ? 'ready' : 'not_requested',
                  imageError: null,
                }
              : {}),
          });
        }

        const latestSession = get().session;
        if (!latestSession) return;
        updateStoreSaveUi({
          session: updateSessionBeat(latestSession, nodeId, (existing) => ({
            ...existing,
            imageGallery: remaining,
            ...(wasActive
              ? {
                  imageUrl: fallback?.url,
                  persistedImageUrl: fallback?.url,
                  imageStatus: fallback ? 'ready' : 'not_requested',
                  imageError: undefined,
                }
              : {}),
          })),
          saveStatus: session.savedStoryId ? 'saved' : 'unsaved',
        });
      },

      setCharacterReferenceSheet: async (characterId: string, imageDataUrl: string, options?: { uploadBody?: StorageUploadBody; maxPerCharacter?: number; optimizationMetadata?: ImageCompressionMetadata; storageExtension?: string }) => {
        const { session } = get();
        if (!session) return;

        const character = findCharacterAcrossSession(session, characterId);
        if (!character) {
          throw new Error('Could not locate character to attach reference sheet.');
        }

        const cap = Math.max(1, options?.maxPerCharacter ?? 3);
        const existingGallery = character.referenceSheetGallery ?? [];
        if (existingGallery.length >= cap) {
          throw new Error(`You can only keep ${cap} reference sheets per character. Delete one before uploading another.`);
        }

        const previousSnapshot = applyCharacterPatchEverywhere(session, characterId, (existing) => ({ ...existing }));

        const uploadedAt = new Date().toISOString();
        const slug = slugifyCharacterName(character.name);
        const uploadStamp = formatCharacterSheetTimestamp(uploadedAt);
        const uploadId = crypto.randomUUID().slice(0, 8);
        const storageExtension = (options?.storageExtension || 'webp').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webp';
        const storageKeySuffix = `character-sheets/${slug}_${characterId}/${slug}-${uploadStamp}-${uploadId}.${storageExtension}`;
        const baseGalleryEntry = {
          url: imageDataUrl,
          uploadedAt,
          ...(options?.optimizationMetadata ? { optimizationMetadata: options.optimizationMetadata } : {}),
        };

        if (session.savedStoryId) {
          const userId = await resolveCurrentUserId(session.savedByUserId);
          if (userId) {
            const storageKey = `stories/${session.savedStoryId}/characters/${characterId}/${slug}-${uploadStamp}-${uploadId}.${storageExtension}`;
            const fallbackStorageKey = `${userId}/${session.savedStoryId}/${storageKeySuffix}`;
            const optimisticGallery: CharacterSheetGalleryEntry[] = [
              ...existingGallery,
              { ...baseGalleryEntry, storageKey },
            ];

            updateStoreSaveUi({
              session: applyCharacterPatchEverywhere(session, characterId, (existing) => ({
                ...existing,
                referenceSheetUrl: imageDataUrl,
                referenceSheetStorageKey: storageKey,
                referenceSheetUploadedAt: uploadedAt,
                referenceSheetGallery: optimisticGallery,
              })),
              saveStatus: 'saving',
            });

            try {
              const uploadedUrl = await uploadAsset('story-assets', storageKey, options?.uploadBody ?? imageDataUrl, {
                access: 'private',
                assetType: 'character_reference',
                storyId: session.savedStoryId,
                objectKey: storageKey,
                fallbackPath: fallbackStorageKey,
                contentType: options?.uploadBody instanceof Blob ? options.uploadBody.type : undefined,
              });
              const persistedStorageKey = uploadedUrl.startsWith('r2://') ? storageKey : fallbackStorageKey;
              const persistedGallery: CharacterSheetGalleryEntry[] = optimisticGallery.map((entry) =>
                entry.storageKey === storageKey ? { ...entry, storageKey: persistedStorageKey, url: uploadedUrl } : entry
              );
              await setCharacterReferenceSheetRecord(session.savedStoryId, characterId, {
                url: uploadedUrl,
                storageKey: persistedStorageKey,
                uploadedAt,
                gallery: persistedGallery,
                cap,
              });

              const latestSession = get().session;
              if (!latestSession) return;
              // Keep the local preview URL in memory because the private bucket
              // needs a server-signed URL to render after a reload.
              updateStoreSaveUi({
                session: applyCharacterPatchEverywhere(latestSession, characterId, (existing) => ({
                  ...existing,
                  referenceSheetUrl: isDataUrl(existing.referenceSheetUrl) ? existing.referenceSheetUrl : imageDataUrl,
                  referenceSheetStorageKey: storageKey,
                  referenceSheetUploadedAt: uploadedAt,
                  referenceSheetGallery: optimisticGallery,
                })),
                saveStatus: 'saved',
              });
              return;
            } catch (error) {
              updateStoreSaveUi({ session: previousSnapshot });
              throw error;
            }
          }
        }

        // Unsaved local-only fallback — gallery still grows so users see the
        // sheet in the modal before a cloud save runs. Storage key is provisional.
        const provisionalKey = `pending/character-sheets/${characterId}-${crypto.randomUUID()}.webp`;
        updateStoreSaveUi({
          session: applyCharacterPatchEverywhere(session, characterId, (existing) => ({
            ...existing,
            referenceSheetUrl: imageDataUrl,
            referenceSheetStorageKey: provisionalKey,
            referenceSheetUploadedAt: uploadedAt,
            referenceSheetGallery: [
              ...existingGallery,
              { ...baseGalleryEntry, storageKey: provisionalKey },
            ],
          })),
          saveStatus: 'unsaved',
        });
      },

      selectCharacterReferenceSheet: async (characterId: string, storageKey: string) => {
        const { session } = get();
        if (!session) return;

        const character = findCharacterAcrossSession(session, characterId);
        if (!character) return;
        const target = character.referenceSheetGallery?.find((entry) => entry.storageKey === storageKey);
        if (!target) return;
        if (character.referenceSheetStorageKey === storageKey) return;

        const previousSnapshot = applyCharacterPatchEverywhere(session, characterId, (existing) => ({ ...existing }));

        updateStoreSaveUi({
          session: applyCharacterPatchEverywhere(session, characterId, (existing) => ({
            ...existing,
            referenceSheetUrl: target.url,
            referenceSheetStorageKey: target.storageKey,
            referenceSheetUploadedAt: target.uploadedAt,
          })),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
        });

        if (!session.savedStoryId) return;

        try {
          await selectCharacterReferenceSheetRecord(session.savedStoryId, characterId, storageKey);
          updateStoreSaveUi({ saveStatus: 'saved' });
        } catch (error) {
          updateStoreSaveUi({ session: previousSnapshot });
          throw error;
        }
      },

      deleteCharacterReferenceSheet: async (characterId: string) => {
        const { session } = get();
        if (!session) return;

        const previousSnapshot = applyCharacterPatchEverywhere(session, characterId, (existing) => ({ ...existing }));

        updateStoreSaveUi({
          session: applyCharacterPatchEverywhere(session, characterId, clearCharacterActiveSheetFields),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
        });

        if (!session.savedStoryId) return;

        try {
          await clearCharacterReferenceSheetRecord(session.savedStoryId, characterId);
          updateStoreSaveUi({ saveStatus: 'saved' });
        } catch (error) {
          updateStoreSaveUi({ session: previousSnapshot });
          throw error;
        }
      },

      permanentlyDeleteCharacterReferenceSheet: async (characterId: string, storageKey: string) => {
        const { session } = get();
        if (!session) return;

        const character = findCharacterAcrossSession(session, characterId);
        if (!character) return;
        const target = character.referenceSheetGallery?.find((entry) => entry.storageKey === storageKey);
        if (!target) return;

        const remaining = (character.referenceSheetGallery ?? []).filter((entry) => entry.storageKey !== storageKey);
        const wasActive = character.referenceSheetStorageKey === storageKey;
        const fallback = wasActive ? pickFallbackGalleryEntry(remaining) : undefined;

        const previousSnapshot = applyCharacterPatchEverywhere(session, characterId, (existing) => ({ ...existing }));

        updateStoreSaveUi({
          session: applyCharacterPatchEverywhere(session, characterId, (existing) => {
            const next: Character = { ...existing, referenceSheetGallery: remaining };
            if (wasActive) {
              if (fallback) {
                next.referenceSheetUrl = fallback.url;
                next.referenceSheetStorageKey = fallback.storageKey;
                next.referenceSheetUploadedAt = fallback.uploadedAt;
              } else {
                delete next.referenceSheetUrl;
                delete next.referenceSheetStorageKey;
                delete next.referenceSheetUploadedAt;
              }
            }
            return next;
          }),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
        });

        try {
          if (!storageKey.startsWith('pending/')) {
            await deleteAsset('story-assets', storageKey);
          }
          if (session.savedStoryId) {
            await removeCharacterReferenceSheetEntryRecord(session.savedStoryId, characterId, storageKey);
            updateStoreSaveUi({ saveStatus: 'saved' });
          }
        } catch (error) {
          updateStoreSaveUi({ session: previousSnapshot });
          throw error;
        }
      },

      clearPublishResult: () => {
        set({ lastPublishResult: null });
      },

      clearError: () => {
        set({ error: null, errorAction: null });
      },

      submitImageBatch: async (scope?: ImageBatchScope) => {
        const { session } = get();
        const storyId = session?.savedStoryId;
        if (!storyId) {
          set({
            error: 'Save the story before generating visuals in the background.',
            errorAction: null,
          });
          return;
        }

        set({ isSubmittingImageBatch: true, imageBatchMessage: null, error: null, errorAction: null });
        try {
          const result = await submitStoryImageBatch({ storyId, ...(scope ? { scope } : {}) });
          set({ isSubmittingImageBatch: false, imageBatchMessage: result.message });

          // Reflect pending state locally so beats show placeholders immediately.
          if (result.status === 'submitted') {
            const current = get().session;
            if (current && current.savedStoryId === storyId) {
              const nodes = { ...current.storyMap.nodes };
              // For a current-path submit, only mark beats on the root→current
              // path — other branches were not batched and must not show pending.
              const scopedIds = scope === 'current_path'
                ? new Set(getPathToNode(current.storyMap, current.storyMap.currentNodeId).map((node) => node.id))
                : null;
              for (const [nodeId, node] of Object.entries(nodes)) {
                if (scopedIds && !scopedIds.has(nodeId)) continue;
                const beat = node.data;
                const hasImage = beat.imageStatus === 'ready' && beat.imageUrl;
                const hasPrompt = Boolean(
                  (beat.finalImagePromptText || beat.storyboardPromptText || beat.imagePrompt || '').trim()
                );
                if (!hasImage && hasPrompt) {
                  nodes[nodeId] = { ...node, data: { ...beat, imageStatus: 'pending', imageError: undefined } };
                }
              }
              set({ session: { ...current, storyMap: { ...current.storyMap, nodes } } });
            }
          }
        } catch (error) {
          set({
            isSubmittingImageBatch: false,
            imageBatchMessage: null,
            error: error instanceof Error ? error.message : 'Failed to submit background image batch.',
            errorAction: null,
          });
        }
      },

      submitStatefulVisuals: async (scope?: ImageBatchScope) => {
        const { session } = get();
        const storyId = session?.savedStoryId;
        if (!storyId) {
          set({
            error: 'Save the story before generating visuals in the background.',
            errorAction: null,
          });
          return;
        }

        set({ isSubmittingImageBatch: true, imageBatchMessage: null, error: null, errorAction: null });
        try {
          const episodic = session?.storyConfig?.episodicCharacters === true;
          const result = await submitStoryStatefulVisuals({ storyId, episodic, ...(scope ? { scope } : {}) });
          set({ isSubmittingImageBatch: false, imageBatchMessage: result.message });

          // Reflect pending state locally so beats show placeholders immediately.
          if (result.status === 'submitted') {
            const current = get().session;
            if (current && current.savedStoryId === storyId) {
              const nodes = { ...current.storyMap.nodes };
              const scopedIds = scope === 'current_path'
                ? new Set(getPathToNode(current.storyMap, current.storyMap.currentNodeId).map((node) => node.id))
                : null;
              for (const [nodeId, node] of Object.entries(nodes)) {
                if (scopedIds && !scopedIds.has(nodeId)) continue;
                const beat = node.data;
                const hasImage = beat.imageStatus === 'ready' && beat.imageUrl;
                const hasPrompt = Boolean(
                  (beat.finalImagePromptText || beat.storyboardPromptText || beat.imagePrompt || '').trim()
                );
                if (!hasImage && hasPrompt) {
                  nodes[nodeId] = { ...node, data: { ...beat, imageStatus: 'pending', imageError: undefined } };
                }
              }
              set({ session: { ...current, storyMap: { ...current.storyMap, nodes } } });
            }
          }
        } catch (error) {
          set({
            isSubmittingImageBatch: false,
            imageBatchMessage: null,
            error: error instanceof Error ? error.message : 'Failed to submit stateful visuals.',
            errorAction: null,
          });
        }
      },

      generateNarrationBatch: async () => {
        const { session } = get();
        const storyId = session?.savedStoryId;
        if (!session || !storyId) {
          set({ narrationBatchMessage: 'Save the story before generating narration.' });
          return;
        }

        // Narrate the current root→current-node path on a SERVER background job.
        // Unlike the old client loop (which died if the tab closed), this survives
        // the user leaving; audio streams onto beats as each is produced and the
        // banner's poll (refreshBatchImages) picks it up. Beats that already have
        // audio are skipped server-side.
        const path = getPathToNode(session.storyMap, session.storyMap.currentNodeId);
        const targets = path.filter((node) => !node.data.audioUrl && Boolean(node.data.storyText?.trim()));
        if (targets.length === 0) {
          set({ narrationBatchMessage: 'All beats on this path already have narration.' });
          return;
        }

        set({
          isGeneratingNarrationBatch: true,
          narrationBatchMessage: null,
          narrationBatchProgress: null,
          error: null,
          errorAction: null,
        });

        try {
          const result = await submitStoryNarrationBatch({ storyId });

          // Reflect pending state locally so the banner flips to "generating" and
          // starts polling immediately.
          if (result.status === 'submitted') {
            const current = get().session;
            if (current && current.savedStoryId === storyId) {
              const ids = new Set(targets.map((node) => node.id));
              const nodes = { ...current.storyMap.nodes };
              for (const [id, node] of Object.entries(nodes)) {
                if (!ids.has(id)) continue;
                nodes[id] = { ...node, data: { ...node.data, audioStatus: 'pending', audioError: undefined } };
              }
              set({ session: { ...current, storyMap: { ...current.storyMap, nodes } } });
            }
          }

          set({
            isGeneratingNarrationBatch: false,
            narrationBatchProgress: null,
            narrationBatchMessage: result.message,
          });
        } catch (error) {
          set({
            isGeneratingNarrationBatch: false,
            narrationBatchProgress: null,
            narrationBatchMessage: null,
            error: error instanceof Error ? error.message : 'Failed to submit narration.',
            errorAction: null,
          });
        }
      },

      generateAutomatedStory: async (prompt: string, config?: StoryConfig) => {
        // Case 02: build a complete linear story by random-walking one option per
        // beat, deferring images to a background job (stateful fast path by default,
        // or the cost-saver batch API), then let the user submit the visuals.
        const baseConfig = normalizeStoryConfig(config);
        const automatedConfig: StoryConfig = {
          ...baseConfig,
          imageDeliveryMode: baseConfig.imageGenerationMode === 'generate'
            ? (baseConfig.imageDeliveryMode === 'batch' || baseConfig.imageDeliveryMode === 'stateful'
                ? baseConfig.imageDeliveryMode
                : 'stateful')
            : baseConfig.imageDeliveryMode,
        };

        const total = automatedConfig.maxBeats ?? 6;
        set({ autoBuildProgress: { active: true, current: 0, total } });

        await get().startStory(prompt, automatedConfig);
        if (isWalkFatalError(get().error)) {
          set({ autoBuildProgress: null });
          return;
        }
        set({ autoBuildProgress: { active: true, current: 1, total } });

        const maxSteps = total + 2;
        for (let step = 0; step < maxSteps; step++) {
          const session = get().session;
          if (!session) break;
          const node = session.storyMap.nodes[session.storyMap.currentNodeId];
          if (!node || node.data.isEnding) break;
          const options = node.data.options ?? [];
          if (options.length === 0) break;
          const pick = options[Math.floor(Math.random() * options.length)];
          await get().continueStory(pick.id);
          // Only a genuine generation/billing failure aborts the walk. A benign
          // "save queued" notice must not — otherwise a slow autosave kills the run.
          if (isWalkFatalError(get().error)) {
            set({ autoBuildProgress: null });
            return;
          }
          const nextBeat = get().session?.storyMap.nodes[get().session!.storyMap.currentNodeId]?.data.beatNumber;
          set({ autoBuildProgress: { active: true, current: nextBeat ?? step + 2, total } });
        }

        // The walk ends on the terminal beat. Per-beat text was persisted
        // incrementally during the walk (full-session autosave is suppressed while
        // autoBuildProgress is active to avoid overlapping saves). Run one final
        // full save now so session-level state is consistent on the cloud.
        set({ autoBuildProgress: null });
        const finalSession = get().session;
        if (finalSession?.savedStoryId && !finalSession.sourceStoryOwnerId) {
          const saveUserId = await resolveCurrentUserId(finalSession.savedByUserId);
          if (saveUserId) {
            await get().saveStoryToCloud(saveUserId).catch((err) => {
              console.error('Automated story final save failed:', err);
            });
          }
        }

        // Images are NOT auto-submitted: the user reviews the story and taps
        // "Create all visuals" on the ending beat, which submits the current
        // root→ending path.
      },

      reconcileCurrentStoryBatch: async () => {
        const storyId = get().session?.savedStoryId;
        if (!storyId) return;
        try {
          // Resume any interrupted image and narration jobs in parallel.
          const [, , imageJobs] = await Promise.all([
            reconcileStoryBatch(storyId),
            reconcileStoryNarration(storyId).catch((error) =>
              console.error('reconcileStoryNarration failed:', error)
            ),
            reconcileStoryImageJobs(storyId).catch((error) => {
              console.error('reconcileStoryImageJobs failed:', error);
              return { inFlight: 0 };
            }),
          ]);
          // Re-hydrate so freshly materialized batch images/audio appear in the session.
          await get().loadStoryFromCloud(storyId);
          // Keep watching interactive server-pipeline jobs that are still running.
          if (imageJobs.inFlight > 0) {
            startImageJobPolling(storyId);
          }
        } catch (error) {
          console.error('reconcileCurrentStoryBatch failed:', error);
        }
      },
    });
    }
);
