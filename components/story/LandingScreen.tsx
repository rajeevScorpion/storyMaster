'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getReelStorySetupSettings, getStoryboardSettings, getStoryModelOverrides } from '@/app/actions/admin';
import { listReelVisualStyleCardsAction } from '@/app/actions/reel-styles';
import { listPublishedReelMoodsAction } from '@/app/actions/reel-moods';
import type { ReelMoodRecord } from '@/lib/reel/moods';
import { getNarrationVoiceSelectionConfig } from '@/app/actions/narration';
import {
  listNarrationPresetsAction,
  previewReelNarrationAction,
  saveNarrationSettingsAsPresetAction,
} from '@/app/actions/reel-narration';
import { generateSeedPlanPreview, distributeReelTextAction } from '@/app/actions/story-runtime';
import {
  authorizeCurrentUserBillableAction,
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from '@/app/actions/pricing-enforcement';
import { useStoryStore } from '@/lib/store/story-store';
import { AgeGroup, SeedPlan, StoryConfig, StoryLanguage, VisualSettings, SourceFidelity } from '@/lib/types/story';
import {
  DEFAULT_REEL_STORY_SETTINGS,
  getReelLegacyLengthForBeatCount,
  getReelTextLengthRange,
  normalizeReelStorySettings,
  type ReelStorySetupSettings,
  type ReelTextLengthKey,
} from '@/lib/reel/settings';
import {
  applyPresetToNarrationSettings,
  normalizeReelNarrationSettings,
  storyLanguageToNarrationLanguage,
  type NarrationPreset,
  type ReelNarrationAdminSettings,
  type ReelNarrationSettings,
} from '@/lib/reel/narration';
import type { ReelVisualStyleCard } from '@/lib/reel/styles';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { Lock, Sparkles, ChevronDown, ChevronUp, RefreshCcw, Play, Save, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AdvancedOptions from './AdvancedOptions';
import Gallery from './Gallery';
import PromptCarousel from './PromptCarousel';
import { DEFAULT_STORY_CONFIG, normalizeStoryConfig } from '@/lib/ai/story-config';
import type {
  NarrationGenderBucket,
  NarrationVoiceClientConfig,
} from '@/lib/ai/narration-voices';

interface LandingScreenProps {
  onBegin?: (prompt: string, config?: StoryConfig) => void;
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
const FALLBACK_REEL_SETUP: ReelStorySetupSettings = {
  enabled: false,
  publishEnabled: false,
  settings: DEFAULT_REEL_STORY_SETTINGS,
};

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
      settings: normalizeReelStorySettings(parsed.setup.settings ?? DEFAULT_REEL_STORY_SETTINGS),
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

export default function LandingScreen({ onBegin }: LandingScreenProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState('');
  const startStory = useStoryStore((state) => state.startStory);
  const isLoading = useStoryStore((state) => state.isLoading);
  const { data: pricing } = usePricingRuntime();

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
  const [authoringWordCap, setAuthoringWordCap] = useState(500);
  const [useCreatorOneKCharacterSheet, setUseCreatorOneKCharacterSheet] = useState(false);
  const [setupSettings, setSetupSettings] = useState({
    freePlusCharacterSheetsEnabled: false,
    creatorCharacterSheetsEnabled: false,
    storyPromptOnlyModeEnabled: false,
    verticalStoriesSettingEnabled: false,
  });
  const [reelSetup, setReelSetup] = useState<ReelStorySetupSettings>(FALLBACK_REEL_SETUP);
  const [reelBeatCount, setReelBeatCount] = useState<1 | 2 | 3>(reelSetup.settings.defaultBeatCount);
  const [reelTextLength, setReelTextLength] = useState<ReelTextLengthKey>(reelSetup.settings.defaultTextLength);
  const [reelTextOverlayEnabled, setReelTextOverlayEnabled] = useState(reelSetup.settings.textOverlayDefault);
  const [reelMoodKey, setReelMoodKey] = useState(reelSetup.settings.defaultMood);
  const [reelVisualStyleKey, setReelVisualStyleKey] = useState(reelSetup.settings.defaultVisualStyle);
  const [reelVisualStyleId, setReelVisualStyleId] = useState<string | null>(null);
  const [reelVisualStyleCards, setReelVisualStyleCards] = useState<ReelVisualStyleCard[]>([]);
  const [publishedMoods, setPublishedMoods] = useState<ReelMoodRecord[]>([]);
  const [reelNarrationStyleKey, setReelNarrationStyleKey] = useState(reelSetup.settings.defaultNarrationStyle);
  const [reelInputMode, setReelInputMode] = useState<'prompt' | 'text'>('prompt');
  const [reelUserText, setReelUserText] = useState('');
  const [reelDistributedTexts, setReelDistributedTexts] = useState<string[][] | null>(null);
  const [reelDistributedImagePrompts, setReelDistributedImagePrompts] = useState<string[] | null>(null);
  const [narrationPresets, setNarrationPresets] = useState<NarrationPreset[]>([]);
  const [reelNarrationAdminSettings, setReelNarrationAdminSettings] = useState<ReelNarrationAdminSettings>(reelSetup.settings.narration);
  const [reelNarrationSettings, setReelNarrationSettings] = useState<ReelNarrationSettings>(() =>
    normalizeReelNarrationSettings(null, {
      storyLanguage: language,
      adminSettings: reelSetup.settings.narration,
    })
  );
  const [isPreviewingNarration, setIsPreviewingNarration] = useState(false);
  const [narrationPreviewError, setNarrationPreviewError] = useState<string | null>(null);
  const [narrationPresetMessage, setNarrationPresetMessage] = useState<string | null>(null);
  const [isDistributing, setIsDistributing] = useState(false);
  const [distributeError, setDistributeError] = useState<string | null>(null);
  const [isVerticalStory, setIsVerticalStory] = useState(false);
  const [imageGenerationMode, setImageGenerationMode] = useState<StoryConfig['imageGenerationMode']>(
    DEFAULT_STORY_CONFIG.imageGenerationMode
  );
  const [narrationVoiceConfig, setNarrationVoiceConfig] = useState<NarrationVoiceClientConfig | null>(null);
  const [narrationVoiceSelection, setNarrationVoiceSelection] = useState<{
    genderBucket: NarrationGenderBucket;
    voiceId: string;
  }>({
    genderBucket: 'female',
    voiceId: '',
  });
  const storyLengthUiEnabled = pricing.controls.pricingStoryLengthUiLimitsEnabled;
  const storyLengthCap = storyLengthUiEnabled ? Math.max(3, pricing.snapshot.storyLengthCap) : 8;
  const isReelMode = creationMode === 'reel';
  const reelMaxBeats = reelBeatCount;
  const effectiveMaxBeats = isReelMode ? reelMaxBeats : storyLengthUiEnabled ? Math.min(maxBeats, storyLengthCap) : maxBeats;
  const startStoryCoinCost = (
    isReelMode
      ? pricing.actionCosts[
          imageGenerationMode === 'prompt_only'
            ? 'start_reel_full_generation_prompt_only'
            : 'start_reel_full_generation'
        ] ?? (imageGenerationMode === 'prompt_only' ? 1.5 : 3)
      : pricing.actionCosts[
          imageGenerationMode === 'prompt_only'
            ? 'start_story_initial_beat_prompt_only'
            : 'start_story_initial_beat'
        ] ?? (imageGenerationMode === 'prompt_only' ? 0.5 : 1)
  ) * 10;
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
        setSetupSettings({
          freePlusCharacterSheetsEnabled: false,
          creatorCharacterSheetsEnabled: false,
          storyPromptOnlyModeEnabled: false,
          verticalStoriesSettingEnabled: false,
        });
        setIsVerticalStory(false);
        setAuthoringWordCap(500);
      });
  }, []);

  useEffect(() => {
    const cached = readCachedReelSetup();
    if (cached) {
      setReelSetup(cached);
    }
  }, []);

  useEffect(() => {
    getReelStorySetupSettings()
      .then((setup) => {
        writeCachedReelSetup(setup);
        setReelSetup(setup);
        setReelNarrationAdminSettings(setup.settings.narration);
        setReelBeatCount(setup.settings.defaultBeatCount);
        setReelTextLength(setup.settings.defaultTextLength);
        setReelTextOverlayEnabled(setup.settings.textOverlayDefault);
        setReelMoodKey(setup.settings.defaultMood);
        setReelVisualStyleKey(setup.settings.defaultVisualStyle);
        setReelNarrationStyleKey(setup.settings.defaultNarrationStyle);
        setReelNarrationSettings((current) => normalizeReelNarrationSettings(current, {
          adminSettings: setup.settings.narration,
        }));
      })
      .catch(() => {
        setReelSetup((current) => current ?? FALLBACK_REEL_SETUP);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    listNarrationPresetsAction()
      .then(({ presets, adminSettings }) => {
        if (cancelled) return;
        setNarrationPresets(presets);
        setReelNarrationAdminSettings(adminSettings);
        setReelNarrationSettings((current) => {
          const normalized = normalizeReelNarrationSettings(current, {
            storyLanguage: language,
            adminSettings,
          });
          const preferredDefault = presets.find((preset) => preset.presetScope === 'user' && preset.isDefault)
            ?? presets.find((preset) => preset.id === adminSettings.defaultPresetId);
          const canApplyPreferredDefault = !current.presetId || current.presetId === adminSettings.defaultPresetId;
          return preferredDefault && canApplyPreferredDefault
            ? applyPresetToNarrationSettings(normalized, preferredDefault, adminSettings)
            : normalized;
        });
      })
      .catch(() => {
        if (!cancelled) setNarrationPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    setReelNarrationSettings((current) => normalizeReelNarrationSettings({
      ...current,
      language: storyLanguageToNarrationLanguage(language),
      languageSource: 'reel_language',
    }, {
      storyLanguage: language,
      adminSettings: reelNarrationAdminSettings,
    }));
  }, [language, reelNarrationAdminSettings]);

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
    getNarrationVoiceSelectionConfig(language)
      .then((config) => {
        if (cancelled) return;
        setNarrationVoiceConfig(config);
        if (!config.enabled) return;
        setNarrationVoiceSelection((current) => {
          const list = current.genderBucket === 'male' ? config.maleVoiceList : config.femaleVoiceList;
          const configuredDefault = current.genderBucket === 'male' ? config.defaultMaleVoice : config.defaultFemaleVoice;
          if (current.voiceId && list.includes(current.voiceId)) {
            return current;
          }
          return {
            genderBucket: current.genderBucket,
            voiceId: list.includes(configuredDefault) ? configuredDefault : list[0] || '',
          };
        });
      })
      .catch(() => {
        if (!cancelled) setNarrationVoiceConfig(null);
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
            setAgeGroup(config.ageGroup);
            const isPresetSetting = ['generic', 'India', 'Japan', 'USA', 'Medieval Europe', 'Fantasy Land', 'Space', 'Underwater'].includes(config.settingCountry);
            setSettingCountry(isPresetSetting ? config.settingCountry : 'custom');
            setCustomSetting(isPresetSetting ? '' : config.settingCountry);
            setMaxBeats(config.maxBeats);
            setVisualSettings(config.visualSettings);
            setAuthoringMode(config.authoring.mode);
            setReelBeatCount(config.reel.beatCount);
            setReelTextLength(config.reel.textLength);
            setReelTextOverlayEnabled(config.reel.textOverlayEnabled);
            setReelMoodKey(config.reel.moodKey);
            setReelVisualStyleKey(config.reel.visualStyleKey);
            setReelVisualStyleId(config.reel.visualStyleId || null);
            setReelNarrationStyleKey(config.reel.narrationStyleKey);
            setReelNarrationSettings(config.reel.narrationSettings);
            setWorkingTitle(config.authoring.workingTitle || '');
            setSourceText(config.authoring.sourceText || '');
            setGuidanceText(config.authoring.guidanceText || '');
            setSourceFidelity(config.authoring.sourceFidelity || 'balanced_adaptation');
            setSeedPreview(config.authoring.seedPlan || null);
            setImageGenerationMode(config.imageGenerationMode || 'generate');
            setIsVerticalStory(config.isVerticalStory || config.aspectRatio === '9:16');
            setUseCreatorOneKCharacterSheet(
              config.portraitReferences.mode === 'character_sheet' &&
              config.portraitReferences.quality === '1K'
            );
            if (config.narrationVoice?.mode === 'user_selected') {
              setNarrationVoiceSelection({
                genderBucket: config.narrationVoice.genderBucket || 'female',
                voiceId: config.narrationVoice.voiceId || '',
              });
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
      return {
        storyKind: 'reel',
        language,
        ageGroup,
        settingCountry: 'generic',
        maxBeats: reelBeatCount,
        imageGenerationMode,
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
          textOverlayEnabled: reelTextOverlayEnabled,
          visualStyleId: selectedStyle?.id ?? reelVisualStyleId,
          textOverlayStyle: selectedStyle?.textOverlayStyle,
          moodKey: reelMoodKey,
          visualStyleKey: selectedStyle?.slug ?? reelVisualStyleKey,
          narrationStyleKey: reelNarrationStyleKey,
          narrationSettings: normalizeReelNarrationSettings({
            ...reelNarrationSettings,
            language: storyLanguageToNarrationLanguage(language),
            languageSource: 'reel_language',
          }, {
            storyLanguage: language,
            adminSettings: reelNarrationAdminSettings,
          }),
          brandingEnabled: true,
        },
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
            }
          : {
              mode: 'legacy_auto',
            },
      };
    }

    const verticalStoryEnabled = setupSettings.verticalStoriesSettingEnabled && isVerticalStory;
    return {
      storyKind: 'story',
      language,
      ageGroup,
      settingCountry: settingCountry === 'custom' ? customSetting || 'generic' : settingCountry,
      maxBeats: effectiveMaxBeats,
      imageGenerationMode,
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
          }
        : {
            mode: 'legacy_auto',
          },
    };
  };

  const startConfiguredStory = async (seedPlan?: SeedPlan) => {
    const voiceConfig = narrationVoiceConfig || await getNarrationVoiceSelectionConfig(language).catch(() => null);
    const config = buildStoryConfig(seedPlan, voiceConfig);
    const storyPrompt = creationMode === 'seeded'
      ? sourceText.trim()
      : (isReelMode && reelInputMode === 'text')
        ? reelUserText.trim()
        : prompt.trim();
    if (!storyPrompt) return;

    if (onBegin) {
      onBegin(storyPrompt, config);
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

  const handleReelNarrationPresetChange = (presetId: string) => {
    const preset = narrationPresets.find((item) => item.id === presetId);
    if (!preset) {
      setReelNarrationSettings((current) => normalizeReelNarrationSettings({
        ...current,
        presetId: null,
      }, {
        storyLanguage: language,
        adminSettings: reelNarrationAdminSettings,
      }));
      return;
    }
    setReelNarrationSettings((current) => applyPresetToNarrationSettings(current, preset, reelNarrationAdminSettings));
  };

  const handlePreviewReelNarration = async () => {
    if (isPreviewingNarration) return;
    setIsPreviewingNarration(true);
    setNarrationPreviewError(null);
    setNarrationPresetMessage(null);
    try {
      const text = (reelInputMode === 'text' ? reelUserText : prompt).trim()
        || 'Every quiet moment has a story waiting inside it.';
      const result = await previewReelNarrationAction({
        text,
        settings: reelNarrationSettings,
        storyLanguage: language,
      });
      setReelNarrationSettings(result.settings);
      const audio = new Audio(result.audioUrl);
      await audio.play();
    } catch (error) {
      setNarrationPreviewError(error instanceof Error ? error.message : 'Failed to preview narration.');
    } finally {
      setIsPreviewingNarration(false);
    }
  };

  const handleSaveReelNarrationPreset = async () => {
    setNarrationPresetMessage(null);
    setNarrationPreviewError(null);
    const name = window.prompt('Preset name', 'My Kissago Voice');
    if (!name?.trim()) return;
    try {
      const created = await saveNarrationSettingsAsPresetAction({
        settings: reelNarrationSettings,
        name: name.trim(),
      });
      setNarrationPresets((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setReelNarrationSettings((current) => normalizeReelNarrationSettings({
        ...current,
        presetId: created.id,
      }, {
        storyLanguage: language,
        adminSettings: reelNarrationAdminSettings,
      }));
      setNarrationPresetMessage('Preset saved.');
    } catch (error) {
      setNarrationPreviewError(error instanceof Error ? error.message : 'Failed to save preset.');
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
    <div className="bg-neutral-950 relative overflow-hidden">
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
                    Prompt Story
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
                    Seed From Story
                  </button>
                  {reelSetup.enabled && (
                    <button
                      type="button"
                      onClick={() => {
                      setCreationMode('reel');
                      setAuthoringMode('prompt');
                      setImageGenerationMode('generate');
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
                      Reel Story
                    </button>
                  )}
                </div>
              </div>

              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-indigo-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
                <div className="relative rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl">
                  {creationMode !== 'seeded' ? (
                    <div className="space-y-3 p-2">
                      {!(isReelMode && reelInputMode === 'text') && (
                        <div className="flex items-center">
                          <input
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={isReelMode ? 'Make a short reel about a moonlit mango market...' : 'Tell me a story of a monkey and an elephant...'}
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
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => { setReelInputMode('prompt'); setReelDistributedTexts(null); setReelDistributedImagePrompts(null); setDistributeError(null); }}
                              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${reelInputMode === 'prompt' ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}`}
                            >
                              Prompt
                            </button>
                            <button
                              type="button"
                              onClick={() => setReelInputMode('text')}
                              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${reelInputMode === 'text' ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}`}
                            >
                              Text
                            </button>
                          </div>

                          {reelInputMode === 'text' && (
                            <div className="space-y-2">
                              <div className="relative">
                                <textarea
                                  value={reelUserText}
                                  onChange={(e) => {
                                    setReelUserText(e.target.value);
                                    setReelDistributedTexts(null);
                                    setReelDistributedImagePrompts(null);
                                  }}
                                  placeholder="Write your full reel story here. AI will split it across panels and derive image prompts."
                                  rows={4}
                                  maxLength={800}
                                  className="w-full rounded-xl border border-white/10 bg-neutral-800/60 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50 resize-none"
                                  disabled={isLoading || isDistributing}
                                />
                                <span className={`absolute bottom-2 right-3 text-[11px] ${reelUserText.length > 800 ? 'text-rose-400' : 'text-neutral-500'}`}>
                                  {reelUserText.length} / 800
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                {distributeError && <p className="text-xs text-rose-400">{distributeError}</p>}
                                <div className="ml-auto">
                                  <button
                                    type="button"
                                    onClick={() => void handleDistributeReelText()}
                                    disabled={!reelUserText.trim() || reelUserText.length > 800 || isDistributing || isLoading}
                                    className="flex items-center gap-2 rounded-xl bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isDistributing ? (
                                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    ) : (
                                      <Sparkles className="h-4 w-4" />
                                    )}
                                    Preview layout
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="grid gap-2 md:grid-cols-5">
                            <div className="space-y-1">
                              <label className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Beats</label>
                              <select value={reelBeatCount} onChange={(event) => {
                                const next = Number(event.target.value) as 1 | 2 | 3;
                                setReelBeatCount(next);
                              }} className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                                <option value={1}>1 beat</option>
                                <option value={2}>2 beats</option>
                                <option value={3}>3 beats</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Text</label>
                              <select value={reelTextLength} onChange={(event) => setReelTextLength(event.target.value as ReelTextLengthKey)} className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                                <option value="short">Short</option>
                                <option value="medium">Medium</option>
                                <option value="long">Long</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Narration</label>
                              <select value={reelNarrationStyleKey} onChange={(event) => setReelNarrationStyleKey(event.target.value)} className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                                {reelSetup.settings.narrationStyles.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Images</label>
                              <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 bg-neutral-800 text-xs">
                                <button
                                  type="button"
                                  onClick={() => setImageGenerationMode('generate')}
                                  className={`px-2 py-2 transition-colors ${
                                    imageGenerationMode === 'generate'
                                      ? 'bg-emerald-500/25 text-white'
                                      : 'text-neutral-400 hover:bg-neutral-700/60'
                                  }`}
                                  aria-pressed={imageGenerationMode === 'generate'}
                                  title="Kissago generates the reel images for you (uses more coins)."
                                >
                                  AI
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setImageGenerationMode('prompt_only')}
                                  className={`px-2 py-2 transition-colors ${
                                    imageGenerationMode === 'prompt_only'
                                      ? 'bg-emerald-500/25 text-white'
                                      : 'text-neutral-400 hover:bg-neutral-700/60'
                                  }`}
                                  aria-pressed={imageGenerationMode === 'prompt_only'}
                                  title="Kissago returns image prompts; you generate the images elsewhere and upload them. Cheaper."
                                >
                                  BYO
                                </button>
                              </div>
                            </div>
                            <label className="flex min-h-[58px] items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
                              <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Text On</span>
                              <input
                                type="checkbox"
                                checked={reelTextOverlayEnabled}
                                onChange={(event) => setReelTextOverlayEnabled(event.target.checked)}
                                className="h-4 w-4 accent-emerald-500"
                              />
                            </label>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-neutral-800/70 p-3">
                            <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                              <Volume2 className="h-4 w-4 text-emerald-300" />
                              Voice
                            </div>
                            <div className="grid gap-2 md:grid-cols-3">
                              <div className="space-y-1">
                                <label className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Language</label>
                                <select
                                  value={language}
                                  onChange={(event) => {
                                    setLanguage(event.target.value as StoryLanguage);
                                    clearSeedPreview();
                                  }}
                                  className="w-full rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
                                >
                                  <option value="english">English</option>
                                  <option value="hindi">Hindi</option>
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Voice</label>
                                <select
                                  value={reelNarrationSettings.voiceId}
                                  onChange={(event) => setReelNarrationSettings((current) => normalizeReelNarrationSettings({
                                    ...current,
                                    voiceId: event.target.value,
                                  }, {
                                    storyLanguage: language,
                                    adminSettings: reelNarrationAdminSettings,
                                  }))}
                                  className="w-full rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
                                >
                                  {reelNarrationAdminSettings.allowedElevenLabsVoices.map((voice) => (
                                    <option key={voice.voiceId} value={voice.voiceId}>{voice.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Preset</label>
                                <select
                                  value={reelNarrationSettings.presetId || ''}
                                  onChange={(event) => handleReelNarrationPresetChange(event.target.value)}
                                  className="w-full rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
                                >
                                  <option value="">Custom</option>
                                  {narrationPresets.map((preset) => (
                                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                              <label className="space-y-1">
                                <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                  <span>Speed</span>
                                  <span>{reelNarrationSettings.speed.toFixed(2)}x</span>
                                </span>
                                <input
                                  type="range"
                                  min={0.7}
                                  max={1.2}
                                  step={0.01}
                                  value={reelNarrationSettings.speed}
                                  onChange={(event) => setReelNarrationSettings((current) => normalizeReelNarrationSettings({
                                    ...current,
                                    speed: Number(event.target.value),
                                  }, {
                                    storyLanguage: language,
                                    adminSettings: reelNarrationAdminSettings,
                                  }))}
                                  className="w-full accent-emerald-500"
                                />
                              </label>
                              <label className="space-y-1">
                                <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                  <span>Emotion</span>
                                  <span>{Math.round(reelNarrationSettings.emotionalIntensity * 100)}%</span>
                                </span>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  value={reelNarrationSettings.emotionalIntensity}
                                  onChange={(event) => setReelNarrationSettings((current) => normalizeReelNarrationSettings({
                                    ...current,
                                    emotionalIntensity: Number(event.target.value),
                                  }, {
                                    storyLanguage: language,
                                    adminSettings: reelNarrationAdminSettings,
                                  }))}
                                  className="w-full accent-emerald-500"
                                />
                              </label>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handlePreviewReelNarration()}
                                  disabled={isPreviewingNarration || isLoading}
                                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-neutral-900 text-neutral-100 transition-colors hover:bg-neutral-700 disabled:cursor-wait disabled:opacity-60"
                                  title="Preview voice"
                                >
                                  <Play className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveReelNarrationPreset()}
                                  disabled={isLoading}
                                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-neutral-900 text-neutral-100 transition-colors hover:bg-neutral-700 disabled:opacity-60"
                                  title="Save as preset"
                                >
                                  <Save className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                            {(narrationPreviewError || narrationPresetMessage) && (
                              <p className={`mt-2 text-xs ${narrationPreviewError ? 'text-rose-300' : 'text-emerald-300'}`}>
                                {narrationPreviewError || narrationPresetMessage}
                              </p>
                            )}
                          </div>

                          {/* Mood pill selector */}
                          {(publishedMoods.length > 0 || reelSetup.settings.moods.length > 0) && (
                            <div className="space-y-1.5">
                              <label className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Mood</label>
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
                                        : 'border-white/10 bg-neutral-800 text-neutral-400 hover:text-white'
                                    }`}
                                  >
                                    {item.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

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
                                      : 'border-white/10 bg-neutral-800 hover:bg-neutral-700/70'
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
                              <div className="rounded-xl border border-white/10 bg-neutral-800 px-3 py-3 text-sm text-neutral-400 md:col-span-3">
                                Reel visual styles will appear here after an admin publishes samples.
                              </div>
                            )}
                          </div>

                          {reelInputMode === 'text' && reelDistributedTexts && (
                            <div className="space-y-3 border-t border-white/10 pt-3">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Panel layout — edit to refine</p>
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
                                  className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isLoading ? (
                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent" />
                                  ) : (
                                    <>
                                      <span>Generate reel</span>
                                      <Sparkles className="h-4 w-4" />
                                    </>
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
                verticalStoriesSettingEnabled={setupSettings.verticalStoriesSettingEnabled}
                isVerticalStory={isVerticalStory}
                onVerticalStoryChange={(value) => {
                  setIsVerticalStory(value);
                  clearSeedPreview();
                }}
                narrationVoiceConfig={narrationVoiceConfig}
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
