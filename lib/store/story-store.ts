import { create } from 'zustand';
import { StorySession, StoryBeat, StoryConfig, StoryMap, Character, StoryboardPlan, PortraitReferenceConfig, PortraitTask, SeedBeatOutline } from '../types/story';
import { v4 as uuidv4 } from 'uuid';
import { composeStoryboardPlan, generateStoryBeat, generateImage, generateCharacterPortrait, materializeSeededBeat, renderStoryboardPlan, type StoryModelOverrides, type ReferenceImage } from '@/app/actions/story-runtime';
import { ensureNarratorVoiceLocked, generateAndPersistNarration, generateNarrationOnly, getNarratorVoiceForStory, selectNarratorVoiceServer } from '@/app/actions/narration';
import {
  authorizeCurrentUserBillableAction,
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from '@/app/actions/pricing-enforcement';
import { DEFAULT_VOICE } from '@/lib/ai/narration-config';
import { DEFAULT_STORY_CONFIG, deriveVisualStyleSummary, getSeedPlan, normalizeStoryConfig } from '@/lib/ai/story-config';
import { getStoryModelOverrides } from '@/app/actions/admin';
import { saveStory as saveStoryAction, loadStory as loadStoryAction, saveBeat as saveBeatAction, autoPublishStoryline, copyCoverToPublicBucket, setStoryCoverImage } from '@/app/actions/persistence';
import { loadStoryTree as loadStoryTreeAction, trackExploration as trackExplorationAction, refreshStoryMapSignedUrls as refreshStoryMapAction } from '@/app/actions/exploration';
import { uploadNodeAssets, replaceBase64WithUrls, stripBase64FromStoryMap, uploadCoverImage, extractStoragePath } from '@/lib/supabase/storage';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import type { PricingBillableActionAuthorization } from '@/lib/types/pricing';
import {
  createStoryLoadingStage,
  type StoryLoadingFlow,
  type StoryLoadingStage,
} from '@/lib/story/loading-progress';
import { dispatchPricingRuntimeRefresh } from '@/lib/pricing/runtime-events';
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

interface StoryState {
  session: StorySession | null;
  isLoading: boolean;
  loadingClues: string[];
  loadingStage: StoryLoadingStage | null;
  error: string | null;
  errorAction: StoryErrorAction | null;
  isGeneratingAudio: boolean;
  isRegeneratingImage: boolean;
  audioReadyNodeId: string | null;
  storyMode: boolean;
  isSaving: boolean;
  saveStatus: 'idle' | 'unsaved' | 'saving' | 'saved';
  saveWarning: string | null;
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
  saveStoryToCloud: (userId: string) => Promise<void>;
  loadStoryFromCloud: (storyId: string) => Promise<void>;
  exploreStoryTree: (storyId: string) => Promise<void>;
  refreshSignedUrls: () => Promise<void>;
  clearPublishResult: () => void;
  clearError: () => void;
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
  const stripped = { ...session } as Partial<StorySession> & { storyMap?: StoryMap; narratorVoice?: string };
  delete stripped.storyMap;
  delete stripped.narratorVoice;
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

function collectBeatPortraitReferences(beat: StoryBeat): ReferenceImage[] {
  if (beat.beatNumber === 1) {
    return collectPortraitReferences(beat.characters);
  }

  const relevantIds = new Set<string>([
    ...(beat.newCharacterIds || []),
    ...(beat.changedCharacterIds || []),
    ...((beat.storyboardPlan?.portraitTasks || []).map((task) => task.characterId)),
  ]);

  if (relevantIds.size === 0) {
    return [];
  }

  return collectPortraitReferences(
    beat.characters.filter((character) => relevantIds.has(character.id))
  );
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
  const sceneReference = buildReferenceFromValue('scene', previousStoryboardUrl);
  if (sceneReference) {
    references.push(sceneReference);
  }

  references.push(...portraitReferences);
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

function setLoadingStage(
  setState: (partial: Partial<StoryState>) => void,
  flow: StoryLoadingFlow,
  step: StoryLoadingStage['currentStepKey']
) {
  setState({
    loadingStage: createStoryLoadingStage(flow, step),
  });
}

async function resolveNarratorVoice(session: StorySession): Promise<string> {
  if (session.narratorVoice) {
    return session.narratorVoice;
  }

  if (!session.savedStoryId) {
    return DEFAULT_VOICE;
  }

  try {
    return (await getNarratorVoiceForStory(session.savedStoryId)) || DEFAULT_VOICE;
  } catch (error) {
    console.error('Failed to resolve locked narrator voice:', error);
    return DEFAULT_VOICE;
  }
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
  modelOverrides?: StoryModelOverrides
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
        const portrait = await generateCharacterPortrait(
          character,
          visualStyle,
          taskPortraitReferenceConfig,
          modelOverrides,
          task.prompt
        );
        character.portraitBase64 = portrait;
        return { type: 'character' as const, dataUrl: portrait };
      } catch (error) {
        console.error(`Portrait generation failed for storyboard task ${task.characterId}:`, error);
        return null;
      }
    })
  );

  return portraits.filter((portrait): portrait is NonNullable<typeof portrait> => Boolean(portrait));
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

export const useStoryStore = create<StoryState>()(
    (set, get) => ({
      session: null,
      isLoading: false,
      loadingClues: [],
      loadingStage: null,
      error: null,
      errorAction: null,
      isGeneratingAudio: false,
      isRegeneratingImage: false,
      audioReadyNodeId: null,
      storyMode: false,
      isSaving: false,
      saveStatus: 'idle' as const,
      saveWarning: null,
      lastPublishResult: null,

      startStory: async (prompt: string, config?: StoryConfig) => {
        const storyConfig = normalizeStoryConfig(config || DEFAULT_STORY_CONFIG);
        const seededStory = isSeededStoryConfig(storyConfig);
        const storyPrompt = seededStory
          ? storyConfig.authoring.sourceText?.trim() || prompt
          : prompt;
        const openingSeedBeat = seededStory ? getSeedBeatByIndex(storyConfig, 1) : undefined;
        const visualStyle = deriveVisualStyleSummary(storyConfig.visualSettings);
        const initialSessionId = uuidv4();
        const generationStartedAt = nowMs();
        const timingSteps: GenerationTimingStep[] = [];
        let billingAuthorization: PricingBillableActionAuthorization;
        set({
          isLoading: true,
          error: null,
          errorAction: null,
          loadingClues: ['Kissago is weaving the next moment...'],
          loadingStage: createStoryLoadingStage('start_story', 'wallet'),
        });
        try {
          billingAuthorization = await measureAsyncStep(
            timingSteps,
            'wallet_authorization',
            'Authorize story start',
            () => authorizeCurrentUserBillableAction({
              actionKey: 'start_story_initial_beat',
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
          };

          setLoadingStage(set, 'start_story', 'beat');
          const beat = await measureAsyncStep(
            timingSteps,
            seededStory ? 'seeded_beat_materialization' : 'story_generation',
            seededStory ? 'Materialize seeded opening beat' : 'Generate opening beat',
            async () => {
              if (seededStory) {
                if (!openingSeedBeat) {
                  throw new Error('Seeded story is missing its opening beat plan.');
                }

                return materializeSeededBeat(openingSeedBeat, initialSession, modelOverrides);
              }

              return withGeneratedOrigin(
                await generateStoryBeat(storyPrompt, initialSession, undefined, modelOverrides)
              );
            }
          );

          set({ loadingClues: beat.clues });

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
              modelOverrides
            )
          );
          beat.storyboardPlan = storyboardPlan;
          beat.isStoryboard = true;

          const portraitRefs = initialSession.enableReferenceImages
            ? await measureAsyncStep(
                timingSteps,
                'portrait_generation',
                'Generate reference portraits',
                () => generatePortraitsForStoryboardPlan(
                  beat,
                  storyboardPlan,
                  initialSession.visualStyle!,
                  storyConfig.portraitReferences,
                  modelOverrides
                ),
                {
                  portraitTaskCount: storyboardPlan.portraitTasks.length,
                  portraitReferenceMode: storyConfig.portraitReferences.mode,
                  portraitReferenceQuality: storyConfig.portraitReferences.quality,
                }
              )
            : [];
          const storyboardPrompt = renderStoryboardPlan(storyboardPlan);

          // Create storyMap once the canonical visual plan is ready so beat 1 persists
          // portraits, storyboard metadata, and later image continuity anchors together.
          const storyMap = createStoryMap(beat);
          const rootNodeId = storyMap.rootNodeId;

          // Track resolved audio URL for merging after image resolves
          let resolvedAudioUrl: string | undefined;
          let earlySavedStoryId: string | undefined;
          const resolvedTitle = storyConfig.authoring.workingTitle?.trim() || beat.title;

          // Start voice selection (fast ~1s)
          const voicePromise = measureAsyncStep(
            timingSteps,
            'voice_selection',
            'Select narrator voice',
            () => selectNarratorVoiceServer(
              initialSession.genre!,
              initialSession.tone!,
              initialSession.targetAge!,
              lang
            ),
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
              async ([voice, storyId]) => {
                if (!storyId) {
                  return voice;
                }

                try {
                  return await ensureNarratorVoiceLocked(storyId, voice);
                } catch (error) {
                  console.error('Failed to persist locked narrator voice:', error);
                  return voice;
                }
              }
            ),
            { background: true }
          );

          // Fire-and-forget: once voice + storyId resolve, start narration in parallel with image
          if (initialSession.userPrompt !== 'mock') {
            Promise.all([lockedVoicePromise, earlySavePromise]).then(([voice, storyId]) => {
              set({ isGeneratingAudio: true });
              const narrationStartedAt = nowMs();

              const narrationFn = storyId
                ? generateAndPersistNarration(
                    beat.storyText, initialSession.tone!, initialSession.genre!,
                    voice, lang, storyId, rootNodeId
                  ).then(({ audioUrl }) => audioUrl)
                : generateNarrationOnly(
                    beat.storyText, initialSession.tone!, initialSession.genre!,
                    voice, lang
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
                    data: { ...rootNode.data, audioUrl },
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
                set({ isGeneratingAudio: false });
              });
            }).catch((err) => {
              console.error('Narration pipeline failed:', err);
              set({ isGeneratingAudio: false });
            });
          }

          // Step A: Generate portraits first (parallelized) so beat 1 scene can use
          // them as references — makes portrait the single source of truth from the very first image.
          // Beat 1 portraits are already resolved before storyboard rendering so Gemini can
          // use them as direct visual references during the first 2x2 board generation.
          setLoadingStage(set, 'start_story', 'image');
          const [imageUrl, narratorVoice] = await Promise.all([
            measureAsyncStep(
              timingSteps,
              'image_generation',
              'Render opening storyboard image',
              () => generateImage(
                storyboardPrompt,
                beat.characters,
                initialSession.visualStyle!,
                modelOverrides,
                portraitRefs.length > 0 ? portraitRefs : undefined,
                beat.beatNumber
              ),
              {
                referenceCount: portraitRefs.length,
                beatNumber: beat.beatNumber,
              }
            ),
            lockedVoicePromise,
          ]);

          beat.imageUrl = imageUrl;

          // Also await early save (should be done by now — DB insert is fast)
          await earlySavePromise;

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
                  action: 'start_story_initial_beat',
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
              ...beat,
              imageUrl,
              ...(resolvedAudioUrl ? { audioUrl: resolvedAudioUrl } : {}),
            },
          };

          const fullSession = deriveSessionFields(
            {
              ...initialSession,
              title: resolvedTitle,
              narratorVoice,
              ...(earlySavedStoryId ? { savedStoryId: earlySavedStoryId } : {}),
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
            loadingStage: null,
            error: null,
            errorAction: null,
            ...audioExtra,
          });
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
            loadingStage: null,
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
        const generationStartedAt = nowMs();
        const timingSteps: GenerationTimingStep[] = [];

        // Check if branch already exists — instant load, no API call
        const existingChildId = findChildForOption(session.storyMap, session.storyMap.currentNodeId, optionId);
        if (existingChildId) {
          const updatedMap = { ...session.storyMap, currentNodeId: existingChildId };
          set({ session: deriveSessionFields(session, updatedMap) });
          return;
        }

        let billingAuthorization: PricingBillableActionAuthorization;
        try {
          billingAuthorization = await measureAsyncStep(
            timingSteps,
            'wallet_authorization',
            'Authorize branch continuation',
            () => authorizeCurrentUserBillableAction({
              actionKey: 'continue_story_new_beat',
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
            error: pricingErrorState.error,
            errorAction: pricingErrorState.errorAction,
          });
          return;
        }

        // No existing branch — generate new beat
        set({
          isLoading: true,
          error: null,
          errorAction: null,
          loadingClues: currentNode.data.clues.length > 0
            ? currentNode.data.clues
            : ['Kissago is weaving the next moment...'],
          loadingStage: createStoryLoadingStage('continue_story', 'wallet'),
        });

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
          const beat = await measureAsyncStep(
            timingSteps,
            nextCanonicalSeedBeat ? 'seeded_beat_materialization' : 'story_generation',
            nextCanonicalSeedBeat ? 'Materialize seeded canonical beat' : 'Generate continued beat',
            async () => {
              if (nextCanonicalSeedBeat) {
                return materializeSeededBeat(nextCanonicalSeedBeat, sessionForPrompt, modelOverrides);
              }

              return withGeneratedOrigin(
                await generateStoryBeat(session.userPrompt, sessionForPrompt, selectedOption.label, modelOverrides)
              );
            },
            {
              selectedOptionId: optionId,
              selectedOptionLabel: selectedOption.label,
              isCanonicalSeedPath: Boolean(nextCanonicalSeedBeat),
            }
          );

          set({ loadingClues: beat.clues });

          setLoadingStage(set, 'continue_story', 'visual');
          const storyboardPlan = await measureAsyncStep(
            timingSteps,
            'storyboard_plan',
            'Compose storyboard plan',
            () => composeStoryboardPlan(
              beat,
              sessionForPrompt,
              session.visualStyle,
              modelOverrides
            )
          );
          beat.storyboardPlan = storyboardPlan;
          beat.isStoryboard = true;
          const portraitRefs = session.enableReferenceImages
            ? await measureAsyncStep(
                timingSteps,
                'portrait_generation',
                'Generate reference portraits',
                () => generatePortraitsForStoryboardPlan(
                  beat,
                  storyboardPlan,
                  session.visualStyle,
                  session.storyConfig.portraitReferences,
                  modelOverrides
                ),
                {
                  portraitTaskCount: storyboardPlan.portraitTasks.length,
                  portraitReferenceMode: session.storyConfig.portraitReferences.mode,
                  portraitReferenceQuality: session.storyConfig.portraitReferences.quality,
                }
              )
            : [];
          const storyboardPrompt = renderStoryboardPlan(storyboardPlan);

          const lang = session.storyConfig?.language || 'english';
          const newNodeId = crypto.randomUUID();
          const parentId = session.storyMap.currentNodeId;

          // Track resolved audio URL — if narration finishes before image,
          // the .then() can't update the store (node doesn't exist yet),
          // so we capture the URL and apply it during the merge.
          let resolvedAudioUrl: string | undefined;

          // Fire-and-forget: start narration in parallel with image generation
          // Voice is locked at story start — use it directly or fall back to default constant
          const voiceForBeat = await measureAsyncStep(
            timingSteps,
            'voice_resolution',
            'Resolve locked narrator voice',
            () => resolveNarratorVoice(session)
          );
          if (!session.narratorVoice && voiceForBeat !== DEFAULT_VOICE) {
            set((state) => state.session ? {
              session: {
                ...state.session,
                narratorVoice: voiceForBeat,
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
                  data: { ...node.data, audioUrl },
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
              set({ isGeneratingAudio: false });
            };

            if (session.savedStoryId) {
              // Server-side: generate + upload to Supabase in one round trip
              narrationPromise = generateAndPersistNarration(
                beat.storyText, session.tone, session.genre,
                voiceForBeat, lang,
                session.savedStoryId, newNodeId
              ).then(({ audioUrl }) => handleNarrationResolved(audioUrl))
                .catch(handleNarrationError);
            } else {
              // Fallback: generate only (no persistence yet)
              narrationPromise = generateNarrationOnly(
                beat.storyText, session.tone, session.genre,
                voiceForBeat, lang
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
          const imageUrl = await measureAsyncStep(
            timingSteps,
            'image_generation',
            'Render branch storyboard image',
            () => generateImage(
              storyboardPrompt,
              beat.characters,
              session.visualStyle,
              modelOverrides,
              referenceImages.length > 0 ? referenceImages : undefined,
              beat.beatNumber
            ),
            {
              beatNumber: beat.beatNumber,
              referenceCount: referenceImages.length,
            }
          );
          beat.imageUrl = imageUrl;

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
                data: {
                  ...updatedMap.nodes[newNodeId].data,
                  ...(resolvedAudioUrl ? { audioUrl: resolvedAudioUrl } : {}),
                },
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
                  action: 'continue_story_new_beat',
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
            session: deriveSessionFields(latestSession, mergedMap),
            isLoading: false,
            saveStatus: 'unsaved',
            loadingStage: null,
            error: null,
            errorAction: null,
            ...audioExtra,
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
            saveBeatAction(session.savedStoryId, mergedMap.currentNodeId, cleanNode).catch(
              (err) => console.error('Incremental beat save failed:', err)
            );

            // Auto-publish if this is an ending beat
            if (beat.isEnding) {
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
            loadingStage: null,
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
        set({ session: null, error: null, errorAction: null, isLoading: false, loadingClues: [], loadingStage: null });
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

        // Skip for mock stories
        if (session.userPrompt.toLowerCase() === 'mock') return;

        set({ isGeneratingAudio: true });

        try {
          const lang = session.storyConfig?.language || 'english';

          // Use locked voice — selected once at story start, never re-queried
          const voiceName = await resolveNarratorVoice(session);
          if (!session.narratorVoice && voiceName !== DEFAULT_VOICE) {
            set((state) => state.session ? {
              session: {
                ...state.session,
                narratorVoice: voiceName,
              },
            } : state);
          }

          let audioUrl: string;

          if (session.savedStoryId) {
            // Server-side: generate + upload to Supabase in one round trip
            const result = await generateAndPersistNarration(
              node.data.storyText, session.tone, session.genre,
              voiceName, lang, session.savedStoryId, nodeId
            );
            audioUrl = result.audioUrl;
          } else {
            // No cloud save yet — generate only, returns base64
            audioUrl = await generateNarrationOnly(
              node.data.storyText, session.tone, session.genre,
              voiceName, lang
            );
          }

          // Update the node with audio — re-read session in case it changed
          const latestSession = get().session;
          if (!latestSession) return;

          const updatedNodes = {
            ...latestSession.storyMap.nodes,
            [nodeId]: {
              ...latestSession.storyMap.nodes[nodeId],
              data: { ...latestSession.storyMap.nodes[nodeId].data, audioUrl },
            },
          };
          const updatedMap = { ...latestSession.storyMap, nodes: updatedNodes };
          set({
            session: deriveSessionFields(latestSession, updatedMap),
            isGeneratingAudio: false,
            audioReadyNodeId: nodeId,
          });
        } catch (error) {
          console.error('Narration generation failed:', error);
          set({ isGeneratingAudio: false });
        }
      },

      regenerateImageForNode: async (nodeId: string) => {
        const { session } = get();
        if (!session) return;

        const node = session.storyMap.nodes[nodeId];
        if (!node) return;

        set({ isRegeneratingImage: true });

        try {
          let modelOverrides: StoryModelOverrides | undefined;
          try {
            modelOverrides = await getStoryModelOverrides();
          } catch {
            // Falls back to default prompt and model config inside generateImage.
          }

          const parentNode = node.parentId ? session.storyMap.nodes[node.parentId] : undefined;
          const beatForRender: StoryBeat = {
            ...node.data,
            characters: node.data.characters.map((character) => ({ ...character })),
          };

          let storyboardPlan = beatForRender.storyboardPlan;
          if (!storyboardPlan) {
            const composerSession = stripSessionForPrompt(buildSessionContextToNode(session, node.parentId));
            storyboardPlan = await composeStoryboardPlan(
              beatForRender,
              composerSession,
              session.visualStyle,
              modelOverrides
            );
          }
          beatForRender.storyboardPlan = storyboardPlan;
          beatForRender.isStoryboard = true;

          let portraitReferences = session.enableReferenceImages
            ? collectBeatPortraitReferences(beatForRender)
            : [];

          if (session.enableReferenceImages && portraitReferences.length === 0 && storyboardPlan.portraitTasks.length > 0) {
            portraitReferences = await generatePortraitsForStoryboardPlan(
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
          const storyboardPrompt = renderStoryboardPlan(storyboardPlan);

          const imageUrl = await generateImage(
            storyboardPrompt,
            beatForRender.characters,
            session.visualStyle,
            modelOverrides,
            referenceImages.length > 0 ? referenceImages : undefined,
            beatForRender.beatNumber
          );

          // Update the node with the new image
          const latestSession = get().session;
          if (!latestSession) return;

          const updatedNodes = {
            ...latestSession.storyMap.nodes,
            [nodeId]: {
              ...latestSession.storyMap.nodes[nodeId],
              data: {
                ...latestSession.storyMap.nodes[nodeId].data,
                ...beatForRender,
                imageUrl,
                isStoryboard: true,
              },
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

          if (saveUserId && !updatedSession.sourceStoryOwnerId) {
            await get().saveStoryToCloud(saveUserId);
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

      saveStoryToCloud: async (userId: string) => {
        const { session } = get();
        if (!session) return;

        set({ isSaving: true, saveStatus: 'saving', error: null });

        try {
          // Persist story to DB first to get a stable storyId for asset paths.
          // On first save this inserts and returns a new ID; on subsequent saves it updates.
          const strippedForId = buildPersistableSessionSnapshot(
            session,
            stripBase64FromStoryMap(session.storyMap)
          );
          const { storyId, beatsWarning: w1 } = await saveStoryAction(strippedForId, strippedForId.storyMap);

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
          const updatedSession = deriveSessionFields(
            { ...(latestSession || session), savedStoryId: storyId, savedByUserId: userId },
            latestMap
          );
          set({ session: updatedSession, isSaving: false, saveStatus: 'saved', saveWarning: w1 ?? w2 ?? null });
        } catch (error: any) {
          set({ isSaving: false, saveStatus: 'unsaved', error: error.message || 'Failed to save story' });
        }
      },

      loadStoryFromCloud: async (storyId: string) => {
        set({ isLoading: true, error: null, loadingStage: null });

        try {
          const session = await loadStoryAction(storyId);
          const fullSession = deriveSessionFields(session, session.storyMap);

          if (process.env.NODE_ENV === 'development') {
            const nodeCount = Object.keys(fullSession.storyMap.nodes).length;
            const branchPoints = Object.values(fullSession.storyMap.nodes)
              .filter((n) => n.children.length > 1).length;
            console.log(`[loadStory] Loaded ${nodeCount} nodes, ${branchPoints} branch points`);
          }

          set({
            session: fullSession,
            isLoading: false,
            loadingStage: null,
            isSaving: false,
            saveStatus: 'saved',
            saveWarning: null,
          });
        } catch (error: any) {
          set({ isLoading: false, loadingStage: null, error: error.message || 'Failed to load story' });
        }
      },

      exploreStoryTree: async (storyId: string) => {
        set({ isLoading: true, error: null, loadingStage: null, lastPublishResult: null });

        try {
          const session = await loadStoryTreeAction(storyId);
          const fullSession = deriveSessionFields(session, session.storyMap);

          if (process.env.NODE_ENV === 'development') {
            const nodeCount = Object.keys(fullSession.storyMap.nodes).length;
            console.log(`[exploreStory] Loaded ${nodeCount} nodes, exploration=${fullSession.explorationMode}`);
          }

          set({ session: fullSession, isLoading: false, loadingStage: null, saveStatus: 'saved' });
        } catch (error: any) {
          set({ isLoading: false, loadingStage: null, error: error.message || 'Failed to load story for exploration' });
        }
      },

      refreshSignedUrls: async () => {
        const session = get().session;
        if (!session?.savedStoryId) return;
        try {
          const refreshedMap = await refreshStoryMapAction(session.savedStoryId);
          const current = get().session;
          if (!current || current.savedStoryId !== session.savedStoryId) return;
          set({ session: deriveSessionFields(current, refreshedMap) });
        } catch {
          // Silent fail — URLs will still work until full expiry
        }
      },

      clearPublishResult: () => {
        set({ lastPublishResult: null });
      },

      clearError: () => {
        set({ error: null, errorAction: null });
      },
    })
);
