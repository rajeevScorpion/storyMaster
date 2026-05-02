import { create } from 'zustand';
import { StorySession, StoryBeat, StoryConfig, StoryMap, Character, StoryboardPlan, PortraitReferenceConfig, PortraitTask, SeedBeatOutline, Option, type StoryAspectRatio } from '../types/story';
import { v4 as uuidv4 } from 'uuid';
import {
  buildFinalPortraitPrompt,
  buildFinalStoryboardImagePrompt,
  composeStoryboardPlan,
  generateStoryBeat,
  generateImage,
  generateCharacterPortrait,
  materializeSeededBeat,
  renderStoryboardPlan,
  type StoryModelOverrides,
  type ReferenceImage,
} from '@/app/actions/story-runtime';
import { ensureNarratorVoiceLocked, generateAndPersistNarration, generateNarrationOnly, resolveNarrationVoiceServer } from '@/app/actions/narration';
import { linkCostEventsToBeat } from '@/app/actions/cost-tracking';
import {
  authorizeCurrentUserBillableAction,
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from '@/app/actions/pricing-enforcement';
import { DEFAULT_STORY_CONFIG, deriveVisualStyleSummary, getSeedPlan, normalizeStoryConfig } from '@/lib/ai/story-config';
import { getStoryboardSettings, getStoryAssetSignedUrlSwapEnabled, getStoryModelOverrides } from '@/app/actions/admin';
import { saveStory as saveStoryAction, loadStory as loadStoryAction, saveBeat as saveBeatAction, autoPublishStoryline, copyCoverToPublicBucket, setStoryCoverImage, updateBeatMediaState } from '@/app/actions/persistence';
import { setCharacterReferenceSheetRecord, clearCharacterReferenceSheetRecord } from '@/app/actions/character-assets';
import { loadStoryTree as loadStoryTreeAction, trackExploration as trackExplorationAction, refreshStoryMapSignedUrls as refreshStoryMapAction } from '@/app/actions/exploration';
import { uploadNodeAssets, replaceBase64WithUrls, stripBase64FromStoryMap, uploadCoverImage, extractStoragePath, signNodeAssetUrls, uploadAsset, deleteAsset, type NodeAssetUrlMap } from '@/lib/supabase/storage';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import type { PricingBillableActionAuthorization } from '@/lib/types/pricing';
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
  continueStory: (optionId: string) => Promise<void>;
  navigateToNode: (nodeId: string) => void;
  resetStory: () => void;
  restartExploration: () => void;
  setLoadingClues: (clues: string[]) => void;
  generateNarrationForNode: (nodeId: string) => Promise<void>;
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
  setPromptOnlyBeatImage: (nodeId: string, imageDataUrl: string, options?: { maxImagesPerBeat?: number }) => Promise<void>;
  selectPromptOnlyBeatImage: (nodeId: string, storageKey: string) => Promise<void>;
  deletePromptOnlyBeatImage: (nodeId: string) => Promise<void>;
  permanentlyDeletePromptOnlyBeatImage: (nodeId: string, storageKey: string) => Promise<void>;
  setCharacterReferenceSheet: (characterId: string, imageDataUrl: string) => Promise<void>;
  deleteCharacterReferenceSheet: (characterId: string) => Promise<void>;
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
    if (!registry.has(character.id)) {
      registry.set(character.id, character);
    }
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

function applyCharacterPatchEverywhere(
  session: StorySession,
  characterId: string,
  patcher: (character: Character) => Character
): StorySession {
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
      return patcher(character);
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
  const nextSaveStatus = partial.saveStatus ?? (
    nextSession
      ? (nextIsSaving || Boolean(activeBeatAssetSyncPromise) ? 'saving' : 'saved')
      : 'idle'
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
          `${userId}/${storyId}/${nodeId}/portrait_${character.id}.webp`,
          portraitBase64
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
  return isPromptOnlyStoryConfig(storyConfig)
    ? 'start_story_initial_beat_prompt_only' as const
    : 'start_story_initial_beat' as const;
}

function getContinueStoryActionKey(storyConfig: StoryConfig) {
  return isPromptOnlyStoryConfig(storyConfig)
    ? 'continue_story_new_beat_prompt_only' as const
    : 'continue_story_new_beat' as const;
}

function canPublishStoryPathAsStandard(
  storyMap: StoryMap,
  endingNodeId: string
): boolean {
  return getPathToNode(storyMap, endingNodeId).every((node) => Boolean(node.data.imageUrl));
}

const LOADING_READER_MESSAGE = 'kissago is weaving the story';

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
              `${userId}/${storyId}/${record.nodeId}/image.webp`,
              record.imageDataUrl
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
          beat = mergeCharacterVisualReferences(beat, initialSession.characters || []);

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
          const storyboardPrompt = beat.storyboardPromptText;

          // Create storyMap once the canonical visual plan is ready so beat 1 persists
          // portraits, storyboard metadata, and later image continuity anchors together.
          const storyMap = createStoryMap(beat, rootNodeId);

          // Track resolved audio URL for merging after image resolves
          let resolvedAudioUrl: string | undefined;
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
          if (storyPrompt.toLowerCase() !== 'mock') {
            Promise.all([lockedVoicePromise, earlySavePromise]).then(([voiceResolution, storyId]) => {
              set({ isGeneratingAudio: true });
              const narrationStartedAt = nowMs();

              const narrationFn = storyId
                ? generateAndPersistNarration(
                  beat.storyText, initialSession.tone!, initialSession.genre!,
                  voiceResolution.voiceId, voiceResolution.languageCode, storyId, rootNodeId,
                  costPhase({ ...baseCostTelemetry, storyId }, 'tts')
                ).then(({ audioUrl }) => audioUrl)
                : generateNarrationOnly(
                  beat.storyText, initialSession.tone!, initialSession.genre!,
                  voiceResolution.voiceId, voiceResolution.languageCode,
                  costPhase(baseCostTelemetry, 'tts')
                );

              narrationFn.then((audioUrl) => {
                console.info('[timing:start_story.narration]', {
                  durationMs: Math.round(nowMs() - narrationStartedAt),
                  mode: storyId ? 'persisted' : 'base64_fallback',
                  success: true,
                });
                resolvedAudioUrl = audioUrl;
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
                    { aspectRatio: storyAspectRatio }
                  ),
                })
              : measureAsyncStep(
                  timingSteps,
                  'image_generation',
                  'Render opening storyboard image',
                  () => generateImage(
                    storyboardPrompt,
                    beat.characters,
                    initialSession.visualStyle!,
                    modelOverrides,
                    portraitRefs.length > 0 ? portraitRefs : undefined,
                    beat.beatNumber,
                    costPhase(baseCostTelemetry, 'image_generation', {
                      referenceCount: portraitRefs.length,
                    }),
                    storyAspectRatio
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
          const choiceHistoryForPrompt = [
            ...getChoiceHistoryToNode(session.storyMap, session.storyMap.currentNodeId),
            selectedOption.label,
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
                  selectedOption.label,
                  modelOverrides,
                  costPhase(baseCostTelemetry, 'story_generation')
                )
              );
            },
            {
              selectedOptionId: optionId,
              selectedOptionLabel: selectedOption.label,
              isCanonicalSeedPath: Boolean(nextCanonicalSeedBeat),
            }
          );
          beat = mergeCharacterVisualReferences(beat, sessionForPrompt.characters || []);

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
          const storyboardPrompt = beat.storyboardPromptText;

          // Track resolved audio URL — if narration finishes before image,
          // the .then() can't update the store (node doesn't exist yet),
          // so we capture the URL and apply it during the merge.
          let resolvedAudioUrl: string | undefined;

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

            const handleNarrationResolved = (audioUrl: string) => {
              console.info('[timing:continue_story.narration]', {
                durationMs: Math.round(nowMs() - narrationStartedAt),
                mode: session.savedStoryId ? 'persisted' : 'base64_fallback',
                success: true,
                nodeId: newNodeId,
              });
              resolvedAudioUrl = audioUrl;
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

            if (session.savedStoryId) {
              // Server-side: generate + upload to Supabase in one round trip
              narrationPromise = generateAndPersistNarration(
                beat.storyText, session.tone, session.genre,
                voiceForBeat, narrationLanguageCode,
                session.savedStoryId, newNodeId,
                costPhase(baseCostTelemetry, 'tts')
              ).then(({ audioUrl }) => handleNarrationResolved(audioUrl))
                .catch(handleNarrationError);
            } else {
              // Fallback: generate only (no persistence yet)
              narrationPromise = generateNarrationOnly(
                beat.storyText, session.tone, session.genre,
                voiceForBeat, narrationLanguageCode,
                costPhase(baseCostTelemetry, 'tts')
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
                  { aspectRatio: storyAspectRatio }
                ),
              }
            : await measureAsyncStep(
                timingSteps,
                'image_generation',
                'Render branch storyboard image',
                () => generateImage(
                  storyboardPrompt,
                  beat.characters,
                  session.visualStyle,
                  modelOverrides,
                  referenceImages.length > 0 ? referenceImages : undefined,
                  beat.beatNumber,
                  costPhase(baseCostTelemetry, 'image_generation', {
                    referenceCount: referenceImages.length,
                  }),
                  storyAspectRatio
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

            // Auto-publish if this is an ending beat
            if (beat.isEnding && canPublishStoryPathAsStandard(mergedMap, mergedMap.currentNodeId)) {
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
                    return uploadCoverImage(user.id, session.savedStoryId!, imageData);
                  }
                  if (extractStoragePath(imageData, 'story-assets')) {
                    // Private-bucket URL — copy to public bucket via server action
                    return copyCoverToPublicBucket(session.savedStoryId!, imageData);
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
                      await setStoryCoverImage(session.savedStoryId!, treeCoverUrl);
                    }
                  } else if (coverImageUrl) {
                    // Single-beat story: use same cover for tree
                    await setStoryCoverImage(session.savedStoryId!, coverImageUrl);
                  }
                } catch (err) {
                  console.error('Tree cover upload failed:', err);
                }

                return autoPublishStoryline(
                  session.savedStoryId!,
                  updatedMap.currentNodeId,
                  session.title,
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

          if (session.savedStoryId) {
            // Server-side: generate + upload to Supabase in one round trip
            const result = await generateAndPersistNarration(
              node.data.storyText, session.tone, session.genre,
              voiceName, narrationLanguageCode, session.savedStoryId, nodeId,
              costPhase(baseCostTelemetry, 'tts')
            );
            audioUrl = result.audioUrl;
          } else {
            // No cloud save yet — generate only, returns base64
            audioUrl = await generateNarrationOnly(
              node.data.storyText, session.tone, session.genre,
              voiceName, narrationLanguageCode,
              costPhase(baseCostTelemetry, 'tts')
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
          const storyboardPrompt = beatForRender.storyboardPromptText;
          const imageResult = promptOnly
            ? {
                imageUrl: '',
                finalPromptText: buildFinalStoryboardImagePrompt(
                  storyboardPrompt,
                  beatForRender.characters,
                  session.visualStyle,
                  beatForRender.beatNumber,
                  modelOverrides,
                  { aspectRatio: storyAspectRatio }
                ),
              }
            : await generateImage(
                storyboardPrompt,
                beatForRender.characters,
                session.visualStyle,
                modelOverrides,
                referenceImages.length > 0 ? referenceImages : undefined,
                beatForRender.beatNumber,
                costPhase(baseCostTelemetry, 'image_generation', {
                  referenceCount: referenceImages.length,
                }),
                storyAspectRatio
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

      setPromptOnlyBeatImage: async (nodeId: string, imageDataUrl: string, options?: { maxImagesPerBeat?: number }) => {
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

        const storageKeySuffix = `image-${crypto.randomUUID()}.webp`;
        const uploadedAt = new Date().toISOString();

        if (session.savedStoryId) {
          const userId = await resolveCurrentUserId(session.savedByUserId);
          if (userId) {
            const storageKey = `${userId}/${session.savedStoryId}/${nodeId}/${storageKeySuffix}`;

            // Optimistic local render — surface the chosen image instantly while the
            // cloud upload runs in the background.
            const optimisticGallery = [
              ...(previousBeat.imageGallery ?? []),
              { url: imageDataUrl, storageKey, uploadedAt },
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
              const uploadedUrl = await uploadAsset('story-assets', storageKey, imageDataUrl);
              const persistedGallery = optimisticGallery.map((entry) =>
                entry.storageKey === storageKey ? { ...entry, url: uploadedUrl } : entry
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
              { url: imageDataUrl, storageKey: provisionalKey, uploadedAt },
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

      setCharacterReferenceSheet: async (characterId: string, imageDataUrl: string) => {
        const { session } = get();
        if (!session) return;

        const findCharacter = (s: StorySession): Character | undefined => {
          const fromRoster = s.characters?.find((c) => c.id === characterId);
          if (fromRoster) return fromRoster;
          for (const node of Object.values(s.storyMap.nodes)) {
            const fromBeat = node.data.characters?.find((c) => c.id === characterId);
            if (fromBeat) return fromBeat;
          }
          return undefined;
        };

        const character = findCharacter(session);
        if (!character) {
          throw new Error('Could not locate character to attach reference sheet.');
        }

        const previousSnapshot = applyCharacterPatchEverywhere(session, characterId, (existing) => ({ ...existing }));

        const uploadedAt = new Date().toISOString();
        const slug = slugifyCharacterName(character.name);
        const storageKeySuffix = `character-sheets/${slug}_${characterId}.webp`;

        if (session.savedStoryId) {
          const userId = await resolveCurrentUserId(session.savedByUserId);
          if (userId) {
            const storageKey = `${userId}/${session.savedStoryId}/${storageKeySuffix}`;

            updateStoreSaveUi({
              session: applyCharacterPatchEverywhere(session, characterId, (existing) => ({
                ...existing,
                referenceSheetUrl: imageDataUrl,
                referenceSheetStorageKey: storageKey,
                referenceSheetUploadedAt: uploadedAt,
              })),
              saveStatus: 'saving',
            });

            try {
              const uploadedUrl = await uploadAsset('story-assets', storageKey, imageDataUrl);
              await setCharacterReferenceSheetRecord(session.savedStoryId, characterId, {
                url: uploadedUrl,
                storageKey,
                uploadedAt,
              });

              const latestSession = get().session;
              if (!latestSession) return;
              // Swap the optimistic data URL for the persisted storage URL — keeping
              // the base64 around would balloon every subsequent server-action save
              // past the 10 MB body cap. The bucket is private, so the URL won't
              // render until signStoryMapAssetUrls re-signs it on the next load,
              // but the character-sheet UI is text-only ("Replace Sheet"), so no
              // visible regression in the current session.
              updateStoreSaveUi({
                session: applyCharacterPatchEverywhere(latestSession, characterId, (existing) => ({
                  ...existing,
                  referenceSheetUrl: uploadedUrl,
                  referenceSheetStorageKey: storageKey,
                  referenceSheetUploadedAt: uploadedAt,
                })),
                saveStatus: 'saved',
              });
              return;
            } catch (error) {
              const latestSession = get().session;
              if (latestSession) {
                updateStoreSaveUi({
                  session: previousSnapshot,
                });
              }
              throw error;
            }
          }
        }

        // Unsaved local-only fallback — keep the data URL, leave storage key empty so
        // a later cloud save knows this still needs uploading.
        updateStoreSaveUi({
          session: applyCharacterPatchEverywhere(session, characterId, (existing) => ({
            ...existing,
            referenceSheetUrl: imageDataUrl,
            referenceSheetStorageKey: undefined,
            referenceSheetUploadedAt: uploadedAt,
          })),
          saveStatus: 'unsaved',
        });
      },

      deleteCharacterReferenceSheet: async (characterId: string) => {
        const { session } = get();
        if (!session) return;

        let storageKey: string | undefined;
        for (const character of session.characters ?? []) {
          if (character.id === characterId) {
            storageKey = character.referenceSheetStorageKey;
            break;
          }
        }
        if (!storageKey) {
          for (const node of Object.values(session.storyMap.nodes)) {
            const match = node.data.characters?.find((c) => c.id === characterId);
            if (match?.referenceSheetStorageKey) {
              storageKey = match.referenceSheetStorageKey;
              break;
            }
          }
        }

        const previousSnapshot = applyCharacterPatchEverywhere(session, characterId, (existing) => ({ ...existing }));

        updateStoreSaveUi({
          session: applyCharacterPatchEverywhere(session, characterId, (existing) => {
            const next = { ...existing };
            delete next.referenceSheetUrl;
            delete next.referenceSheetStorageKey;
            delete next.referenceSheetUploadedAt;
            return next;
          }),
          saveStatus: session.savedStoryId ? 'saving' : 'unsaved',
        });

        try {
          if (storageKey) {
            await deleteAsset('story-assets', storageKey);
          }
          if (session.savedStoryId) {
            await clearCharacterReferenceSheetRecord(session.savedStoryId, characterId);
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
