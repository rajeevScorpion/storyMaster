'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getStoryboardSettings, getStoryModelOverrides } from '@/app/actions/admin';
import { generateSeedPlanPreview } from '@/app/actions/story-runtime';
import {
  authorizeCurrentUserBillableAction,
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from '@/app/actions/pricing-enforcement';
import { useStoryStore } from '@/lib/store/story-store';
import { AgeGroup, SeedPlan, StoryConfig, StoryLanguage, VisualSettings, SourceFidelity } from '@/lib/types/story';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { Sparkles, ChevronDown, ChevronUp, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AdvancedOptions from './AdvancedOptions';
import Gallery from './Gallery';
import PromptCarousel from './PromptCarousel';
import { DEFAULT_STORY_CONFIG, normalizeStoryConfig } from '@/lib/ai/story-config';

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

export default function LandingScreen({ onBegin }: LandingScreenProps) {
  const router = useRouter();
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
  });
  const storyLengthUiEnabled = pricing.controls.pricingStoryLengthUiLimitsEnabled;
  const storyLengthCap = storyLengthUiEnabled ? Math.max(3, pricing.snapshot.storyLengthCap) : 8;
  const effectiveMaxBeats = storyLengthUiEnabled ? Math.min(maxBeats, storyLengthCap) : maxBeats;
  const startStoryCoinCost = (pricing.actionCosts.start_story_initial_beat ?? 1) * 10;
  const isCreatorPlan = pricing.snapshot.creatorControls;
  const showCreatorSettings = isCreatorPlan && setupSettings.creatorCharacterSheetsEnabled;

  useEffect(() => {
    getStoryboardSettings()
      .then(({ freePlusCharacterSheetsEnabled, creatorCharacterSheetsEnabled, authoringWordCap: nextAuthoringWordCap }) => {
        setSetupSettings({
          freePlusCharacterSheetsEnabled,
          creatorCharacterSheetsEnabled,
        });
        setAuthoringWordCap(nextAuthoringWordCap);
      })
      .catch(() => {
        setSetupSettings({
          freePlusCharacterSheetsEnabled: false,
          creatorCharacterSheetsEnabled: false,
        });
        setAuthoringWordCap(500);
      });
  }, []);

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
            setLanguage(config.language);
            setAgeGroup(config.ageGroup);
            const isPresetSetting = ['generic', 'India', 'Japan', 'USA', 'Medieval Europe', 'Fantasy Land', 'Space', 'Underwater'].includes(config.settingCountry);
            setSettingCountry(isPresetSetting ? config.settingCountry : 'custom');
            setCustomSetting(isPresetSetting ? '' : config.settingCountry);
            setMaxBeats(config.maxBeats);
            setVisualSettings(config.visualSettings);
            setAuthoringMode(config.authoring.mode);
            setWorkingTitle(config.authoring.workingTitle || '');
            setSourceText(config.authoring.sourceText || '');
            setGuidanceText(config.authoring.guidanceText || '');
            setSourceFidelity(config.authoring.sourceFidelity || 'balanced_adaptation');
            setSeedPreview(config.authoring.seedPlan || null);
            setUseCreatorOneKCharacterSheet(
              config.portraitReferences.mode === 'character_sheet' &&
              config.portraitReferences.quality === '1K'
            );
          } catch { /* ignore parse errors */ }
          sessionStorage.removeItem('kissago_pending_config');
        }
      });
    }
  }, []);

  const previewSeedPlanCoinCost = (pricing.actionCosts.preview_seed_plan ?? 0) * 10;
  const authoringWordCount = countWords(
    authoringMode === 'seeded'
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

  const buildStoryConfig = (seedPlan?: SeedPlan): StoryConfig => ({
    language,
    ageGroup,
    settingCountry: settingCountry === 'custom' ? customSetting || 'generic' : settingCountry,
    maxBeats: effectiveMaxBeats,
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
    portraitReferences: buildPortraitReferences(),
  });

  const startConfiguredStory = async (seedPlan?: SeedPlan) => {
    const config = buildStoryConfig(seedPlan);
    const storyPrompt = authoringMode === 'seeded' ? sourceText.trim() : prompt.trim();
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
      const nextPreview = await generateSeedPlanPreview({
        storyConfig: buildStoryConfig(),
        sourceText: sourceText.trim(),
        beatCount: effectiveMaxBeats,
        workingTitle: workingTitle.trim(),
        guidanceText: guidanceText.trim(),
        sourceFidelity,
        modelOverrides,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (authoringMode === 'seeded') {
      if (!seedPreview) {
        await handleGeneratePreview();
        return;
      }

      if (!isOverAuthoringWordCap && !isLoading) {
        await startConfiguredStory(seedPreview);
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
                      setAuthoringMode('prompt');
                      clearSeedPreview();
                    }}
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                      authoringMode === 'prompt'
                        ? 'bg-white text-black'
                        : 'text-neutral-300 hover:text-white'
                    }`}
                  >
                    Prompt Story
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthoringMode('seeded');
                      clearSeedPreview();
                    }}
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                      authoringMode === 'seeded'
                        ? 'bg-white text-black'
                        : 'text-neutral-300 hover:text-white'
                    }`}
                  >
                    Seed From Story
                  </button>
                </div>
              </div>

              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-indigo-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
                <div className="relative rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl">
                  {authoringMode === 'prompt' ? (
                    <div className="flex items-center p-2">
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
                  {authoringMode === 'seeded'
                    ? `Source text and extra guidance share a ${authoringWordCap}-word limit.`
                    : `Prompt text shares the ${authoringWordCap}-word authoring limit.`}
                </p>
                {(pricing.controls.pricingHardEnforcementEnabled || pricing.controls.pricingCheckoutEnabled || previewSeedPlanCoinCost > 0) && (
                  <p className="text-xs font-sans text-neutral-500">
                    {authoringMode === 'seeded'
                      ? `${previewSeedPlanCoinCost > 0 ? `Preview uses ${previewSeedPlanCoinCost.toLocaleString()} coins. ` : 'Preview is free. '}Starting the story uses ${startStoryCoinCost.toLocaleString()} coins when payment controls are active.`
                      : `Starting a new story uses ${startStoryCoinCost.toLocaleString()} coins when payment controls are active.`}
                  </p>
                )}
              </div>
            </div>
          </form>

        </motion.div>

        {/* Floating prompt suggestions carousel */}
        {authoringMode === 'prompt' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.6 }}
            className="z-10 w-full max-w-3xl mx-auto mt-8"
          >
            <PromptCarousel onSelect={setPrompt} />
          </motion.div>
        )}

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
                isSeedMode={authoringMode === 'seeded'}
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
              />
            )}
          </AnimatePresence>
        </div>

        {/* Scroll to discover indicator — pinned to bottom of viewport */}
        <AnimatePresence>
          {!showAdvanced && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 cursor-pointer"
              onClick={() => document.getElementById(authoringMode === 'seeded' && seedPreview ? 'seed-preview-section' : 'gallery-section')?.scrollIntoView({ behavior: 'smooth' })}
            >
              <span className="text-sm text-neutral-500 font-sans">
                {authoringMode === 'seeded' && seedPreview ? 'Scroll to review your beat preview' : 'Scroll to discover stories'}
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

      {authoringMode === 'seeded' && seedPreview && (
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

      {/* Public Storylines Gallery — below the fold */}
      <div id="gallery-section">
        <Gallery />
      </div>
    </div>
  );
}
