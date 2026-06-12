import { create } from 'zustand';
import { StorySession, StoryBeat, StoryConfig, StoryMap, Character, CharacterSheetGalleryEntry, StoryboardPlan, PortraitReferenceConfig, PortraitTask, SeedBeatOutline, Option, type StoryAspectRatio } from '../types/story';
import { v4 as uuidv4 } from 'uuid';
import {
  buildFinalPortraitPrompt,
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
import { ensureNarratorVoiceLocked, generateAndPersistNarration, generateNarrationOnly, generateReelNarrationOnly, resolveNarrationVoiceServer } from '@/app/actions/narration';
import { saveReelNarrationSettingsAction } from '@/app/actions/reel-narration';
import { linkCostEventsToBeat } from '@/app/actions/cost-tracking';
import {
  authorizeCurrentUserBillableAction,
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from '@/app/actions/pricing-enforcement';
import { DEFAULT_STORY_CONFIG, deriveVisualStyleSummary, getSeedPlan, isReelStoryConfig, normalizeStoryConfig } from '@/lib/ai/story-config';
import { DEFAULT_REEL_STORY_SETTINGS, findReelDefiner, normalizeReelStorySettings } from '@/lib/reel/settings';
import { ensureCompleteCaptionSentence, hasCompleteCaptionEnding, splitTextIntoCompleteCaptionPanels } from '@/lib/reel/captions';
import { DEFAULT_REEL_TEXT_OVERLAY_STYLE, normalizeReelTextOverlayStyle } from '@/lib/reel/styles';
import { normalizeReelTransitionSettings, type ReelTransitionSettings } from '@/lib/reel/transitions';
import { normalizeReelNarrationSettings, type ReelNarrationSettings } from '@/lib/reel/narration';
import { getStoryboardSettings, getStoryAssetSignedUrlSwapEnabled, getStoryModelOverrides } from '@/app/actions/admin';
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
import {
  normalizeBeatMediaFields,
  isBeatRowNotFoundError,
  getBeatPersistedImageUrl,
  hasBeatImpossibleImageState,
  getActiveGalleryStorageKey,
} from '@/lib/types/beat-media';
import {
  createStoryLoadingStage,
  type StoryLoadingFlow,
  type StoryLoadingStage,
} from '@/lib/story/loading-progress';
import { dispatchPricingRuntimeRefresh } from '@/lib/pricing/runtime-events';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
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
} from '../utils/story-map';

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
  audioReadyNodeId: string | null;
  storyMode: boolean;
  isSaving: boolean;
  saveStatus: 'idle' | 'unsaved' | 'saving' | 'saved';
  saveWarning: string | null;
  saveRuntimeSettings: StorySaveRuntimeSettings;
  lastPublishResult: PublishResult | null;
  startStory: (prompt: string, config?: StoryConfig) => Promise<void>;
  startReel: (prompt: string, config?: StoryConfig) => Promise<void>;
  continueStory: (optionId: string) => Promise<void>;
  navigateToNode: (nodeId: string) => void;
  resetStory: () => void;
  restartExploration: () => void;
  setLoadingClues: (clues: string[]) => void;
  generateNarrationForNode: (nodeId: string) => Promise<void>;
  updateReelPanelCaptions: (nodeId: string, panelTexts: string[]) => Promise<{ clearedNarration: boolean }>;
  updateReelNarrationSettings: (
    settings: ReelNarrationSettings,
    options?: { preserveExistingNarration?: boolean }
  ) => Promise<{ clearedNarration: boolean }>;
  updateReelTextOverlaySettings: (settings: { enabled: boolean; style: StoryBeat['reelTextOverlayStyle'] }) => Promise<void>;
  updateReelTextOverlayStyle: (style: StoryBeat['reelTextOverlayStyle']) => Promise<void>;
  updateReelTransitionSettings: (settings: ReelTransitionSettings) => Promise<void>;
  regenerateImageForNode: (nodeId: string) => Promise<void>;
  clearAudioReady: () => void;
  toggleStoryMode: () => void;
  setSaveRuntimeSettings: (settings: Partial<StorySaveRuntimeSettings>) => void;
  saveStoryToCloud: (userId: string, options?: SaveStoryToCloudOptions) => Promise<void>;
  saveStoryToCloudImmediate: (userId: string, options?: SaveStoryToCloudOptions) => Promise<void>;
  loadStoryFromCloud: (storyId: string) => Promise<void>;
  exploreStoryTree: (storyId: string) => Promise<void>;
  refreshSignedUrls: () => Promise<void>;
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
    .map((character) => buildReferenceFromValue('character', character.portraitBase64 || character.portraitUrl))
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
  const nextCharacters = beat.characters.map((character) => {
    const reference = referencesById.get(character.id);
    if (!reference) {
      return character;
    }

    return {
      ...reference,
      ...character,
      portraitBase64: character.portraitBase64 || reference.portraitBase64,
      portraitUrl: character.portraitUrl || reference.portraitUrl,
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

async function resolveCurrentUserId(fallbackUserId?: string): Promise<string | null> {
  if (fallbackUserId) {
    return fallbackUserId;
  }

  try {
    const supabase = createBrowserClient();
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
  step: StoryLoadingStage['currentStepKey']
) {
  setState({
    loadingStage: createStoryLoadingStage(flow, step),
  });
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

function buildPricingErrorState(
  authorization: PricingBillableActionAuthorization,
  actionLabel: 'start_story' | 'continue_story'
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

  const actionText = actionLabel === 'start_story' ? 'start this story' : 'create a new path';
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
  costTelemetry?: CostTelemetryContext
): Promise<ReferenceImage[]> {
  if (!storyboardPlan.portraitTasks.length) {
    return [];
  }

  const orderedTasks = sortPortraitTasksForGeneration(beat.characters, storyboardPlan.portraitTasks);
  const prioritizedSheetTaskIds = resolvePrioritizedSheetTaskIds(orderedTasks, portraitReferenceConfig);

  const portraits = await Promise.all(
    orderedTasks.map(async (task) => {
      const character = beat.characters.find((candidate) => candidate.id === task.characterId);
      if (!character) {
        return null;
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
          costTelemetry
        );
        character.portraitBase64 = portraitResult.imageUrl;
        task.finalPromptText = portraitResult.finalPromptText;
        return { type: 'character' as const, dataUrl: portraitResult.imageUrl };
      } catch (error) {
        console.error(`Portrait generation failed for storyboard task ${task.characterId}:`, error);
        return null;
      }
    })
  );

  return portraits.filter((portrait): portrait is NonNullable<typeof portrait> => Boolean(portrait));
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

  return isPromptOnlyStoryConfig(storyConfig)
    ? 'start_story_initial_beat_prompt_only' as const
    : 'start_story_initial_beat' as const;
}

function getContinueStoryActionKey(storyConfig: StoryConfig) {
  if (isReelStoryConfig(storyConfig)) {
    throw new Error('continueStory is not supported for reel sessions; reels are generated in one shot.');
  }

  return isPromptOnlyStoryConfig(storyConfig)
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

function applyReelBeatMetadata(beat: StoryBeat, storyConfig: StoryConfig): StoryBeat {
  if (!isReelStoryConfig(storyConfig)) return beat;
  return {
    ...beat,
    reelTextOverlayEnabled: storyConfig.reel.textOverlayEnabled,
    reelTextOverlayStyle: normalizeReelTextOverlayStyle(storyConfig.reel.textOverlayStyle ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE),
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

      startStory: async (prompt: string, config?: StoryConfig) => {
        const storyConfig = normalizeStoryConfig(config || DEFAULT_STORY_CONFIG);
        if (isReelStoryConfig(storyConfig)) {
          return get().startReel(prompt, storyConfig);
        }
        const seededStory = isSeededStoryConfig(storyConfig);
        const promptOnly = isPromptOnlyStoryConfig(storyConfig);
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
        try {
          billingAuthorization = await measureAsyncStep(
            timingSteps,
            'wallet_authorization',
            'Authorize story start',
            () => authorizeCurrentUserBillableAction({
              actionKey: startStoryActionKey,
              idempotencyKey: `start_story:${initialSessionId}`,
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

        // Fetch active model config from DB (falls back to hardcoded defaults on error)
        let modelOverrides: StoryModelOverrides | undefined;
        try {
          modelOverrides = await measureAsyncStep(
            timingSteps,
            'model_overrides',
            'Load model and prompt overrides',
            () => getStoryModelOverrides()
          );
        } catch {
          // Non-critical: story.ts has hardcoded fallbacks
        }

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
            characters: [],
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
          const storyboardPlan = await measureAsyncStep(
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
          beat.storyboardPlan = storyboardPlan;
          beat.storyboardPromptText = renderStoryboardPlan(storyboardPlan);
          beat.isStoryboard = true;
          if (isReelStoryConfig(storyConfig)) {
            beat = applyReelBeatMetadata(beat, storyConfig);
            beat.reelCaptions = buildReelPanelCaptions(beat, storyboardPlan, {
              textLength: storyConfig.reel.textLength,
              reelSettings: modelOverrides?.reelSettings,
              storyConfig,
            });
          }

          const portraitRefs = initialSession.enableReferenceImages && !promptOnly
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
                  costPhase(baseCostTelemetry, 'portrait_generation')
                ),
                {
                  portraitTaskCount: storyboardPlan.portraitTasks.length,
                  portraitReferenceMode: storyConfig.portraitReferences.mode,
                  portraitReferenceQuality: storyConfig.portraitReferences.quality,
                }
              )
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

          // Track resolved audio URL for merging after image resolves
          let resolvedAudioUrl: string | undefined;
          let resolvedNarrationMetadata: StoryBeat['narrationMetadata'];
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

          // Fire-and-forget: once voice + storyId resolve, start narration in parallel with image
          // Reels skip auto-narration — user triggers it on-demand via the speaker icon.
          if (storyPrompt.toLowerCase() !== 'mock' && !isReelStoryConfig(storyConfig)) {
            Promise.all([lockedVoicePromise, earlySavePromise]).then(([voiceResolution, storyId]) => {
              set({ isGeneratingAudio: true });
              const narrationStartedAt = nowMs();

              const isReelNarration = isReelStoryConfig(storyConfig);
              const reelNarrationOptions = isReelNarration
                ? {
                  reelCaptions: beat.reelCaptions,
                  reelSettings: modelOverrides?.reelSettings,
                  narrationSettings: storyConfig.reel.narrationSettings,
                  generationMode: 'final' as const,
                  panelPauseMs: normalizeReelTransitionSettings(storyConfig.reel.transitionSettings).pauseMs,
                }
              : {};
              const narrationFn: Promise<{ audioUrl: string; reelCaptions?: StoryBeat['reelCaptions']; narrationMetadata?: StoryBeat['narrationMetadata'] }> = storyId
                ? generateAndPersistNarration(
                  beat.storyText, initialSession.tone!, initialSession.genre!,
                  voiceResolution.voiceId, voiceResolution.languageCode, storyId, rootNodeId,
                  costPhase({ ...baseCostTelemetry, storyId }, 'tts'),
                  {
                    taskKey: isReelNarration ? 'reel_tts' : 'tts',
                    narrationStyle: getReelNarrationStyle(modelOverrides, storyConfig),
                    ...reelNarrationOptions,
                  }
                )
                : isReelNarration
                  ? generateReelNarrationOnly(
                    beat.storyText, initialSession.tone!, initialSession.genre!,
                    voiceResolution.voiceId, voiceResolution.languageCode,
                    costPhase(baseCostTelemetry, 'tts'),
                    {
                      narrationStyle: getReelNarrationStyle(modelOverrides, storyConfig),
                      ...reelNarrationOptions,
                    }
                  )
                  : generateNarrationOnly(
                  beat.storyText, initialSession.tone!, initialSession.genre!,
                  voiceResolution.voiceId, voiceResolution.languageCode,
                  costPhase(baseCostTelemetry, 'tts'),
                  {
                    taskKey: 'tts',
                    narrationStyle: getReelNarrationStyle(modelOverrides, storyConfig),
                  }
                ).then((audioUrl) => ({ audioUrl }));

              narrationFn.then(({ audioUrl, reelCaptions, narrationMetadata }) => {
                console.info('[timing:start_story.narration]', {
                  durationMs: Math.round(nowMs() - narrationStartedAt),
                  mode: storyId ? 'persisted' : 'base64_fallback',
                  success: true,
                });
                resolvedAudioUrl = audioUrl;
                resolvedNarrationMetadata = narrationMetadata;
                if (reelCaptions?.length) {
                  beat.reelCaptions = reelCaptions;
                }
                const latestSession = get().session;
                if (!latestSession) return;
                const rootId = latestSession.storyMap.rootNodeId;
                const rootNode = latestSession.storyMap.nodes[rootId];
                if (!rootNode || rootNode.data.audioUrl) return;

                const updatedNodes = {
                  ...latestSession.storyMap.nodes,
                  [rootId]: {
                    ...rootNode,
                    data: normalizeBeatMediaFields({
                      ...rootNode.data,
                      audioUrl,
                      ...(reelCaptions?.length ? { reelCaptions } : {}),
                      ...(narrationMetadata ? {
                        narrationMetadata,
                        activeNarrationPreviewId: undefined,
                      } : {}),
                      narrationVoiceId: voiceResolution.voiceId,
                      audioStatus: storyId ? 'ready' : 'not_requested',
                      audioError: undefined,
                    }),
                  },
                };
                const updatedMap = { ...latestSession.storyMap, nodes: updatedNodes };
                set({
                  session: deriveSessionFields(latestSession, updatedMap),
                  isGeneratingAudio: false,
                  audioReadyNodeId: rootId,
                });
              }).catch((err) => {
                console.info('[timing:start_story.narration]', {
                  durationMs: Math.round(nowMs() - narrationStartedAt),
                  mode: storyId ? 'persisted' : 'base64_fallback',
                  success: false,
                  message: err instanceof Error ? err.message : 'Narration generation failed',
                });
                console.error('Narration generation failed:', err);
                const latestSession = get().session;
                if (storyId && latestSession?.storyMap.nodes[rootNodeId]) {
                  set({
                    session: updateSessionBeat(latestSession, rootNodeId, (rootBeat) => ({
                      ...rootBeat,
                      audioStatus: 'failed',
                      audioError: err instanceof Error ? err.message : 'Narration generation failed',
                    })),
                    isGeneratingAudio: false,
                  });
                } else {
                  set({ isGeneratingAudio: false });
                }
              });
            }).catch((err) => {
              console.error('Narration pipeline failed:', err);
              set({ isGeneratingAudio: false });
            });
          }

          // Step A: Generate portraits first (parallelized) so beat 1 scene can use
          // them as references - makes portrait the single source of truth from the very first image.
          // Beat 1 portraits are already resolved before storyboard rendering so Gemini can
          // use them as direct visual references during the first 2x2 board generation.
          setLoadingStage(set, 'start_story', 'image');
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
                  () => generateImage(
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
                    getReelVisualStylePromptOptions(modelOverrides, storyConfig)
                  ),
                  {
                    referenceCount: portraitRefs.length,
                    beatNumber: beat.beatNumber,
                  }
                ),
            lockedVoicePromise,
          ]);

          beat.finalImagePromptText = imageResult.finalPromptText;
          beat.imageUrl = promptOnly ? undefined : imageResult.imageUrl;

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

          if (reservationId) {
            setLoadingStage(set, 'start_story', 'finish');
            await measureAsyncStep(
              timingSteps,
              'billing_finalize',
              'Finalize story-start coin spend',
              () => finalizeCurrentUserBillableAction({
                reservationId,
                storyId: earlySavedStoryId ?? null,
                relatedEntityId: rootNodeId,
                metadata: {
                  action: startStoryActionKey,
                  storySessionId: initialSessionId,
                  title: resolvedTitle,
                },
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
                persistedImageUrl: undefined,
                imageStatus: promptOnly ? 'not_requested' : 'pending',
                audioStatus: resolvedAudioUrl
                  ? (earlySavedStoryId ? 'ready' : 'not_requested')
                  : storyPrompt.toLowerCase() !== 'mock' && earlySavedStoryId
                  ? 'pending'
                  : 'not_requested',
              }),
              imageUrl: promptOnly ? undefined : imageResult.imageUrl,
              narrationVoiceId: narratorVoiceResolution.voiceId,
              ...(resolvedAudioUrl ? { audioUrl: resolvedAudioUrl } : {}),
              ...(resolvedNarrationMetadata ? {
                narrationMetadata: resolvedNarrationMetadata,
                activeNarrationPreviewId: undefined,
              } : {}),
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

          // If narration already resolved, signal readiness immediately
          const audioExtra = resolvedAudioUrl
            ? { isGeneratingAudio: false, audioReadyNodeId: rootNodeId }
            : {};

          set({
            session: fullSession,
            isLoading: false,
            saveStatus: 'unsaved',
            loadingClues: [],
            loadingStage: null,
            loadingReader: null,
            error: null,
            errorAction: null,
            ...audioExtra,
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
          if (earlySavedStoryId && earlySavedByUserId && imageResult.imageUrl) {
            const runtimeSettings = await resolveStorySaveRuntimeSettings(get().saveRuntimeSettings);
            if (runtimeSettings.storyIncrementalAssetSyncEnabled) {
              await putPendingBeatImage({
                storyId: earlySavedStoryId,
                userId: earlySavedByUserId,
                nodeId: rootNodeId,
                imageDataUrl: imageResult.imageUrl,
              });
              void retryPendingBeatAssetSyncInternal(earlySavedStoryId);
            }
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
          billingAuthorization = await authorizeCurrentUserBillableAction({
            actionKey: startActionKey,
            idempotencyKey: `start_reel:${initialSessionId}`,
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
          modelOverrides = await getStoryModelOverrides();
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
                getReelVisualStylePromptOptions(modelOverrides, storyConfig)
              );
              beat.imageUrl = imageResult.imageUrl;
              beat.finalImagePromptText = imageResult.finalPromptText;
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

          if (reservationId) {
            setLoadingStage(set, 'start_story', 'finish');
            try {
              await finalizeCurrentUserBillableAction({
                reservationId,
                storyId: savedStoryId ?? null,
                relatedEntityId: rootNodeId,
                metadata: {
                  action: startActionKey,
                  storySessionId: initialSessionId,
                  beatCount,
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
        const promptOnly = isPromptOnlyStoryConfig(session.storyConfig);
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

        let billingAuthorization: PricingBillableActionAuthorization;
        try {
          billingAuthorization = await measureAsyncStep(
            timingSteps,
            'wallet_authorization',
            'Authorize branch continuation',
            () => authorizeCurrentUserBillableAction({
              actionKey: continueStoryActionKey,
              idempotencyKey: `continue_story:${session.savedStoryId || session.storySessionId}:${session.storyMap.currentNodeId}:${optionId}:${uuidv4()}`,
              relatedStoryId: session.savedStoryId ?? null,
              relatedNodeId: session.storyMap.currentNodeId,
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

          // Fetch active model config (non-blocking fallback to defaults)
          let modelOverrides: StoryModelOverrides | undefined;
          try {
            modelOverrides = await measureAsyncStep(
              timingSteps,
              'model_overrides',
              'Load model and prompt overrides',
              () => getStoryModelOverrides()
            );
          } catch { /* falls back to hardcoded defaults */ }

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
          }
          const portraitRefs = session.enableReferenceImages && !promptOnly
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
                  costPhase(baseCostTelemetry, 'portrait_generation')
                ),
                {
                  portraitTaskCount: storyboardPlan.portraitTasks.length,
                  portraitReferenceMode: session.storyConfig.portraitReferences.mode,
                  portraitReferenceQuality: session.storyConfig.portraitReferences.quality,
                }
              )
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

          // Track resolved audio URL — if narration finishes before image,
          // the .then() can't update the store (node doesn't exist yet),
          // so we capture the URL and apply it during the merge.
          let resolvedAudioUrl: string | undefined;
          let resolvedNarrationMetadata: StoryBeat['narrationMetadata'];

          // Fire-and-forget: start narration in parallel with image generation
          // Voice is locked at story start — use it directly or fall back to default constant
          const voiceResolution = await measureAsyncStep(
            timingSteps,
            'voice_resolution',
            'Resolve locked narrator voice',
            () => resolveNarratorVoice(session, costPhase(baseCostTelemetry, 'voice_selection'))
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
          let narrationPromise: Promise<void> | null = null;
          if (session.userPrompt.toLowerCase() !== 'mock') {
            set({ isGeneratingAudio: true });
            const narrationStartedAt = nowMs();

            const handleNarrationResolved = (
              audioUrl: string,
              reelCaptions?: StoryBeat['reelCaptions'],
              narrationMetadata?: StoryBeat['narrationMetadata']
            ) => {
              console.info('[timing:continue_story.narration]', {
                durationMs: Math.round(nowMs() - narrationStartedAt),
                mode: session.savedStoryId ? 'persisted' : 'base64_fallback',
                success: true,
                nodeId: newNodeId,
              });
              resolvedAudioUrl = audioUrl;
              resolvedNarrationMetadata = narrationMetadata;
              if (reelCaptions?.length) {
                beat.reelCaptions = reelCaptions;
              }
              if (narrationMetadata) {
                beat.narrationMetadata = narrationMetadata;
                beat.activeNarrationPreviewId = undefined;
              }
              const latestSession = get().session;
              if (!latestSession) return;
              const node = latestSession.storyMap.nodes[newNodeId];
              if (!node || node.data.audioUrl) return;

              const updatedNodes = {
                ...latestSession.storyMap.nodes,
                [newNodeId]: {
                  ...node,
                  data: normalizeBeatMediaFields({
                    ...node.data,
                    audioUrl,
                    ...(reelCaptions?.length ? { reelCaptions } : {}),
                    ...(narrationMetadata ? {
                      narrationMetadata,
                      activeNarrationPreviewId: undefined,
                    } : {}),
                    narrationVoiceId: voiceForBeat,
                    audioStatus: session.savedStoryId ? 'ready' : 'not_requested',
                    audioError: undefined,
                  }),
                },
              };
              const updatedMap = { ...latestSession.storyMap, nodes: updatedNodes };
              set({
                session: deriveSessionFields(latestSession, updatedMap),
                isGeneratingAudio: false,
                audioReadyNodeId: newNodeId,
              });
            };

            const handleNarrationError = (err: unknown) => {
              console.info('[timing:continue_story.narration]', {
                durationMs: Math.round(nowMs() - narrationStartedAt),
                mode: session.savedStoryId ? 'persisted' : 'base64_fallback',
                success: false,
                nodeId: newNodeId,
                message: err instanceof Error ? err.message : 'Narration generation failed',
              });
              console.error('Narration generation failed:', err);
              const latestSession = get().session;
              if (session.savedStoryId && latestSession?.storyMap.nodes[newNodeId]) {
                set({
                  session: updateSessionBeat(latestSession, newNodeId, (beatState) => ({
                    ...beatState,
                    audioStatus: 'failed',
                    audioError: err instanceof Error ? err.message : 'Narration generation failed',
                  })),
                  isGeneratingAudio: false,
                });
              } else {
                set({ isGeneratingAudio: false });
              }
            };

            const isReelNarration = isReelStoryConfig(session.storyConfig);
            const reelNarrationOptions = isReelNarration
              ? {
                  reelCaptions: beat.reelCaptions,
                  reelSettings: modelOverrides?.reelSettings,
                  narrationSettings: session.storyConfig.reel.narrationSettings,
                  generationMode: 'final' as const,
                  panelPauseMs: normalizeReelTransitionSettings(session.storyConfig.reel.transitionSettings).pauseMs,
                }
              : {};

            if (session.savedStoryId) {
              // Server-side: generate + upload to Supabase in one round trip
              narrationPromise = generateAndPersistNarration(
                beat.storyText, session.tone, session.genre,
                voiceForBeat, narrationLanguageCode,
                session.savedStoryId, newNodeId,
                costPhase(baseCostTelemetry, 'tts'),
                {
                  taskKey: isReelNarration ? 'reel_tts' : 'tts',
                  narrationStyle: getReelNarrationStyle(modelOverrides, session.storyConfig),
                  ...reelNarrationOptions,
                }
              ).then(({ audioUrl, reelCaptions, narrationMetadata }) => handleNarrationResolved(audioUrl, reelCaptions, narrationMetadata))
                .catch(handleNarrationError);
            } else if (isReelNarration) {
              narrationPromise = generateReelNarrationOnly(
                beat.storyText, session.tone, session.genre,
                voiceForBeat, narrationLanguageCode,
                costPhase(baseCostTelemetry, 'tts'),
                {
                  narrationStyle: getReelNarrationStyle(modelOverrides, session.storyConfig),
                  ...reelNarrationOptions,
                }
              ).then(({ audioUrl, reelCaptions, narrationMetadata }) => handleNarrationResolved(audioUrl, reelCaptions, narrationMetadata))
                .catch(handleNarrationError);
            } else {
              // Fallback: generate only (no persistence yet)
              narrationPromise = generateNarrationOnly(
                beat.storyText, session.tone, session.genre,
                voiceForBeat, narrationLanguageCode,
                costPhase(baseCostTelemetry, 'tts'),
                {
                  taskKey: 'tts',
                  narrationStyle: getReelNarrationStyle(modelOverrides, session.storyConfig),
                }
              ).then(handleNarrationResolved)
                .catch(handleNarrationError);
            }
          }

          const referenceImages = buildStoryboardReferenceImages(
            beat,
            currentNode.data.imageUrl,
            portraitRefs
          );

          // Block loading on image only
          setLoadingStage(set, 'continue_story', 'image');
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
                  getReelVisualStylePromptOptions(modelOverrides, session.storyConfig)
                ),
                {
                  beatNumber: beat.beatNumber,
                  referenceCount: referenceImages.length,
                }
              );
          beat.finalImagePromptText = imageResult.finalPromptText;
          beat.imageUrl = promptOnly ? undefined : imageResult.imageUrl;

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
              // Re-apply new node, merging in audioUrl if narration already resolved
              [newNodeId]: {
                ...updatedMap.nodes[newNodeId],
                data: normalizeBeatMediaFields({
                  ...updatedMap.nodes[newNodeId].data,
                  narrationVoiceId: voiceForBeat,
                  persistedImageUrl: undefined,
                  ...(resolvedAudioUrl ? { audioUrl: resolvedAudioUrl } : {}),
                  ...(resolvedNarrationMetadata ? {
                    narrationMetadata: resolvedNarrationMetadata,
                    activeNarrationPreviewId: undefined,
                  } : {}),
                  imageStatus: promptOnly ? 'not_requested' : 'pending',
                  audioStatus: resolvedAudioUrl
                    ? (session.savedStoryId ? 'ready' : 'not_requested')
                    : session.userPrompt.toLowerCase() !== 'mock' && session.savedStoryId
                    ? 'pending'
                    : 'not_requested',
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
              () => finalizeCurrentUserBillableAction({
                reservationId,
                storyId: session.savedStoryId ?? null,
                relatedEntityId: newNodeId,
                metadata: {
                  action: continueStoryActionKey,
                  optionId,
                  optionLabel: selectedOption.label,
                  parentNodeId: parentId,
                  newNodeId,
                },
              })
            );
            shouldReleaseReservation = false;
          }

          // If narration already resolved, signal readiness immediately
          const audioExtra = resolvedAudioUrl
            ? { isGeneratingAudio: false, audioReadyNodeId: newNodeId }
            : {};

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
            ...audioExtra,
          });
          if (session.savedStoryId && imageResult.imageUrl) {
            const uploadUserId = (await resolveCurrentUserId(session.savedByUserId)) ?? undefined;
            const runtimeSettings = await resolveStorySaveRuntimeSettings(get().saveRuntimeSettings);
            if (uploadUserId && runtimeSettings.storyIncrementalAssetSyncEnabled) {
              await putPendingBeatImage({
                storyId: session.savedStoryId,
                userId: uploadUserId,
                nodeId: newNodeId,
                imageDataUrl: imageResult.imageUrl,
              });
              void retryPendingBeatAssetSyncInternal(session.savedStoryId);
            }
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
        set({ session: deriveSessionFields(session, updatedMap) });

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
          const modelOverrides = isReelStoryConfig(session.storyConfig)
            ? await getStoryModelOverrides().catch(() => undefined)
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

          if (session.savedStoryId) {
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
            audioUrl = await generateNarrationOnly(
              node.data.storyText, session.tone, session.genre,
              voiceName, narrationLanguageCode,
              costPhase(baseCostTelemetry, 'tts'),
              {
                taskKey: 'tts',
                narrationStyle: getReelNarrationStyle(modelOverrides, session.storyConfig),
              }
            );
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
                ...(reelCaptions?.length ? { reelCaptions } : {}),
                ...(narrationMetadata ? {
                  narrationMetadata,
                  activeNarrationPreviewId: undefined,
                } : {}),
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

      updateReelPanelCaptions: async (nodeId: string, panelTexts: string[]) => {
        const { session } = get();
        if (!session || !isReelStoryConfig(session.storyConfig)) {
          return { clearedNarration: false };
        }

        const node = session.storyMap.nodes[nodeId];
        if (!node) {
          return { clearedNarration: false };
        }

        const normalizedTexts = splitTextIntoCompleteCaptionPanels(
          panelTexts.filter(Boolean).join(' '),
          4
        ).map((text, index) => ensureCompleteCaptionSentence(
          text || (hasCompleteCaptionEnding(panelTexts[index] || '') ? panelTexts[index] : '')
        ));
        if (!normalizedTexts.some(Boolean)) {
          throw new Error('Add text to at least one panel before saving.');
        }

        const nextStoryText = normalizedTexts.filter(Boolean).join(' ');
        const nextCaptions: NonNullable<StoryBeat['reelCaptions']> = normalizedTexts.map((text, panelIndex) => ({
          panelIndex,
          text,
        }));
        const clearedNarration = Boolean(node.data.audioUrl || node.data.audioStatus === 'ready' || node.data.audioStatus === 'pending');

        const nextMap = updateStoryMapBeat(session.storyMap, nodeId, (beat) => ({
          ...beat,
          storyText: nextStoryText,
          reelCaptions: nextCaptions,
          ...(clearedNarration
            ? {
                audioUrl: undefined,
                audioStatus: 'not_requested' as const,
                audioError: undefined,
                narrationVoiceId: undefined,
              }
            : {}),
        }));

        updateStoreSaveUi({
          session: deriveSessionFields(session, nextMap),
          isSaving: Boolean(session.savedStoryId),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
          error: null,
          audioReadyNodeId: clearedNarration && get().audioReadyNodeId === nodeId ? null : get().audioReadyNodeId,
        });

        if (!session.savedStoryId) {
          return { clearedNarration };
        }

        try {
          await saveBeatAction(session.savedStoryId, nodeId, nextMap.nodes[nodeId]);
          if (clearedNarration) {
            await updateBeatMediaState(session.savedStoryId, nodeId, {
              audioUrl: null,
              audioStatus: 'not_requested',
              audioError: null,
            });
          }

          const latestSession = get().session;
          if (latestSession?.storyMap.nodes[nodeId]) {
            const confirmedMap = updateStoryMapBeat(latestSession.storyMap, nodeId, (beat) => ({
              ...beat,
              storyText: nextStoryText,
              reelCaptions: nextCaptions,
              ...(clearedNarration
                ? {
                    audioUrl: undefined,
                    audioStatus: 'not_requested' as const,
                    audioError: undefined,
                    narrationVoiceId: undefined,
                  }
                : {}),
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
        } catch (error) {
          updateStoreSaveUi({
            isSaving: false,
            saveStatus: 'unsaved',
            error: error instanceof Error ? error.message : 'Failed to save reel text.',
          });
          throw error;
        }

        return { clearedNarration };
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

      regenerateImageForNode: async (nodeId: string) => {
        const { session } = get();
        if (!session) return;

        const node = session.storyMap.nodes[nodeId];
        if (!node) return;
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

        try {
          let modelOverrides: StoryModelOverrides | undefined;
          try {
            modelOverrides = await getStoryModelOverrides();
          } catch {
            // Falls back to default prompt and model config inside generateImage.
          }

          const parentNode = node.parentId ? session.storyMap.nodes[node.parentId] : undefined;
          const promptOnly = isPromptOnlyStoryConfig(session.storyConfig);
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
          }

          let portraitReferences = session.enableReferenceImages
            ? collectBeatPortraitReferences(beatForRender)
            : [];

          if (!promptOnly && session.enableReferenceImages && portraitReferences.length === 0 && storyboardPlan.portraitTasks.length > 0) {
            portraitReferences = await generatePortraitsForStoryboardPlan(
              beatForRender,
              storyboardPlan,
              session.visualStyle,
              session.storyConfig.portraitReferences,
              modelOverrides,
              costPhase(baseCostTelemetry, 'portrait_generation')
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
            parentNode?.data.imageUrl,
            portraitReferences
          );
          const storyboardPrompt = beatForRender.storyboardPromptText || renderStoryboardPlan(storyboardPlan);
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
                getReelVisualStylePromptOptions(modelOverrides, session.storyConfig)
              );
          beatForRender.finalImagePromptText = imageResult.finalPromptText;

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

          if (saveUserId && updatedSession.savedStoryId && runtimeSettings.storyIncrementalAssetSyncEnabled && imageResult.imageUrl) {
            await putPendingBeatImage({
              storyId: updatedSession.savedStoryId,
              userId: saveUserId,
              nodeId,
              imageDataUrl: imageResult.imageUrl,
            });
            void retryPendingBeatAssetSyncInternal(updatedSession.savedStoryId);
          }

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
          set({ isRegeneratingImage: false });
        }
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

        try {
          const session = await loadStoryAction(storyId);
          const hydratedMap = session.savedStoryId
            ? await overlayPendingBeatImages(session.storyMap, session.savedStoryId)
            : session.storyMap;
          const fullSession = deriveSessionFields(session, hydratedMap);

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
          }
        } catch (error: any) {
          set({ isLoading: false, loadingClues: [], loadingStage: null, loadingReader: null, error: error.message || 'Failed to load story' });
        }
      },

      exploreStoryTree: async (storyId: string) => {
        set({ isLoading: true, error: null, loadingClues: [], loadingStage: null, loadingReader: null, lastPublishResult: null });

        try {
          const session = await loadStoryTreeAction(storyId);
          const hydratedMap = session.savedStoryId
            ? await overlayPendingBeatImages(session.storyMap, session.savedStoryId)
            : session.storyMap;
          const fullSession = deriveSessionFields(session, hydratedMap);

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
        } catch (error: any) {
          set({ isLoading: false, loadingClues: [], loadingStage: null, loadingReader: null, error: error.message || 'Failed to load story for exploration' });
        }
      },

      refreshSignedUrls: async () => {
        const session = get().session;
        if (!session?.savedStoryId) return;
        try {
          const refreshedMap = await refreshStoryMapAction(session.savedStoryId);
          const current = get().session;
          if (!current || current.savedStoryId !== session.savedStoryId) return;
          const hydratedMap = await overlayPendingBeatImages(refreshedMap, session.savedStoryId);
          updateStoreSaveUi({
            session: deriveSessionFields(current, hydratedMap),
          });
          void retryPendingBeatAssetSyncInternal(session.savedStoryId);
        } catch {
          // Silent fail — URLs will still work until full expiry
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
        if (!isPromptOnlyStoryConfig(session.storyConfig)) return;

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
        if (!isPromptOnlyStoryConfig(session.storyConfig)) return;

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
        if (!isPromptOnlyStoryConfig(session.storyConfig)) return;

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
        if (!isPromptOnlyStoryConfig(session.storyConfig)) return;

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
    });
    }
);
