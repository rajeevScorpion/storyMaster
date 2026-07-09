'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getReelStorySetupSettings, getStoryboardSettings, getStoryModelOverrides } from '@/app/actions/admin';
import { getImageModelPickerState } from '@/app/actions/image-models';
import { listReelVisualStyleCardsAction } from '@/app/actions/reel-styles';
import { listPublishedReelMoodsAction } from '@/app/actions/reel-moods';
import type { ReelMoodRecord } from '@/lib/reel/moods';
import { getNarrationVoiceSelectionConfig } from '@/app/actions/narration';
import { isEnglishNarrationLanguage } from '@/lib/ai/narration-accents';
import { generateSeedPlanPreview, distributeReelTextAction } from '@/app/actions/story-runtime';
import {
  authorizeCurrentUserBillableAction,
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from '@/app/actions/pricing-enforcement';
import { useStoryStore } from '@/lib/store/story-store';
import { AgeGroup, SeedPlan, StoryConfig, StoryLanguage, VisualSettings, SourceFidelity } from '@/lib/types/story';
import { imageProviderSupportsStatefulContinuity, type ImageContinuityStrategy } from '@/lib/ai/image-continuity.shared';
import { imageTaskForStoryKind, type ImageModelPickerState, type ImageModelSelection } from '@/lib/ai/image-models.shared';
import {
  getReelLegacyLengthForBeatCount,
  getReelTextLengthRange,
  normalizeReelStorySettings,
  type ReelStorySetupSettings,
  type ReelTextLengthKey,
} from '@/lib/reel/settings';
import {
  normalizeReelNarrationSettings,
} from '@/lib/reel/narration';
import {
  getDefaultReelTextFontFamilyForLanguage,
  isReelTextFontFamilyCompatibleWithLanguage,
  type ReelVisualStyleCard,
} from '@/lib/reel/styles';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import type { PricingRuntimeContext } from '@/lib/types/pricing';
import { Lock, Sparkles, ChevronDown, ChevronUp, RefreshCcw, Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AdvancedOptions from './AdvancedOptions';
import Gallery from './Gallery';
import PromptCarousel from './PromptCarousel';
import FilterDropdown from '@/components/ui/FilterDropdown';
import { DEFAULT_STORY_CONFIG, normalizeStoryConfig } from '@/lib/ai/story-config';
import {
  FALLBACK_REEL_SETUP,
  DEFAULT_LANDING_INITIAL_DATA,
  DEFAULT_LANDING_SETUP_SETTINGS,
  getDefaultNarrationVoiceSelection,
  normalizeLandingInitialData,
  type LandingInitialData,
} from '@/lib/story/landing-ui';
import type {
  NarrationGenderBucket,
  NarrationVoiceClientConfig,
} from '@/lib/ai/narration-voices';

interface LandingScreenProps {
  onBegin?: (prompt: string, config?: StoryConfig, opts?: { autoBuild?: boolean }) => void;
  initialData?: LandingInitialData | null;
  initialPricing?: PricingRuntimeContext | null;
}

function countWords(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }

  return normalized.split(/\s+/).length;
}

type CreationMode = 'prompt' | 'seeded' | 'reel';

const REEL_SETUP_CACHE_KEY = 'kissago_reel_story_setup_cache';
const REEL_SETUP_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REEL_LANDING_BEAT_COUNT = 1;

function readCachedReelSetup(): ReelStorySetupSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(REEL_SETUP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      cachedAt?: number;
      setup?: Partial<ReelStorySetupSettings>;
    };
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > REEL_SETUP_CACHE_TTL_MS || !parsed.setup) {
      return null;
    }
    return {
      enabled: Boolean(parsed.setup.enabled),
      publishEnabled: Boolean(parsed.setup.publishEnabled),
      settings: normalizeReelStorySettings(parsed.setup.settings ?? FALLBACK_REEL_SETUP.settings),
    };
  } catch {
    return null;
  }
}

function writeCachedReelSetup(setup: ReelStorySetupSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REEL_SETUP_CACHE_KEY, JSON.stringify({
      cachedAt: Date.now(),
      setup,
    }));
  } catch {
    // Best-effort paint cache only.
  }
}

function InfoPopover({
  title,
  ariaLabel,
  children,
}: {
  title: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-neutral-900/80 text-neutral-500 transition-colors hover:border-emerald-400/40 hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.button
              type="button"
              aria-label={`Close ${title} details`}
              className="fixed inset-0 z-[65] bg-black/40 sm:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              id={panelId}
              role="dialog"
              aria-label={title}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-x-3 bottom-3 z-[70] max-h-[75vh] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-950 p-4 text-left shadow-2xl shadow-black/50 sm:absolute sm:inset-auto sm:left-0 sm:top-full sm:mt-2 sm:w-80"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-neutral-100">{title}</p>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-white/10 hover:text-neutral-200"
                  aria-label={`Close ${title} details`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-neutral-400">
                {children}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function LandingScreen({ onBegin, initialData, initialPricing }: LandingScreenProps) {
  const [initialLandingData] = useState(() => normalizeLandingInitialData(initialData ?? DEFAULT_LANDING_INITIAL_DATA));
  const router = useRouter();
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState('');
  const startStory = useStoryStore((state) => state.startStory);
  const generateAutomatedStory = useStoryStore((state) => state.generateAutomatedStory);
  const isLoading = useStoryStore((state) => state.isLoading);
  const pricingRuntime = usePricingRuntime();
  const pricing = pricingRuntime.isLoading && initialPricing ? initialPricing : pricingRuntime.data;

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [language, setLanguage] = useState<StoryLanguage>('english');
  const [ageGroup, setAgeGroup] = useState<AgeGroup>('all_ages');
  const [settingCountry, setSettingCountry] = useState('generic');
  const [customSetting, setCustomSetting] = useState('');
  const [maxBeats, setMaxBeats] = useState(6);
  const [visualSettings, setVisualSettings] = useState<VisualSettings>(DEFAULT_STORY_CONFIG.visualSettings);
  const [creationMode, setCreationMode] = useState<CreationMode>('prompt');
  const [authoringMode, setAuthoringMode] = useState<StoryConfig['authoring']['mode']>(DEFAULT_STORY_CONFIG.authoring.mode);
  const [workingTitle, setWorkingTitle] = useState(DEFAULT_STORY_CONFIG.authoring.workingTitle || '');
  const [sourceText, setSourceText] = useState(DEFAULT_STORY_CONFIG.authoring.sourceText || '');
  const [guidanceText, setGuidanceText] = useState(DEFAULT_STORY_CONFIG.authoring.guidanceText || '');
  const [sourceFidelity, setSourceFidelity] = useState<SourceFidelity>(DEFAULT_STORY_CONFIG.authoring.sourceFidelity || 'balanced_adaptation');
  const [seedPreview, setSeedPreview] = useState<SeedPlan | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [authoringWordCap, setAuthoringWordCap] = useState(initialLandingData.authoringWordCap);
  // Admin-enabled languages offered in the pickers (main story + reel).
  const storyLanguageOptions = initialLandingData.storyLanguageOptions;
  const [useCreatorOneKCharacterSheet, setUseCreatorOneKCharacterSheet] = useState(false);
  const [setupSettings, setSetupSettings] = useState(initialLandingData.setupSettings);
  const [reelSetup, setReelSetup] = useState<ReelStorySetupSettings>(initialLandingData.reelSetup);
  const [reelLanguage, setReelLanguage] = useState<StoryLanguage>('english');
  const [reelBeatCount, setReelBeatCount] = useState<1 | 2 | 3>(DEFAULT_REEL_LANDING_BEAT_COUNT);
  const [reelTextLength, setReelTextLength] = useState<ReelTextLengthKey>(reelSetup.settings.defaultTextLength);
  const [reelMoodKey, setReelMoodKey] = useState(reelSetup.settings.defaultMood);
  const [reelVisualStyleKey, setReelVisualStyleKey] = useState(reelSetup.settings.defaultVisualStyle);
  const [reelVisualStyleId, setReelVisualStyleId] = useState<string | null>(null);
  const [reelVisualStyleCards, setReelVisualStyleCards] = useState<ReelVisualStyleCard[]>([]);
  const [publishedMoods, setPublishedMoods] = useState<ReelMoodRecord[]>([]);
  const [reelInputMode, setReelInputMode] = useState<'prompt' | 'text'>('prompt');
  const [reelUserText, setReelUserText] = useState('');
  const [reelDistributedTexts, setReelDistributedTexts] = useState<string[][] | null>(null);
  const [reelDistributedImagePrompts, setReelDistributedImagePrompts] = useState<string[] | null>(null);
  const [isDistributing, setIsDistributing] = useState(false);
  const [distributeError, setDistributeError] = useState<string | null>(null);
  const [isVerticalStory, setIsVerticalStory] = useState(false);
  const [imageGenerationMode, setImageGenerationMode] = useState<StoryConfig['imageGenerationMode']>(
    DEFAULT_STORY_CONFIG.imageGenerationMode
  );
  const [imageDeliveryMode, setImageDeliveryMode] = useState<NonNullable<StoryConfig['imageDeliveryMode']>>(
    DEFAULT_STORY_CONFIG.imageDeliveryMode ?? 'live'
  );
  const [episodicCharacters, setEpisodicCharacters] = useState<boolean>(
    DEFAULT_STORY_CONFIG.episodicCharacters ?? false
  );
  const [autoBuildStory, setAutoBuildStory] = useState(false);
  const [imageModelSelection, setImageModelSelection] = useState<ImageModelSelection | undefined>(
    DEFAULT_STORY_CONFIG.imageModelSelection
  );
  const [imageContinuityStrategy, setImageContinuityStrategy] = useState<ImageContinuityStrategy>(
    DEFAULT_STORY_CONFIG.imageContinuityStrategy
  );
  const [imageModelPicker, setImageModelPicker] = useState<ImageModelPickerState | null>(null);
  const [narrationVoiceConfig, setNarrationVoiceConfig] = useState<NarrationVoiceClientConfig | null>(
    initialLandingData.narrationVoiceConfig
  );
  const [narrationVoiceConfigLoading, setNarrationVoiceConfigLoading] = useState(false);
  // Cache per-language configs so re-selecting a language is instant (no repeat
  // round-trip). Plan-based accent gating is stable within a session, so a
  // cached per-language payload stays valid for the life of this component.
  const narrationVoiceConfigCacheRef = useRef<Map<StoryLanguage, NarrationVoiceClientConfig>>(
    new Map(
      initialLandingData.narrationVoiceConfig
        ? [['english', initialLandingData.narrationVoiceConfig]]
        : []
    )
  );
  const [narrationVoiceSelection, setNarrationVoiceSelection] = useState<{
    genderBucket: NarrationGenderBucket;
    voiceId: string;
    accent: string;
  }>(() => getDefaultNarrationVoiceSelection(initialLandingData.narrationVoiceConfig));
  const storyLengthUiEnabled = pricing.controls.pricingStoryLengthUiLimitsEnabled;
  const storyLengthCap = storyLengthUiEnabled ? Math.max(3, pricing.snapshot.storyLengthCap) : 8;
  const isReelMode = creationMode === 'reel';
  const reelMaxBeats = reelBeatCount;
  const effectiveMaxBeats = isReelMode ? reelMaxBeats : storyLengthUiEnabled ? Math.min(maxBeats, storyLengthCap) : maxBeats;
  const imageTaskKey = imageTaskForStoryKind(isReelMode ? 'reel' : 'story');
  const selectedImageModel = imageModelPicker?.options.find((option) => option.modelKey === imageModelSelection?.modelKey)
    ?? imageModelPicker?.options.find((option) => option.modelKey === imageModelPicker.selectedModelKey)
    ?? imageModelPicker?.options.find((option) => option.isDefault)
    ?? null;
  const statefulContinuityAvailable = selectedImageModel
    ? imageProviderSupportsStatefulContinuity(selectedImageModel.providerKey)
    : true;
  const promptOnlyActionCost = isReelMode
    ? pricing.actionCosts.start_reel_full_generation_prompt_only ?? 1.5
    : pricing.actionCosts.start_story_initial_beat_prompt_only ?? 0.5;
  const generatedActionCostFallback = isReelMode
    ? pricing.actionCosts.start_reel_full_generation ?? 3
    : pricing.actionCosts.start_story_initial_beat ?? 1;
  const modelImageCoinCost = selectedImageModel?.coinCostPerImage ?? Math.max(0, (generatedActionCostFallback - promptOnlyActionCost) * 10);
  const startStoryCoinCost = imageGenerationMode === 'prompt_only'
    ? promptOnlyActionCost * 10
    : (promptOnlyActionCost * 10) + (modelImageCoinCost * (isReelMode ? reelBeatCount : 1));
  const isCreatorPlan = pricing.snapshot.creatorControls;
  const showCreatorSettings = isCreatorPlan && setupSettings.creatorCharacterSheetsEnabled;
  const selectedReelVisualStyle = reelVisualStyleCards.find((style) => style.id === reelVisualStyleId)
    ?? reelVisualStyleCards.find((style) => !style.isLocked)
    ?? null;

  useEffect(() => {
    if (searchParams.get('mode') === 'reel') {
      setCreationMode('reel');
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    getImageModelPickerState(imageTaskKey, imageModelSelection)
      .then((state) => {
        if (cancelled) return;
        setImageModelPicker(state);
        if (
          (!imageModelSelection?.modelKey || imageModelSelection.taskKey !== state.taskKey)
          && state.selectedModelKey
        ) {
          setImageModelSelection({
            taskKey: state.taskKey,
            modelKey: state.selectedModelKey,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setImageModelPicker(null);
      });
    return () => {
      cancelled = true;
    };
  }, [imageTaskKey, imageModelSelection, pricing.snapshot.planKey]);

  useEffect(() => {
    getStoryboardSettings()
      .then(({
        freePlusCharacterSheetsEnabled,
        creatorCharacterSheetsEnabled,
        storyPromptOnlyModeEnabled,
        verticalStoriesSettingEnabled,
        authoringWordCap: nextAuthoringWordCap,
      }) => {
        setSetupSettings({
          freePlusCharacterSheetsEnabled,
          creatorCharacterSheetsEnabled,
          storyPromptOnlyModeEnabled,
          verticalStoriesSettingEnabled,
        });
        if (!verticalStoriesSettingEnabled) {
          setIsVerticalStory(false);
        }
        setAuthoringWordCap(nextAuthoringWordCap);
      })
      .catch(() => {
        setSetupSettings(DEFAULT_LANDING_SETUP_SETTINGS);
        setIsVerticalStory(false);
        setAuthoringWordCap(DEFAULT_LANDING_INITIAL_DATA.authoringWordCap);
      });
  }, []);

  useEffect(() => {
    if (initialData?.reelSetup) {
      writeCachedReelSetup(initialLandingData.reelSetup);
      return;
    }

    const cached = readCachedReelSetup();
    if (cached) {
      setReelSetup(cached);
    }
  }, [initialData?.reelSetup, initialLandingData.reelSetup]);

  useEffect(() => {
    getReelStorySetupSettings()
      .then((setup) => {
        writeCachedReelSetup(setup);
        setReelSetup(setup);
        setReelBeatCount(DEFAULT_REEL_LANDING_BEAT_COUNT);
        setReelTextLength(setup.settings.defaultTextLength);
        setReelMoodKey(setup.settings.defaultMood);
        setReelVisualStyleKey(setup.settings.defaultVisualStyle);
      })
      .catch(() => {
        setReelSetup((current) => current ?? FALLBACK_REEL_SETUP);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    listReelVisualStyleCardsAction()
      .then((styles) => {
        if (cancelled) return;
        setReelVisualStyleCards(styles);
        const firstUnlocked = styles.find((style) => !style.isLocked) ?? styles[0];
        if (firstUnlocked) {
          setReelVisualStyleId((current) => current || firstUnlocked.id);
          setReelVisualStyleKey((current) => current || firstUnlocked.slug);
        }
      })
      .catch(() => {
        if (!cancelled) setReelVisualStyleCards([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listPublishedReelMoodsAction()
      .then((moods) => { if (!cancelled) setPublishedMoods(moods); })
      .catch(() => { if (!cancelled) setPublishedMoods([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applyConfig = (config: NarrationVoiceClientConfig) => {
      setNarrationVoiceConfig(config);
      setNarrationVoiceSelection((current) => {
        // Keep the accent valid for the (possibly language-changed) config.
        const accentIds = config.accentEnabled ? config.accentOptions.map((option) => option.id) : [];
        const nextAccent = config.accentEnabled
          ? (current.accent && accentIds.includes(current.accent)
              ? current.accent
              : (accentIds.includes(config.defaultAccent) ? config.defaultAccent : accentIds[0] || ''))
          : '';
        if (!config.enabled) {
          return { ...current, accent: nextAccent };
        }
        const list = current.genderBucket === 'male' ? config.maleVoiceList : config.femaleVoiceList;
        const configuredDefault = current.genderBucket === 'male' ? config.defaultMaleVoice : config.defaultFemaleVoice;
        if (current.voiceId && list.includes(current.voiceId)) {
          return { ...current, accent: nextAccent };
        }
        return {
          genderBucket: current.genderBucket,
          voiceId: list.includes(configuredDefault) ? configuredDefault : list[0] || '',
          accent: nextAccent,
        };
      });
    };

    const cached = narrationVoiceConfigCacheRef.current.get(language);
    if (cached) {
      // Apply synchronously — no loading flash, no round-trip.
      setNarrationVoiceConfigLoading(false);
      applyConfig(cached);
      return () => {
        cancelled = true;
      };
    }

    setNarrationVoiceConfigLoading(true);
    getNarrationVoiceSelectionConfig(language)
      .then((config) => {
        narrationVoiceConfigCacheRef.current.set(language, config);
        if (cancelled) return;
        applyConfig(config);
        setNarrationVoiceConfigLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNarrationVoiceConfig(null);
        setNarrationVoiceConfigLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [language]);

  // Restore prompt after OAuth redirect — use initializer pattern to avoid setState in effect
  useEffect(() => {
    const savedPrompt = sessionStorage.getItem('kissago_pending_prompt');
    if (savedPrompt) {
      // Use flushSync-free approach: schedule state updates in a microtask
      queueMicrotask(() => {
        setPrompt(savedPrompt);
        sessionStorage.removeItem('kissago_pending_prompt');
        const savedConfig = sessionStorage.getItem('kissago_pending_config');
        if (savedConfig) {
          try {
            const config = normalizeStoryConfig(JSON.parse(savedConfig) as StoryConfig);
            setCreationMode(config.storyKind === 'reel' ? 'reel' : config.authoring.mode === 'seeded' ? 'seeded' : 'prompt');
            setLanguage(config.language);
            setReelLanguage(config.language);
            setAgeGroup(config.ageGroup);
            const isPresetSetting = ['generic', 'India', 'Japan', 'USA', 'Medieval Europe', 'Fantasy Land', 'Space', 'Underwater'].includes(config.settingCountry);
            setSettingCountry(isPresetSetting ? config.settingCountry : 'custom');
            setCustomSetting(isPresetSetting ? '' : config.settingCountry);
            setMaxBeats(config.maxBeats);
            setVisualSettings(config.visualSettings);
            setAuthoringMode(config.authoring.mode);
            setReelBeatCount(config.reel.beatCount);
            setReelTextLength(config.reel.textLength);
            setReelMoodKey(config.reel.moodKey);
            setReelVisualStyleKey(config.reel.visualStyleKey);
            setReelVisualStyleId(config.reel.visualStyleId || null);
            setWorkingTitle(config.authoring.workingTitle || '');
            setSourceText(config.authoring.sourceText || '');
            setGuidanceText(config.authoring.guidanceText || '');
            setSourceFidelity(config.authoring.sourceFidelity || 'balanced_adaptation');
            setSeedPreview(config.authoring.seedPlan || null);
            setImageGenerationMode(config.imageGenerationMode || DEFAULT_STORY_CONFIG.imageGenerationMode);
            setImageDeliveryMode(config.imageDeliveryMode || DEFAULT_STORY_CONFIG.imageDeliveryMode || 'live');
            setEpisodicCharacters(config.episodicCharacters === true);
            setAutoBuildStory(sessionStorage.getItem('kissago_pending_autobuild') === '1');
            sessionStorage.removeItem('kissago_pending_autobuild');
            setImageModelSelection(config.imageModelSelection);
            setImageContinuityStrategy(config.imageContinuityStrategy || DEFAULT_STORY_CONFIG.imageContinuityStrategy);
            setIsVerticalStory(config.isVerticalStory || config.aspectRatio === '9:16');
            setUseCreatorOneKCharacterSheet(
              config.portraitReferences.mode === 'character_sheet' &&
              config.portraitReferences.quality === '1K'
            );
            if (config.narrationVoice?.mode === 'user_selected') {
              setNarrationVoiceSelection((current) => ({
                genderBucket: config.narrationVoice!.genderBucket || 'female',
                voiceId: config.narrationVoice!.voiceId || '',
                accent: config.narrationVoice!.accent || current.accent,
              }));
            }
          } catch { /* ignore parse errors */ }
          sessionStorage.removeItem('kissago_pending_config');
        }
      });
    }
  }, []);

  const previewSeedPlanCoinCost = (pricing.actionCosts.preview_seed_plan ?? 0) * 10;
  const authoringWordCount = countWords(
    creationMode === 'seeded'
      ? `${sourceText} ${guidanceText}`
      : prompt
  );
  const isOverAuthoringWordCap = authoringWordCount > authoringWordCap;

  const clearSeedPreview = () => {
    setSeedPreview(null);
    setPreviewError(null);
  };

  const buildPortraitReferences = () => {
    if (showCreatorSettings) {
      return {
        mode: 'character_sheet' as const,
        quality: useCreatorOneKCharacterSheet ? '1K' as const : '0.5K' as const,
      };
    }

    if (!isCreatorPlan && setupSettings.freePlusCharacterSheetsEnabled) {
      return {
        mode: 'character_sheet' as const,
        quality: '0.5K' as const,
      };
    }

    return {
      mode: 'single_portrait' as const,
      quality: '0.5K' as const,
    };
  };

  const buildStoryConfig = (
    seedPlan?: SeedPlan,
    voiceConfig: NarrationVoiceClientConfig | null = narrationVoiceConfig
  ): StoryConfig => {
    if (isReelMode) {
      const legacyLength = getReelLegacyLengthForBeatCount(reelBeatCount);
      const selectedStyle = selectedReelVisualStyle;
      const selectedTextOverlayStyle = selectedStyle?.textOverlayStyle;
      const textOverlayFontFamily = isReelTextFontFamilyCompatibleWithLanguage(
        selectedTextOverlayStyle?.fontFamily,
        reelLanguage
      )
        ? selectedTextOverlayStyle?.fontFamily
        : getDefaultReelTextFontFamilyForLanguage(reelLanguage);
      return {
        storyKind: 'reel',
        language: reelLanguage,
        ageGroup,
        settingCountry: 'generic',
        maxBeats: reelBeatCount,
      imageGenerationMode,
      imageContinuityStrategy,
      ...(imageGenerationMode !== 'prompt_only' && imageModelSelection
        ? { imageModelSelection: { ...imageModelSelection, taskKey: imageTaskKey } }
        : {}),
      isVerticalStory: true,
        aspectRatio: '9:16',
        visualSettings,
        authoring: reelInputMode === 'text' && reelDistributedTexts && reelDistributedImagePrompts
          ? {
              mode: 'user_text' as const,
              reelPanelTexts: reelDistributedTexts,
              reelImagePrompts: reelDistributedImagePrompts,
            }
          : {
              mode: 'prompt' as const,
            },
        reel: {
          length: legacyLength,
          beatCount: reelBeatCount,
          textLength: reelTextLength,
          textOverlayEnabled: reelSetup.settings.textOverlayDefault,
          visualStyleId: selectedStyle?.id ?? reelVisualStyleId,
          textOverlayStyle: {
            ...selectedTextOverlayStyle,
            fontFamily: textOverlayFontFamily,
          },
          moodKey: reelMoodKey,
          visualStyleKey: selectedStyle?.slug ?? reelVisualStyleKey,
          narrationStyleKey: reelSetup.settings.defaultNarrationStyle,
          narrationSettings: normalizeReelNarrationSettings(null, {
            storyLanguage: reelLanguage,
            adminSettings: reelSetup.settings.narration,
          }),
          brandingEnabled: true,
        },
        storyTextOverlay: DEFAULT_STORY_CONFIG.storyTextOverlay,
        storyTransition: DEFAULT_STORY_CONFIG.storyTransition,
        portraitReferences: buildPortraitReferences(),
        narrationVoice: {
          mode: 'legacy_auto',
        },
      };
    }

    const verticalStoryEnabled = setupSettings.verticalStoriesSettingEnabled && isVerticalStory;
    // Accents are English-only. Guard on the story language here too: if the user
    // starts a non-English story before the per-language config refetch resolves,
    // the stale (English) config would otherwise attach an accent to the story.
    const accentForStory = voiceConfig?.accentEnabled && isEnglishNarrationLanguage(language)
      ? narrationVoiceSelection.accent
      : '';
    return {
      storyKind: 'story',
      language,
      ageGroup,
      settingCountry: settingCountry === 'custom' ? customSetting || 'generic' : settingCountry,
      maxBeats: effectiveMaxBeats,
      imageGenerationMode,
      imageDeliveryMode: imageGenerationMode === 'generate' ? imageDeliveryMode : 'live',
      episodicCharacters: imageGenerationMode === 'generate' && imageDeliveryMode === 'stateful' && episodicCharacters,
      imageContinuityStrategy,
      ...(imageGenerationMode !== 'prompt_only' && imageModelSelection
        ? { imageModelSelection: { ...imageModelSelection, taskKey: imageTaskKey } }
        : {}),
      isVerticalStory: verticalStoryEnabled,
      aspectRatio: verticalStoryEnabled ? '9:16' : '16:9',
      visualSettings,
      authoring: authoringMode === 'seeded'
        ? {
            mode: 'seeded',
            workingTitle: workingTitle.trim(),
            sourceText: sourceText.trim(),
            guidanceText: guidanceText.trim(),
            sourceFidelity,
            ...(seedPlan ? { seedPlan } : {}),
          }
        : {
            mode: 'prompt',
      },
      reel: DEFAULT_STORY_CONFIG.reel,
      storyTextOverlay: DEFAULT_STORY_CONFIG.storyTextOverlay,
      storyTransition: DEFAULT_STORY_CONFIG.storyTransition,
      portraitReferences: buildPortraitReferences(),
      narrationVoice: voiceConfig?.enabled
        ? {
            mode: 'user_selected',
            genderBucket: narrationVoiceSelection.genderBucket,
            voiceId: narrationVoiceSelection.voiceId || (
              narrationVoiceSelection.genderBucket === 'male'
                ? voiceConfig.defaultMaleVoice
                : voiceConfig.defaultFemaleVoice
            ),
            languageCode: voiceConfig.languageCode,
            ...(accentForStory ? { accent: accentForStory } : {}),
          }
        : accentForStory
          ? {
              // Legacy auto voice, but the user still picked an accent.
              mode: 'legacy_auto',
              accent: accentForStory,
            }
          : {
              mode: 'legacy_auto',
            },
    };
  };

  const startConfiguredStory = async (seedPlan?: SeedPlan) => {
    const voiceConfig = isReelMode
      ? narrationVoiceConfig
      : narrationVoiceConfig || await getNarrationVoiceSelectionConfig(language).catch(() => null);
    const config = buildStoryConfig(seedPlan, voiceConfig);
    const storyPrompt = creationMode === 'seeded'
      ? sourceText.trim()
      : (isReelMode && reelInputMode === 'text')
        ? reelUserText.trim()
        : prompt.trim();
    if (!storyPrompt) return;

    const shouldAutoBuild =
      autoBuildStory && !isReelMode && config.imageGenerationMode === 'generate'
      && (imageDeliveryMode === 'batch' || imageDeliveryMode === 'stateful');

    if (onBegin) {
      onBegin(storyPrompt, config, { autoBuild: shouldAutoBuild });
      return;
    }

    if (shouldAutoBuild) {
      await generateAutomatedStory(storyPrompt, config);
      return;
    }

    await startStory(storyPrompt, config);
  };

  const buildPreviewPricingError = (authorization: Awaited<ReturnType<typeof authorizeCurrentUserBillableAction>>) => {
    if (authorization.status === 'allowed' || authorization.status === 'bypassed') {
      return null;
    }

    if (authorization.reason === 'sign_in_required') {
      return 'Sign in to preview a seeded story plan.';
    }

    const availableCoins = authorization.availableCoins.toLocaleString();
    if (authorization.reason === 'checkout_unavailable') {
      return `You need ${authorization.coinCost.toLocaleString()} coins to preview a seeded plan, and checkout is still unavailable. You currently have ${availableCoins} coins.`;
    }

    return `You need ${authorization.coinCost.toLocaleString()} coins to preview a seeded plan. You currently have ${availableCoins} coins.`;
  };

  const handleGeneratePreview = async () => {
    if (!sourceText.trim() || isGeneratingPreview || isLoading || isOverAuthoringWordCap) {
      return;
    }

    setIsGeneratingPreview(true);
    setPreviewError(null);
    let reservationId: string | null = null;
    let shouldReleaseReservation = false;

    try {
      const authorization = await authorizeCurrentUserBillableAction({
        actionKey: 'preview_seed_plan',
        idempotencyKey: `preview_seed_plan:${Date.now()}:${effectiveMaxBeats}`,
        metadata: {
          authoringMode,
          beatCount: effectiveMaxBeats,
          language,
          sourceFidelity,
        },
      });
      const pricingError = buildPreviewPricingError(authorization);
      if (pricingError) {
        setPreviewError(pricingError);
        return;
      }

      reservationId = authorization.status === 'allowed' && authorization.mode === 'hard'
        ? authorization.reservationId
        : null;
      shouldReleaseReservation = Boolean(reservationId);

      const modelOverrides = await getStoryModelOverrides().catch(() => undefined);
      const previewSessionId = crypto.randomUUID();
      const nextPreview = await generateSeedPlanPreview({
        storyConfig: buildStoryConfig(),
        sourceText: sourceText.trim(),
        beatCount: effectiveMaxBeats,
        workingTitle: workingTitle.trim(),
        guidanceText: guidanceText.trim(),
        sourceFidelity,
        modelOverrides,
        costTelemetry: {
          activityKey: 'preview_seed_plan',
          storySessionId: previewSessionId,
          metadata: {
            beatCount: effectiveMaxBeats,
            language,
            sourceFidelity,
          },
        },
      });

      setSeedPreview(nextPreview);
      window.setTimeout(() => {
        document.getElementById('seed-preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

      if (reservationId) {
        await finalizeCurrentUserBillableAction({
          reservationId,
          metadata: {
            action: 'preview_seed_plan',
            beatCount: effectiveMaxBeats,
          },
        });
        shouldReleaseReservation = false;
      }
    } catch (error: any) {
      if (reservationId && shouldReleaseReservation) {
        try {
          await releaseCurrentUserBillableAction({
            reservationId,
            reason: 'preview_seed_plan_failed',
            releaseStatus: 'failed',
            metadata: {
              message: error?.message || 'Failed to preview seeded story plan',
            },
          });
        } catch {
          // Ignore secondary release failures here.
        }
      }
      setPreviewError(error?.message || 'Failed to generate a seeded beat preview.');
    } finally {
      setIsGeneratingPreview(false);
    }
  };

  const handleDistributeReelText = async () => {
    if (!reelUserText.trim() || isDistributing || isLoading) return;
    setIsDistributing(true);
    setDistributeError(null);
    setReelDistributedTexts(null);
    setReelDistributedImagePrompts(null);
    try {
      const result = await distributeReelTextAction({
        text: reelUserText.trim(),
        beatCount: reelBeatCount,
        language: reelLanguage,
        wordsPerPanel: getReelTextLengthRange(reelSetup.settings, reelTextLength),
      });
      setReelDistributedTexts(result.panelTexts);
      setReelDistributedImagePrompts(result.imagePrompts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to distribute text across panels.';
      setDistributeError(msg);
    } finally {
      setIsDistributing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (creationMode === 'seeded') {
      if (!seedPreview) {
        await handleGeneratePreview();
        return;
      }

      if (!isOverAuthoringWordCap && !isLoading) {
        await startConfiguredStory(seedPreview);
      }
      return;
    }

    if (isReelMode && reelInputMode === 'text') {
      if (!reelDistributedTexts) {
        await handleDistributeReelText();
        return;
      }
      if (!isLoading) {
        await startConfiguredStory();
      }
      return;
    }

    if (prompt.trim() && !isLoading && !isOverAuthoringWordCap) {
      await startConfiguredStory();
    }
  };

  return (
    <div className="bg-neutral-950 relative overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-32 bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-transparent sm:h-40 md:h-48"
      />
      {/* Hero section — full viewport height */}
      <div className="min-h-screen flex flex-col items-center justify-center p-4 relative">
        {/* Background decoration */}
        <div className="absolute inset-0 z-0">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-900/20 rounded-full blur-3xl mix-blend-screen" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-900/20 rounded-full blur-3xl mix-blend-screen" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="z-10 w-full max-w-5xl text-center space-y-8"
        >
          <div className="space-y-4">
            <h1 className="text-5xl md:text-7xl font-serif text-neutral-100 tracking-tight">
              Kissago
            </h1>
            <p className="text-lg md:text-xl text-neutral-400 font-sans max-w-lg mx-auto leading-relaxed">
              Co-create magical, illustrated branching stories with Kissago.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="relative mt-12 w-full">
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="flex justify-center">
                <div className="inline-flex rounded-2xl border border-white/10 bg-neutral-900/80 p-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setCreationMode('prompt');
                      setAuthoringMode('prompt');
                      clearSeedPreview();
                    }}
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                      creationMode === 'prompt'
                        ? 'bg-white text-black'
                        : 'text-neutral-300 hover:text-white'
                    }`}
                  >
                    Quick Story
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreationMode('seeded');
                      setAuthoringMode('seeded');
                      clearSeedPreview();
                    }}
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                      creationMode === 'seeded'
                        ? 'bg-white text-black'
                        : 'text-neutral-300 hover:text-white'
                    }`}
                  >
                    Seed Story
                  </button>
                  {reelSetup.enabled && (
                    <button
                      type="button"
                      onClick={() => {
                      setCreationMode('reel');
                      setAuthoringMode('prompt');
                      setReelBeatCount(DEFAULT_REEL_LANDING_BEAT_COUNT);
                      setReelTextLength(reelSetup.settings.defaultTextLength);
                      setImageGenerationMode('prompt_only');
                      setIsVerticalStory(true);
                      setShowAdvanced(false);
                      clearSeedPreview();
                      }}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                        creationMode === 'reel'
                          ? 'bg-white text-black'
                          : 'text-neutral-300 hover:text-white'
                      }`}
                    >
                      Reels
                    </button>
                  )}
                </div>
              </div>

              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-indigo-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
                <div className="relative rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl">
                  {creationMode !== 'seeded' ? (
                    <div className="space-y-3 p-2">
                      {!isReelMode && (
                        <div className="flex items-center">
                          <input
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Tell me a story of a monkey and an elephant..."
                            className="w-full bg-transparent text-white placeholder-neutral-500 px-4 py-3 outline-none font-sans text-lg"
                            disabled={isLoading}
                          />
                          <button
                            type="submit"
                            disabled={!prompt.trim() || isLoading || isOverAuthoringWordCap}
                            className="ml-2 bg-white text-black px-6 py-3 rounded-xl font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            {isLoading ? (
                              <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <>
                                <span>Begin</span>
                                <Sparkles className="w-4 h-4" />
                              </>
                            )}
                          </button>
                        </div>
                      )}
                      {isReelMode && (
                        <div className="space-y-3 border-t border-white/10 px-2 pb-2 pt-3 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="inline-flex rounded-xl border border-white/10 bg-neutral-950/50 p-1">
                              <button
                                type="button"
                                onClick={() => { setReelInputMode('prompt'); setReelDistributedTexts(null); setReelDistributedImagePrompts(null); setDistributeError(null); }}
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${reelInputMode === 'prompt' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'}`}
                              >
                                Idea
                              </button>
                              <button
                                type="button"
                                onClick={() => setReelInputMode('text')}
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${reelInputMode === 'text' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'}`}
                              >
                                Script
                              </button>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Mode</span>
                              <InfoPopover title="Idea or script" ariaLabel="Show reel input mode details">
                                <p>
                                  Idea lets Kissago shape your thought into expressive short-form reel text, beat panels, and visual prompts.
                                </p>
                                <p>
                                  Script follows the content you provide more strictly, then splits it into beat panels and matching image prompts.
                                </p>
                              </InfoPopover>
                            </div>
                          </div>

                          {reelInputMode === 'prompt' ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="Make a short reel about a moonlit mango market..."
                                className="min-h-12 w-full rounded-xl border border-white/10 bg-neutral-800/60 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50"
                                disabled={isLoading}
                              />
                              <div className="flex justify-end">
                                <button
                                  type="submit"
                                  disabled={!prompt.trim() || isLoading || isOverAuthoringWordCap}
                                  className="inline-flex min-h-10 min-w-32 items-center justify-center whitespace-nowrap rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isLoading ? (
                                    <span>Generating...</span>
                                  ) : (
                                    <span>Generate reel</span>
                                  )}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="relative">
                                <textarea
                                  value={reelUserText}
                                  onChange={(e) => {
                                    setReelUserText(e.target.value);
                                    setReelDistributedTexts(null);
                                    setReelDistributedImagePrompts(null);
                                  }}
                                  placeholder="Write your full reel script here. Kissago will split it across panels and derive image prompts."
                                  rows={4}
                                  maxLength={800}
                                  className="min-h-32 w-full resize-none rounded-xl border border-white/10 bg-neutral-800/60 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50"
                                  disabled={isLoading || isDistributing}
                                />
                                <span className={`absolute bottom-2 right-3 text-[11px] ${reelUserText.length > 800 ? 'text-rose-400' : 'text-neutral-500'}`}>
                                  {reelUserText.length} / 800
                                </span>
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                {distributeError && <p className="text-xs text-rose-400">{distributeError}</p>}
                                <button
                                  type="button"
                                  onClick={() => void handleDistributeReelText()}
                                  disabled={!reelUserText.trim() || reelUserText.length > 800 || isDistributing || isLoading}
                                  className="inline-flex min-h-10 min-w-32 self-end items-center justify-center whitespace-nowrap rounded-xl bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-50 sm:ml-auto"
                                >
                                  {isDistributing ? 'Preparing...' : 'Prepare panels'}
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="rounded-xl border border-white/10 bg-neutral-950/40 p-3">
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                              <div className="space-y-2">
                                <label className="flex h-6 items-center truncate text-[10px] uppercase tracking-[0.14em] text-neutral-500 sm:text-[11px]">Language</label>
                                <FilterDropdown
                                  value={reelLanguage}
                                  options={storyLanguageOptions}
                                  onChange={(value) => {
                                    setReelLanguage(value as StoryLanguage);
                                    setReelDistributedTexts(null);
                                    setReelDistributedImagePrompts(null);
                                    setDistributeError(null);
                                  }}
                                  fullWidth
                                  mode="inline"
                                  ariaLabel="Choose reel language"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="flex h-6 items-center truncate text-[10px] uppercase tracking-[0.14em] text-neutral-500 sm:text-[11px]">Beats</label>
                                <FilterDropdown
                                  value={String(reelBeatCount)}
                                  options={[
                                    { value: '1', label: '1 beat' },
                                    { value: '2', label: '2 beats' },
                                    { value: '3', label: '3 beats' },
                                  ]}
                                  onChange={(value) => setReelBeatCount(Number(value) as 1 | 2 | 3)}
                                  fullWidth
                                  mode="inline"
                                  ariaLabel="Choose reel beat count"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="flex h-6 items-center truncate text-[10px] uppercase tracking-[0.14em] text-neutral-500 sm:text-[11px]">Text amount</label>
                                <FilterDropdown
                                  value={reelTextLength}
                                  options={[
                                    { value: 'short', label: 'Short' },
                                    { value: 'medium', label: 'Medium' },
                                    { value: 'long', label: 'Long' },
                                  ]}
                                  onChange={(value) => setReelTextLength(value as ReelTextLengthKey)}
                                  fullWidth
                                  mode="inline"
                                  ariaLabel="Choose reel text amount"
                                />
                              </div>
                              <div className="space-y-2">
                                <div className="flex h-6 min-w-0 items-center gap-1">
                                  <label className="truncate text-[10px] uppercase tracking-[0.14em] text-neutral-500 sm:text-[11px]">Images</label>
                                  <InfoPopover title="Image mode" ariaLabel="Show image mode details">
                                    <p>
                                      Bring your own creates the reel text and image prompts so you can generate or upload visuals yourself.
                                    </p>
                                    <p>
                                      AI asks Kissago to generate the reel images for you and uses more coins.
                                    </p>
                                  </InfoPopover>
                                </div>
                                <div className="grid h-10 grid-cols-2 overflow-hidden rounded-xl border border-white/10 bg-neutral-800 text-[11px] font-medium">
                                  <button
                                    type="button"
                                    onClick={() => setImageGenerationMode('prompt_only')}
                                    className={`px-1 transition-colors ${
                                      imageGenerationMode === 'prompt_only'
                                        ? 'bg-emerald-500/25 text-white'
                                        : 'text-neutral-400 hover:bg-neutral-700/60'
                                    }`}
                                    aria-pressed={imageGenerationMode === 'prompt_only'}
                                  >
                                    BYO
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setImageGenerationMode('generate')}
                                    className={`px-1 transition-colors ${
                                      imageGenerationMode === 'generate'
                                        ? 'bg-emerald-500/25 text-white'
                                        : 'text-neutral-400 hover:bg-neutral-700/60'
                                    }`}
                                    aria-pressed={imageGenerationMode === 'generate'}
                                  >
                                    AI
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4 rounded-xl border border-white/10 bg-neutral-800/60 p-3">
                            {(publishedMoods.length > 0 || reelSetup.settings.moods.length > 0) && (
                              <div className="space-y-2">
                                <label className="flex h-5 items-center text-[11px] uppercase tracking-[0.16em] text-neutral-500">Mood</label>
                                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                                  {(publishedMoods.length > 0
                                    ? publishedMoods.map((m) => ({ key: m.slug, label: m.name }))
                                    : reelSetup.settings.moods
                                  ).map((item) => (
                                    <button
                                      key={item.key}
                                      type="button"
                                      onClick={() => setReelMoodKey(item.key)}
                                      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                        reelMoodKey === item.key
                                          ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200'
                                          : 'border-white/10 bg-neutral-900 text-neutral-400 hover:text-white'
                                      }`}
                                    >
                                      {item.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="space-y-2">
                              <label className="flex h-5 items-center text-[11px] uppercase tracking-[0.16em] text-neutral-500">Graphic style</label>
                              <div className="grid gap-2 md:grid-cols-3">
                                {reelVisualStyleCards.length > 0 ? reelVisualStyleCards.map((style) => {
                                  const active = reelVisualStyleId === style.id;
                                  return (
                                    <button
                                      key={style.id}
                                      type="button"
                                      onClick={() => {
                                        if (style.isLocked) {
                                          router.push('/wallet');
                                          return;
                                        }
                                        setReelVisualStyleId(style.id);
                                        setReelVisualStyleKey(style.slug);
                                      }}
                                      className={`relative min-h-28 overflow-hidden rounded-xl border text-left transition-colors ${
                                        active
                                          ? 'border-emerald-400/60 bg-emerald-500/10'
                                          : 'border-white/10 bg-neutral-900 hover:bg-neutral-700/70'
                                      }`}
                                    >
                                      {style.sampleImageUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={style.sampleImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
                                      ) : (
                                        <div className="absolute inset-0 bg-neutral-800" />
                                      )}
                                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                                      <div className="relative flex h-full min-h-28 flex-col justify-end p-3">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-sm font-medium text-white">{style.name}</span>
                                          {style.isLocked && <Lock className="h-4 w-4 text-amber-300" />}
                                        </div>
                                        <span className="mt-1 text-[11px] uppercase tracking-[0.16em] text-neutral-300">{style.minPlan}</span>
                                      </div>
                                    </button>
                                  );
                                }) : (
                                  <div className="rounded-xl border border-white/10 bg-neutral-900 px-3 py-3 text-sm text-neutral-400 md:col-span-3">
                                    Reel visual styles will appear here after an admin publishes samples.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {reelInputMode === 'text' && reelDistributedTexts && (
                            <div className="space-y-3 border-t border-white/10 pt-3">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Panel layout - edit to refine</p>
                              {reelDistributedTexts.map((beatPanels, beatIdx) => (
                                <div key={beatIdx} className="space-y-1.5">
                                  {reelBeatCount > 1 && (
                                    <p className="text-[11px] text-neutral-500">Beat {beatIdx + 1}</p>
                                  )}
                                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                                    {beatPanels.map((text, panelIdx) => (
                                      <textarea
                                        key={panelIdx}
                                        value={text}
                                        onChange={(e) => {
                                          const updated = reelDistributedTexts.map((b, bi) =>
                                            bi === beatIdx ? b.map((t, pi) => (pi === panelIdx ? e.target.value : t)) : b
                                          );
                                          setReelDistributedTexts(updated);
                                        }}
                                        rows={3}
                                        className="rounded-lg border border-white/10 bg-neutral-800/80 px-2 py-2 text-xs text-white outline-none transition-colors focus:border-emerald-500/50 resize-none"
                                        disabled={isLoading}
                                      />
                                    ))}
                                  </div>
                                </div>
                              ))}
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => void startConfiguredStory()}
                                  disabled={isLoading}
                                  className="inline-flex min-h-10 min-w-32 items-center justify-center whitespace-nowrap rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isLoading ? (
                                    <span>Generating...</span>
                                  ) : (
                                    <span>Generate reel</span>
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4 p-4 md:p-5">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,0.7fr)_minmax(0,0.3fr)]">
                        <textarea
                          value={sourceText}
                          onChange={(e) => {
                            setSourceText(e.target.value);
                            clearSeedPreview();
                          }}
                          rows={7}
                          placeholder="Paste a scene list, script excerpt, rough beat notes, or a short story that Kissago should turn into the original path."
                          className="min-h-44 rounded-2xl border border-white/10 bg-neutral-800/80 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50"
                          disabled={isLoading || isGeneratingPreview}
                        />
                        <div className="space-y-3">
                          <input
                            type="text"
                            value={workingTitle}
                            onChange={(e) => {
                              setWorkingTitle(e.target.value);
                              clearSeedPreview();
                            }}
                            placeholder="Working title (optional)"
                            className="min-h-12 w-full rounded-2xl border border-white/10 bg-neutral-800/80 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50"
                            disabled={isLoading || isGeneratingPreview}
                          />
                          <textarea
                            value={guidanceText}
                            onChange={(e) => {
                              setGuidanceText(e.target.value);
                              clearSeedPreview();
                            }}
                            rows={6}
                            placeholder="Extra guidance (optional). For example: keep the tone cozy, preserve dialogue closely, or emphasize a certain visual mood."
                            className="min-h-32 w-full rounded-2xl border border-white/10 bg-neutral-800/80 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50"
                            disabled={isLoading || isGeneratingPreview}
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-neutral-950/50 px-4 py-3 text-left md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">
                            Seeded Authoring
                          </p>
                          <p className="mt-1 text-sm text-neutral-300">
                            Kissago will structure your source into {effectiveMaxBeats} beats, keep that path as the original route, and still allow alternate branches afterward.
                          </p>
                        </div>
                        <div className="flex flex-col items-start gap-2 md:items-end">
                          <span className={`text-xs ${isOverAuthoringWordCap ? 'text-rose-400' : 'text-neutral-500'}`}>
                            {authoringWordCount} / {authoringWordCap} words
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {seedPreview && (
                              <button
                                type="button"
                                onClick={() => void handleGeneratePreview()}
                                disabled={isGeneratingPreview || isLoading}
                                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-200 hover:bg-white/10 disabled:opacity-50"
                              >
                                <span className="inline-flex items-center gap-2">
                                  <RefreshCcw className="h-4 w-4" />
                                  Regenerate
                                </span>
                              </button>
                            )}
                            <button
                              type="submit"
                              disabled={!sourceText.trim() || isGeneratingPreview || isLoading || isOverAuthoringWordCap}
                              className="bg-white text-black px-5 py-2.5 rounded-xl font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                              {isGeneratingPreview ? (
                                <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <>
                                  <span>{seedPreview ? 'Start Story' : 'Preview Beats'}</span>
                                  <Sparkles className="w-4 h-4" />
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {previewError && (
                <p className="text-sm text-rose-400">
                  {previewError}
                </p>
              )}

              <div className="space-y-1 text-center">
                <p className={`text-xs font-sans ${isOverAuthoringWordCap ? 'text-rose-400' : 'text-neutral-500'}`}>
                  {creationMode === 'seeded'
                    ? `Source text and extra guidance share a ${authoringWordCap}-word limit.`
                    : isReelMode
                      ? `Reel prompts use the ${authoringWordCap}-word authoring limit.`
                      : `Prompt text shares the ${authoringWordCap}-word authoring limit.`}
                </p>
                {(pricing.controls.pricingHardEnforcementEnabled || pricing.controls.pricingCheckoutEnabled || previewSeedPlanCoinCost > 0) && (
                  <p className="text-xs font-sans text-neutral-500">
                    {creationMode === 'seeded'
                      ? `${previewSeedPlanCoinCost > 0 ? `Preview uses ${previewSeedPlanCoinCost.toLocaleString()} coins. ` : 'Preview is free. '}Starting the story uses ${startStoryCoinCost.toLocaleString()} coins when payment controls are active.`
                      : isReelMode
                        ? `Starting a reel uses ${startStoryCoinCost.toLocaleString()} coins when payment controls are active.`
                        : `Starting a new story uses ${startStoryCoinCost.toLocaleString()} coins when payment controls are active.`}
                  </p>
                )}
              </div>
            </div>
          </form>

        </motion.div>

        {/* Floating prompt suggestions carousel */}
        {creationMode === 'prompt' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.6 }}
            className="z-10 w-full max-w-3xl mx-auto mt-8"
          >
            <PromptCarousel onSelect={setPrompt} />
          </motion.div>
        )}

        {creationMode !== 'reel' && (
        <div className="z-10 mt-6 w-full max-w-5xl text-center">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors font-sans"
          >
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Advanced Options
          </button>

          <AnimatePresence>
            {showAdvanced && (
              <AdvancedOptions
                language={language}
                languageOptions={storyLanguageOptions}
                onLanguageChange={(value) => {
                  setLanguage(value);
                  clearSeedPreview();
                }}
                ageGroup={ageGroup}
                onAgeGroupChange={(value) => {
                  setAgeGroup(value);
                  clearSeedPreview();
                }}
                settingCountry={settingCountry}
                onSettingCountryChange={(value) => {
                  setSettingCountry(value);
                  clearSeedPreview();
                }}
                customSetting={customSetting}
                onCustomSettingChange={(value) => {
                  setCustomSetting(value);
                  clearSeedPreview();
                }}
                maxBeats={effectiveMaxBeats}
                onMaxBeatsChange={(value) => {
                  setMaxBeats(storyLengthUiEnabled ? Math.min(value, storyLengthCap) : value);
                  clearSeedPreview();
                }}
                visualSettings={visualSettings}
                onVisualSettingsChange={(next) => {
                  setVisualSettings(next);
                  clearSeedPreview();
                }}
                isSeedMode={creationMode === 'seeded'}
                sourceFidelity={sourceFidelity}
                onSourceFidelityChange={(value) => {
                  setSourceFidelity(value);
                  clearSeedPreview();
                }}
                authoringWordCap={authoringWordCap}
                pricingStoryLengthCap={storyLengthCap}
                pricingStoryLengthUiLimitsEnabled={storyLengthUiEnabled}
                currentPlanLabel={pricing.snapshot.planKey}
                onViewPlans={() => router.push('/wallet')}
                showCreatorSettings={showCreatorSettings}
                creatorReferenceQuality={useCreatorOneKCharacterSheet ? '1K' : '0.5K'}
                onCreatorReferenceQualityChange={(value) => setUseCreatorOneKCharacterSheet(value === '1K')}
                storyPromptOnlyModeEnabled={setupSettings.storyPromptOnlyModeEnabled}
                imageGenerationMode={imageGenerationMode}
                onImageGenerationModeChange={setImageGenerationMode}
                batchImageDeliveryEnabled
                imageDeliveryMode={imageDeliveryMode}
                onImageDeliveryModeChange={(value) => {
                  setImageDeliveryMode(value);
                  clearSeedPreview();
                }}
                episodicCharacters={episodicCharacters}
                onEpisodicCharactersChange={setEpisodicCharacters}
                statefulContinuityAvailable={statefulContinuityAvailable}
                autoBuildStory={autoBuildStory}
                onAutoBuildStoryChange={setAutoBuildStory}
                imageModelPicker={imageModelPicker}
                imageModelSelection={imageModelSelection}
                onImageModelSelectionChange={(value) => {
                  setImageModelSelection(value);
                  clearSeedPreview();
                }}
                imageContinuityStrategy={imageContinuityStrategy}
                onImageContinuityStrategyChange={(value) => {
                  setImageContinuityStrategy(value);
                  clearSeedPreview();
                }}
                verticalStoriesSettingEnabled={setupSettings.verticalStoriesSettingEnabled}
                isVerticalStory={isVerticalStory}
                onVerticalStoryChange={(value) => {
                  setIsVerticalStory(value);
                  clearSeedPreview();
                }}
                narrationVoiceConfig={narrationVoiceConfig}
                narrationVoiceConfigLoading={narrationVoiceConfigLoading}
                narrationVoiceSelection={narrationVoiceSelection}
                onNarrationVoiceSelectionChange={setNarrationVoiceSelection}
              />
            )}
          </AnimatePresence>
        </div>
        )}

        {/* Scroll to beat preview indicator — only shown when seeded preview is ready */}
        <AnimatePresence>
          {!showAdvanced && creationMode === 'seeded' && seedPreview && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 cursor-pointer"
              onClick={() => document.getElementById('seed-preview-section')?.scrollIntoView({ behavior: 'smooth' })}
            >
              <span className="text-sm text-neutral-500 font-sans">
                Scroll to review your beat preview
              </span>
              <motion.div
                animate={{ y: [0, 6, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              >
                <ChevronDown className="w-5 h-5 text-neutral-500" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {creationMode === 'seeded' && seedPreview && (
        <section id="seed-preview-section" className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-14">
          <div className="rounded-[28px] border border-white/10 bg-neutral-900/70 p-5 backdrop-blur-md md:p-6 lg:p-7">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-emerald-300">Seed Preview</p>
                <h2 className="mt-2 text-2xl font-serif text-neutral-100">Confirm the original beat path</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-400">
                  Edit the beat titles and beat text if needed, then start the story. The first option on each non-ending beat stays reserved for the original seeded path.
                </p>
              </div>
              <div className="text-sm text-neutral-500">{seedPreview.beatCount} beats</div>
            </div>

            <div className="mt-6 space-y-4">
              {seedPreview.beats.map((beat, index) => (
                <div key={`seed-preview-beat-${beat.beatIndex}`} className="rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">Beat {index + 1}</p>
                    {beat.isEnding && (
                      <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-300">
                        Ending
                      </span>
                    )}
                  </div>

                  <input
                    type="text"
                    value={beat.title}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSeedPreview((current) => current ? {
                        ...current,
                        beats: current.beats.map((candidate, candidateIndex) => (
                          candidateIndex === index ? { ...candidate, title: value } : candidate
                        )),
                      } : current);
                    }}
                    className="mt-3 min-h-12 w-full rounded-2xl border border-white/10 bg-neutral-800/80 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50"
                    placeholder={`Beat ${index + 1} title`}
                  />

                  <textarea
                    value={beat.storyText}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSeedPreview((current) => current ? {
                        ...current,
                        beats: current.beats.map((candidate, candidateIndex) => (
                          candidateIndex === index ? { ...candidate, storyText: value } : candidate
                        )),
                      } : current);
                    }}
                    rows={4}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-neutral-800/80 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50"
                    placeholder="Beat story text"
                  />

                  <textarea
                    value={beat.sceneSummary}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSeedPreview((current) => current ? {
                        ...current,
                        beats: current.beats.map((candidate, candidateIndex) => (
                          candidateIndex === index ? { ...candidate, sceneSummary: value } : candidate
                        )),
                      } : current);
                    }}
                    rows={2}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-neutral-800/80 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50"
                    placeholder="Scene summary"
                  />

                  {!beat.isEnding && (
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {beat.options.map((option) => (
                        <div key={option.id} className="rounded-2xl border border-white/10 bg-neutral-900/70 p-3">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-neutral-100">{option.label}</p>
                            {option.isCanonical && (
                              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-300">
                                Original path
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-neutral-500">{option.intent}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => void handleGeneratePreview()}
                disabled={isGeneratingPreview || isLoading}
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-neutral-200 hover:bg-white/10 disabled:opacity-50"
              >
                Regenerate Preview
              </button>
              <button
                type="button"
                onClick={() => void startConfiguredStory(seedPreview)}
                disabled={isLoading || isOverAuthoringWordCap}
                className="rounded-2xl bg-white px-5 py-3 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
              >
                Start Story
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Public Storylines Gallery — hidden for now */}
      <div id="gallery-section" className="hidden">
        <Gallery />
      </div>
    </div>
  );
}
