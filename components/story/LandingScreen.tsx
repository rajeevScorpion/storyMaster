'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getStoryboardSettings } from '@/app/actions/admin';
import { useStoryStore } from '@/lib/store/story-store';
import { AgeGroup, StoryConfig, StoryLanguage, VisualSettings } from '@/lib/types/story';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AdvancedOptions from './AdvancedOptions';
import Gallery from './Gallery';
import PromptCarousel from './PromptCarousel';
import { DEFAULT_STORY_CONFIG, normalizeStoryConfig } from '@/lib/ai/story-config';

interface LandingScreenProps {
  onBegin?: (prompt: string, config?: StoryConfig) => void;
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
  const [preludeText, setPreludeText] = useState(DEFAULT_STORY_CONFIG.authoring.preludeText || '');
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
      .then(({ freePlusCharacterSheetsEnabled, creatorCharacterSheetsEnabled }) => {
        setSetupSettings({
          freePlusCharacterSheetsEnabled,
          creatorCharacterSheetsEnabled,
        });
      })
      .catch(() => {
        setSetupSettings({
          freePlusCharacterSheetsEnabled: false,
          creatorCharacterSheetsEnabled: false,
        });
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
            setPreludeText(config.authoring.preludeText || '');
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && !isLoading) {
      const portraitReferences = showCreatorSettings
        ? {
            mode: 'character_sheet' as const,
            quality: useCreatorOneKCharacterSheet ? '1K' as const : '0.5K' as const,
          }
        : (!isCreatorPlan && setupSettings.freePlusCharacterSheetsEnabled)
        ? {
            mode: 'character_sheet' as const,
            quality: '0.5K' as const,
          }
        : {
            mode: 'single_portrait' as const,
            quality: '0.5K' as const,
          };

      const config: StoryConfig = {
        language,
        ageGroup,
        settingCountry: settingCountry === 'custom' ? customSetting || 'generic' : settingCountry,
        maxBeats: effectiveMaxBeats,
        visualSettings,
        authoring: {
          mode: authoringMode,
          preludeText: preludeText.trim(),
        },
        portraitReferences,
      };
      if (onBegin) {
        onBegin(prompt.trim(), config);
      } else {
        startStory(prompt.trim(), config);
      }
    }
  };

  return (
    <div className="bg-neutral-950 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-32 bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-transparent sm:h-40 md:h-48"
      />
      {/* Hero section — full viewport height */}
      <div className="h-screen flex flex-col items-center justify-center p-4 relative">
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
            <div className="mx-auto max-w-xl">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-indigo-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
                <div className="relative flex items-center bg-neutral-900 border border-white/10 rounded-2xl p-2 shadow-2xl">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={authoringMode === 'seed_continue'
                      ? 'Tell Kissago what should happen next in your story...'
                      : 'Tell me a story of a monkey and an elephant...'}
                    className="w-full bg-transparent text-white placeholder-neutral-500 px-4 py-3 outline-none font-sans text-lg"
                    disabled={isLoading}
                  />
                  <button
                    type="submit"
                    disabled={!prompt.trim() || isLoading}
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
              </div>

            </div>

            {(pricing.controls.pricingHardEnforcementEnabled || pricing.controls.pricingCheckoutEnabled) && (
              <p className="mt-3 text-center text-xs font-sans text-neutral-500">
                Starting a new story uses {startStoryCoinCost.toLocaleString()} coins when payment controls are active.
              </p>
            )}
          </form>

        </motion.div>

        {/* Floating prompt suggestions carousel */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="z-10 w-full max-w-3xl mx-auto mt-8"
        >
          <PromptCarousel onSelect={setPrompt} />
        </motion.div>

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
                onLanguageChange={setLanguage}
                ageGroup={ageGroup}
                onAgeGroupChange={setAgeGroup}
                settingCountry={settingCountry}
                onSettingCountryChange={setSettingCountry}
                customSetting={customSetting}
                onCustomSettingChange={setCustomSetting}
                maxBeats={effectiveMaxBeats}
                onMaxBeatsChange={(value) => setMaxBeats(storyLengthUiEnabled ? Math.min(value, storyLengthCap) : value)}
                visualSettings={visualSettings}
                onVisualSettingsChange={setVisualSettings}
                authoringMode={authoringMode}
                onAuthoringModeChange={setAuthoringMode}
                preludeText={preludeText}
                onPreludeTextChange={setPreludeText}
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
              onClick={() => document.getElementById('gallery-section')?.scrollIntoView({ behavior: 'smooth' })}
            >
              <span className="text-sm text-neutral-500 font-sans">Scroll to discover stories</span>
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

      {/* Public Storylines Gallery — below the fold */}
      <div id="gallery-section">
        <Gallery />
      </div>
    </div>
  );
}
