'use client';

import { useEffect, useRef, useState } from 'react';
import { AgeGroup, PortraitReferenceQuality, SourceFidelity, StoryLanguage, VisualSettings } from '@/lib/types/story';
import {
  SOURCE_FIDELITY_OPTIONS,
  STORY_DETAIL_OPTIONS,
  STORY_PALETTE_OPTIONS,
  STORY_THEME_OPTIONS,
  VISUAL_PRESET_OPTIONS,
} from '@/lib/ai/story-config';
import { motion } from 'motion/react';
import FilterDropdown, { type FilterDropdownOption } from '@/components/ui/FilterDropdown';
import InfoPopover from '@/components/ui/InfoPopover';
import { Coins, Monitor, Smartphone, Volume2 } from 'lucide-react';
import type {
  NarrationGenderBucket,
  NarrationVoiceClientConfig,
} from '@/lib/ai/narration-voices';

const LANGUAGE_OPTIONS: FilterDropdownOption[] = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi (हिन्दी)' },
];

const AGE_GROUP_OPTIONS: FilterDropdownOption[] = [
  { value: 'all_ages', label: 'All Ages' },
  { value: 'kids_3_5', label: 'Kids 3-5' },
  { value: 'kids_5_8', label: 'Kids 5-8' },
  { value: 'kids_8_12', label: 'Kids 8-12' },
  { value: 'teens', label: 'Teens' },
  { value: 'adults', label: 'Adults' },
];

const SETTING_PRESETS = [
  'generic',
  'India',
  'Japan',
  'USA',
  'Medieval Europe',
  'Fantasy Land',
  'Space',
  'Underwater',
  'custom',
];

const SETTING_OPTIONS: FilterDropdownOption[] = SETTING_PRESETS.map((preset) => ({
  value: preset,
  label:
    preset === 'generic'
      ? 'Any / Generic'
      : preset === 'custom'
      ? 'Custom...'
      : preset,
}));

const VISUAL_PRESET_DROPDOWN_OPTIONS: FilterDropdownOption[] = VISUAL_PRESET_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

const THEME_OPTIONS: FilterDropdownOption[] = STORY_THEME_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

const PALETTE_OPTIONS: FilterDropdownOption[] = STORY_PALETTE_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

const DETAIL_OPTIONS: FilterDropdownOption[] = STORY_DETAIL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

const SOURCE_FIDELITY_DROPDOWN_OPTIONS: FilterDropdownOption[] = SOURCE_FIDELITY_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));


interface AdvancedOptionsProps {
  language: StoryLanguage;
  onLanguageChange: (v: StoryLanguage) => void;
  ageGroup: AgeGroup;
  onAgeGroupChange: (v: AgeGroup) => void;
  settingCountry: string;
  onSettingCountryChange: (v: string) => void;
  customSetting: string;
  onCustomSettingChange: (v: string) => void;
  maxBeats: number;
  onMaxBeatsChange: (v: number) => void;
  visualSettings: VisualSettings;
  onVisualSettingsChange: (v: VisualSettings) => void;
  isSeedMode?: boolean;
  sourceFidelity?: SourceFidelity;
  onSourceFidelityChange?: (value: SourceFidelity) => void;
  authoringWordCap?: number;
  pricingStoryLengthCap?: number;
  pricingStoryLengthUiLimitsEnabled?: boolean;
  currentPlanLabel?: string;
  onViewPlans?: () => void;
  showCreatorSettings?: boolean;
  creatorReferenceQuality?: PortraitReferenceQuality;
  onCreatorReferenceQualityChange?: (value: PortraitReferenceQuality) => void;
  storyPromptOnlyModeEnabled?: boolean;
  imageGenerationMode?: 'generate' | 'prompt_only';
  onImageGenerationModeChange?: (value: 'generate' | 'prompt_only') => void;
  verticalStoriesSettingEnabled?: boolean;
  isVerticalStory?: boolean;
  onVerticalStoryChange?: (value: boolean) => void;
  narrationVoiceConfig?: NarrationVoiceClientConfig | null;
  narrationVoiceSelection?: {
    genderBucket: NarrationGenderBucket;
    voiceId: string;
  };
  onNarrationVoiceSelectionChange?: (value: { genderBucket: NarrationGenderBucket; voiceId: string }) => void;
}

export default function AdvancedOptions({
  language,
  onLanguageChange,
  ageGroup,
  onAgeGroupChange,
  settingCountry,
  onSettingCountryChange,
  customSetting,
  onCustomSettingChange,
  maxBeats,
  onMaxBeatsChange,
  visualSettings,
  onVisualSettingsChange,
  isSeedMode = false,
  sourceFidelity = 'balanced_adaptation',
  onSourceFidelityChange,
  authoringWordCap = 500,
  pricingStoryLengthCap = 8,
  pricingStoryLengthUiLimitsEnabled = false,
  currentPlanLabel = 'free',
  onViewPlans,
  showCreatorSettings = false,
  creatorReferenceQuality = '0.5K',
  onCreatorReferenceQualityChange,
  storyPromptOnlyModeEnabled = false,
  imageGenerationMode = 'generate',
  onImageGenerationModeChange,
  verticalStoriesSettingEnabled = false,
  isVerticalStory = false,
  onVerticalStoryChange,
  narrationVoiceConfig = null,
  narrationVoiceSelection,
  onNarrationVoiceSelectionChange,
}: AdvancedOptionsProps) {
  const [allowOverflow, setAllowOverflow] = useState(false);
  const [playingSampleVoice, setPlayingSampleVoice] = useState<string | null>(null);
  const sampleAudioCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const sliderMax = pricingStoryLengthUiLimitsEnabled ? Math.max(3, pricingStoryLengthCap) : 8;
  const planLabel = `${currentPlanLabel.charAt(0).toUpperCase()}${currentPlanLabel.slice(1)} plan limit`;
  const voiceGender = narrationVoiceSelection?.genderBucket || 'female';
  const voiceList = voiceGender === 'male'
    ? narrationVoiceConfig?.maleVoiceList || []
    : narrationVoiceConfig?.femaleVoiceList || [];
  const selectedVoice = narrationVoiceSelection?.voiceId || (
    voiceGender === 'male'
      ? narrationVoiceConfig?.defaultMaleVoice
      : narrationVoiceConfig?.defaultFemaleVoice
  ) || voiceList[0] || '';
  const voiceDropdownOptions: FilterDropdownOption[] = voiceList.map((voice) => ({ value: voice, label: voice }));
  const storyboardImagesEnabled = imageGenerationMode !== 'prompt_only';
  const orientationLabel = isVerticalStory ? 'Portrait' : 'Landscape';
  const visualPresetDescription = VISUAL_PRESET_OPTIONS.find((option) => option.value === visualSettings.preset)?.description || 'Choose the illustration style Kissago should use for storyboards.';
  const sourceFidelityDescription = SOURCE_FIDELITY_OPTIONS.find((option) => option.value === sourceFidelity)?.description || 'Choose how closely Kissago should preserve the source material.';
  const selectedVoiceSample = narrationVoiceConfig?.samples.find((candidate) => candidate.voiceId === selectedVoice);
  const selectedVoiceSampleReady = selectedVoiceSample?.status === 'ready' && Boolean(selectedVoiceSample.audioUrl);

  const setVisualSetting = <K extends keyof VisualSettings,>(key: K, value: VisualSettings[K]) => {
    onVisualSettingsChange({
      ...visualSettings,
      [key]: value,
    });
  };

  const setNarrationVoiceGender = (genderBucket: NarrationGenderBucket) => {
    if (!narrationVoiceConfig || !onNarrationVoiceSelectionChange) return;
    const nextVoiceList = genderBucket === 'male'
      ? narrationVoiceConfig.maleVoiceList
      : narrationVoiceConfig.femaleVoiceList;
    const defaultVoice = genderBucket === 'male'
      ? narrationVoiceConfig.defaultMaleVoice
      : narrationVoiceConfig.defaultFemaleVoice;
    const nextVoice = nextVoiceList.includes(defaultVoice) ? defaultVoice : nextVoiceList[0] || '';
    onNarrationVoiceSelectionChange({ genderBucket, voiceId: nextVoice });
  };

  const setNarrationVoice = (voiceId: string) => {
    onNarrationVoiceSelectionChange?.({ genderBucket: voiceGender, voiceId });
  };

  useEffect(() => {
    if (!selectedVoiceSampleReady || !selectedVoiceSample?.audioUrl) return;

    const cacheKey = `${selectedVoice}:${selectedVoiceSample.audioUrl}`;
    if (sampleAudioCacheRef.current.has(cacheKey)) return;

    const audio = new Audio(selectedVoiceSample.audioUrl);
    audio.preload = 'auto';
    audio.load();
    sampleAudioCacheRef.current.set(cacheKey, audio);
  }, [selectedVoice, selectedVoiceSample?.audioUrl, selectedVoiceSampleReady]);

  const playSelectedVoiceSample = async () => {
    if (!selectedVoiceSampleReady || !selectedVoiceSample?.audioUrl || !selectedVoice) return;

    const cacheKey = `${selectedVoice}:${selectedVoiceSample.audioUrl}`;
    let audio = sampleAudioCacheRef.current.get(cacheKey);
    if (!audio) {
      audio = new Audio(selectedVoiceSample.audioUrl);
      audio.preload = 'auto';
      sampleAudioCacheRef.current.set(cacheKey, audio);
    }

    setPlayingSampleVoice(selectedVoice);
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = () => setPlayingSampleVoice((current) => current === selectedVoice ? null : current);
      audio.onerror = () => setPlayingSampleVoice((current) => current === selectedVoice ? null : current);
      await audio.play();
    } catch {
      setPlayingSampleVoice((current) => current === selectedVoice ? null : current);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      onAnimationStart={() => setAllowOverflow(false)}
      onAnimationComplete={() => setAllowOverflow(true)}
      className={allowOverflow ? 'overflow-visible' : 'overflow-hidden'}
    >
      <div className="mx-auto mt-6 w-full max-w-4xl rounded-[28px] border border-white/10 bg-neutral-900/60 p-5 backdrop-blur-md md:p-6 lg:p-7">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="space-y-4 text-left">
            <FilterDropdown
              value={language}
              options={LANGUAGE_OPTIONS}
              onChange={(value) => onLanguageChange(value as StoryLanguage)}
              fullWidth
              size="form"
              mode="inline"
              ariaLabel="Story language"
            />

            <FilterDropdown
              value={ageGroup}
              options={AGE_GROUP_OPTIONS}
              onChange={(value) => onAgeGroupChange(value as AgeGroup)}
              fullWidth
              size="form"
              mode="inline"
              ariaLabel="Age group"
            />

            <div className="space-y-2">
              <FilterDropdown
                value={SETTING_PRESETS.includes(settingCountry) ? settingCountry : 'custom'}
                options={SETTING_OPTIONS}
                onChange={(value) => {
                  onSettingCountryChange(value);
                  if (value !== 'custom') onCustomSettingChange('');
                }}
                fullWidth
                size="form"
                mode="inline"
                ariaLabel="Setting or country"
              />
              {settingCountry === 'custom' && (
                <input
                  type="text"
                  value={customSetting}
                  onChange={(e) => onCustomSettingChange(e.target.value)}
                  placeholder="Enter your setting..."
                  aria-label="Custom setting"
                  className="min-h-12 w-full rounded-2xl border border-white/10 bg-neutral-800/80 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50"
                />
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <h4 className="text-sm font-sans text-neutral-200">Story length</h4>
                  <InfoPopover title="Story length" ariaLabel="Show story length details">
                    {pricingStoryLengthUiLimitsEnabled ? (
                      <>
                        <div className="flex items-start gap-3">
                          <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                            <Coins className="h-4 w-4" aria-hidden="true" />
                          </div>
                          <div>
                            <p className="text-neutral-100">{planLabel}</p>
                            <p className="mt-1 text-neutral-400">
                              Your current plan allows up to {sliderMax} beats per story.
                            </p>
                          </div>
                        </div>
                        {sliderMax < 8 && (
                          <p>Upgrade for longer story adventures and more monthly coins.</p>
                        )}
                        {onViewPlans && sliderMax < 8 && (
                          <button
                            type="button"
                            onClick={onViewPlans}
                            className="rounded-2xl border border-white/10 bg-neutral-900/80 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-white/10"
                          >
                            See plans
                          </button>
                        )}
                      </>
                    ) : (
                      <p>Choose the maximum number of beats Kissago can create for this story.</p>
                    )}
                  </InfoPopover>
                </div>
                <p className="text-sm font-sans text-neutral-300">
                  {pricingStoryLengthUiLimitsEnabled && (
                    <span className="mr-2 text-xs text-neutral-500">up to {sliderMax}</span>
                  )}
                  <span className="text-emerald-400">{maxBeats}</span> beats
                </p>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <span className="text-xs text-neutral-500">3</span>
                <input
                  type="range"
                  min={3}
                  max={sliderMax}
                  value={maxBeats}
                  onChange={(e) => onMaxBeatsChange(Number(e.target.value))}
                  aria-label="Story length"
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-500"
                />
                <span className="text-xs text-neutral-500">{sliderMax}</span>
              </div>
            </div>

            {storyPromptOnlyModeEnabled && (
              <div className="rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-sans text-neutral-200">Storyboard images</h4>
                      <InfoPopover title="Storyboard images" ariaLabel="Show storyboard image details">
                        <p>
                          When on, Kissago generates storyboard images automatically for each beat.
                        </p>
                        <p>
                          When off, Kissago creates story text and narration only, keeps exact beat prompts ready for copy, and lets you upload images later.
                        </p>
                      </InfoPopover>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      {storyboardImagesEnabled ? 'On' : 'Off'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onImageGenerationModeChange?.(
                      storyboardImagesEnabled ? 'prompt_only' : 'generate'
                    )}
                    className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                      storyboardImagesEnabled
                        ? 'justify-end border-emerald-400/60 bg-emerald-500/25'
                        : 'justify-start border-white/10 bg-neutral-800'
                    }`}
                    role="switch"
                    aria-checked={storyboardImagesEnabled}
                    aria-label="Generate storyboard images"
                  >
                    <span className="h-5 w-5 rounded-full bg-white shadow-sm transition-transform" />
                  </button>
                </div>
              </div>
            )}

            {verticalStoriesSettingEnabled && (
              <div className="rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-sans text-neutral-200">Orientation</h4>
                      <InfoPopover title="Orientation" ariaLabel="Show orientation details">
                        <p>
                          Landscape keeps the standard 16:9 storyboard composition and playback.
                        </p>
                        <p>
                          Portrait creates a 9:16 mobile-first story suited for shorts-style viewing.
                        </p>
                      </InfoPopover>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">{orientationLabel}</p>
                  </div>
                  <div
                    className="grid h-10 w-24 shrink-0 grid-cols-2 rounded-full border border-white/10 bg-neutral-900/70 p-1"
                    role="group"
                    aria-label="Story orientation"
                  >
                    <button
                      type="button"
                      onClick={() => onVerticalStoryChange?.(false)}
                      className={`inline-flex items-center justify-center rounded-full transition-colors ${
                        !isVerticalStory
                          ? 'bg-white text-black'
                          : 'text-neutral-400 hover:text-neutral-100'
                      }`}
                      aria-pressed={!isVerticalStory}
                      aria-label="Use landscape orientation"
                    >
                      <Monitor className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onVerticalStoryChange?.(true)}
                      className={`inline-flex items-center justify-center rounded-full transition-colors ${
                        isVerticalStory
                          ? 'bg-white text-black'
                          : 'text-neutral-400 hover:text-neutral-100'
                      }`}
                      aria-pressed={isVerticalStory}
                      aria-label="Use portrait orientation"
                    >
                      <Smartphone className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-5 text-left">
            <div className="space-y-2">
              <FilterDropdown
                value={visualSettings.preset}
                options={VISUAL_PRESET_DROPDOWN_OPTIONS}
                onChange={(value) => setVisualSetting('preset', value as VisualSettings['preset'])}
                fullWidth
                size="form"
                mode="inline"
                ariaLabel="Visual preset"
              />
              <p className="text-xs leading-relaxed text-neutral-500">{visualPresetDescription}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <FilterDropdown
                value={visualSettings.theme}
                options={THEME_OPTIONS}
                onChange={(value) => setVisualSetting('theme', value as VisualSettings['theme'])}
                fullWidth
                size="form"
                mode="inline"
                ariaLabel="Theme"
              />

              <FilterDropdown
                value={visualSettings.palette}
                options={PALETTE_OPTIONS}
                onChange={(value) => setVisualSetting('palette', value as VisualSettings['palette'])}
                fullWidth
                size="form"
                mode="inline"
                ariaLabel="Palette"
              />

              <FilterDropdown
                value={visualSettings.detail}
                options={DETAIL_OPTIONS}
                onChange={(value) => setVisualSetting('detail', value as VisualSettings['detail'])}
                fullWidth
                size="form"
                mode="inline"
                ariaLabel="Detail"
              />
            </div>

            {narrationVoiceConfig?.enabled && (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-sans text-neutral-200">Narration Voice</h4>
                      <InfoPopover title="Narration voice" ariaLabel="Show narration voice details">
                        <p>Selected voice will be used for the entire story narration.</p>
                        {narrationVoiceConfig.fallbackToEnglishSample && (
                          <p>English sample preview is being used because this story language does not have a stored sample yet.</p>
                        )}
                      </InfoPopover>
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {(['female', 'male'] as const).map((genderBucket) => (
                    <button
                      key={genderBucket}
                      type="button"
                      onClick={() => setNarrationVoiceGender(genderBucket)}
                      className={`min-h-11 rounded-2xl border px-4 py-2 text-sm transition-colors ${
                        voiceGender === genderBucket
                          ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                          : 'border-white/10 bg-neutral-900/60 text-neutral-300 hover:bg-white/10'
                      }`}
                    >
                      {genderBucket === 'female' ? 'Female' : 'Male'}
                    </button>
                  ))}
                </div>

                {voiceDropdownOptions.length > 0 && (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[minmax(0,18rem)_auto]">
                    <FilterDropdown
                      value={selectedVoice}
                      options={voiceDropdownOptions}
                      onChange={setNarrationVoice}
                      fullWidth
                      size="form"
                      mode="inline"
                      ariaLabel="Choose narration voice"
                    />
                    <button
                      type="button"
                      onClick={() => void playSelectedVoiceSample()}
                      disabled={!selectedVoiceSampleReady || playingSampleVoice === selectedVoice}
                      className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-neutral-900/70 text-neutral-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={selectedVoice ? `Play ${selectedVoice} sample` : 'Play selected voice sample'}
                    >
                      <Volume2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {isSeedMode && (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-sans text-neutral-200">Seed preservation</h4>
                  <InfoPopover title="Seed preservation" ariaLabel="Show seed preservation details">
                    <p>{sourceFidelityDescription}</p>
                    <p>
                      Prompt text, seeded source text, and extra guidance share a {authoringWordCap}-word limit.
                    </p>
                  </InfoPopover>
                </div>
                <FilterDropdown
                  value={sourceFidelity}
                  options={SOURCE_FIDELITY_DROPDOWN_OPTIONS}
                  onChange={(value) => onSourceFidelityChange?.(value as SourceFidelity)}
                  fullWidth
                  size="form"
                  mode="inline"
                  ariaLabel="Seed source fidelity"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreatorSettings && (
        <div className="mx-auto mt-4 w-full max-w-4xl rounded-[28px] border border-white/10 bg-neutral-900/60 p-4 text-left backdrop-blur-md md:p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Creator Settings</p>
              <div className="mt-1 flex items-center gap-2">
                <h3 className="text-sm font-sans text-neutral-200">Character reference quality</h3>
                <InfoPopover title="Character reference quality" ariaLabel="Show character reference details">
                  <p>
                    Studio stories already use character sheets here. Turn this on to ask for a larger 1K sheet with extra turnaround detail.
                  </p>
                  <p>
                    Off keeps the faster 0.5K sheet with a close-up, front view, and 3/4 view. On upgrades the sheet to 1K and adds a back view for stronger consistency.
                  </p>
                </InfoPopover>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {creatorReferenceQuality === '1K' ? '1K sheet' : '0.5K sheet'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onCreatorReferenceQualityChange?.(creatorReferenceQuality === '1K' ? '0.5K' : '1K')}
              className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                creatorReferenceQuality === '1K'
                  ? 'justify-end border-emerald-400/60 bg-emerald-500/25'
                  : 'justify-start border-white/10 bg-neutral-800'
              }`}
              role="switch"
              aria-checked={creatorReferenceQuality === '1K'}
              aria-label="Toggle 1K character sheet references"
            >
              <span className="h-5 w-5 rounded-full bg-white shadow-sm transition-transform" />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
