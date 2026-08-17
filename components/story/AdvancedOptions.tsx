'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AgeGroup, PortraitReferenceQuality, SourceFidelity, StoryBeatLengthLevel, StoryLanguage, VisualSettings } from '@/lib/types/story';
import type { ImageContinuityStrategy } from '@/lib/ai/image-continuity.shared';
import type { ImageModelPickerState, ImageModelSelection } from '@/lib/ai/image-models.shared';
import {
  SOURCE_FIDELITY_OPTIONS,
  resolveStoryVisualOptionSnapshot,
  STORY_LANGUAGE_OPTIONS,
  selectStoryVisualOption,
} from '@/lib/ai/story-config';
import {
  BUILT_IN_STORY_VISUAL_CATALOG,
  getStoryVisualOptions,
  type StoryVisualCatalog,
  type StoryVisualCategory,
} from '@/lib/ai/story-visual-options.shared';
import { isEnglishNarrationLanguage } from '@/lib/ai/narration-accents';
import { resolveStoryNarrationLanguage } from '@/lib/ai/narration-voices';
import { motion } from 'motion/react';
import FilterDropdown, { type FilterDropdownOption } from '@/components/ui/FilterDropdown';
import InfoPopover from '@/components/ui/InfoPopover';
import { Coins, ImageIcon, Loader2, Monitor, Smartphone, Square, Volume2 } from 'lucide-react';
import type {
  NarrationGenderBucket,
  NarrationVoiceClientConfig,
} from '@/lib/ai/narration-voices';
import { SEED_GUIDANCE_WORD_CAP, SEED_SOURCE_WORD_CAP } from '@/lib/story/authoring-limits';
import { STORY_GENRES } from '@/lib/story/genres';
import {
  STORY_AUDIENCE_OPTIONS,
  STORY_BEAT_LENGTH_LABELS,
  resolveStoryBeatLength,
} from '@/lib/ai/story-audience';

const LANGUAGE_OPTIONS: FilterDropdownOption[] = STORY_LANGUAGE_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

const AGE_GROUP_OPTIONS: FilterDropdownOption[] = STORY_AUDIENCE_OPTIONS;
const GENRE_OPTIONS: FilterDropdownOption[] = STORY_GENRES.map((entry) => ({
  value: entry.value,
  label: entry.label,
}));

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

const SOURCE_FIDELITY_DROPDOWN_OPTIONS: FilterDropdownOption[] = SOURCE_FIDELITY_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

const IMAGE_CONTINUITY_DROPDOWN_OPTIONS: FilterDropdownOption[] = [
  { value: 'auto', label: 'Auto continuity' },
  { value: 'provider_stateful', label: 'Stateful thread' },
  { value: 'resend_refs', label: 'Resend refs' },
];


interface AdvancedOptionsProps {
  language: StoryLanguage;
  /** Admin-enabled languages to offer; falls back to the full built-in catalog. */
  languageOptions?: Array<{ value: StoryLanguage; label: string }>;
  onLanguageChange: (v: StoryLanguage) => void;
  ageGroup: AgeGroup;
  onAgeGroupChange: (v: AgeGroup) => void;
  genre: string;
  onGenreChange: (v: string) => void;
  settingCountry: string;
  onSettingCountryChange: (v: string) => void;
  customSetting: string;
  onCustomSettingChange: (v: string) => void;
  maxBeats: number;
  onMaxBeatsChange: (v: number) => void;
  beatLengthLevel: StoryBeatLengthLevel;
  onBeatLengthLevelChange: (v: StoryBeatLengthLevel) => void;
  visualSettings: VisualSettings;
  visualCatalog?: StoryVisualCatalog;
  onVisualSettingsChange: (v: VisualSettings) => void;
  isSeedMode?: boolean;
  sourceFidelity?: SourceFidelity;
  onSourceFidelityChange?: (value: SourceFidelity) => void;
  pricingStoryLengthCap?: number;
  pricingStoryLengthUiLimitsEnabled?: boolean;
  currentPlanLabel?: string;
  onViewPlans?: () => void;
  showCreatorSettings?: boolean;
  creatorReferenceQuality?: PortraitReferenceQuality;
  onCreatorReferenceQualityChange?: (value: PortraitReferenceQuality) => void;
  storyPromptOnlyModeEnabled?: boolean;
  imageGenerationMode?: 'generate' | 'prompt_only';
  imageGenerationAllowed?: boolean;
  onImageGenerationModeChange?: (value: 'generate' | 'prompt_only') => void;
  batchImageDeliveryEnabled?: boolean;
  imageDeliveryMode?: 'live' | 'batch' | 'stateful';
  onImageDeliveryModeChange?: (value: 'live' | 'batch' | 'stateful') => void;
  episodicCharacters?: boolean;
  onEpisodicCharactersChange?: (value: boolean) => void;
  statefulContinuityAvailable?: boolean;
  autoBuildStory?: boolean;
  onAutoBuildStoryChange?: (value: boolean) => void;
  imageModelPicker?: ImageModelPickerState | null;
  imageModelSelection?: ImageModelSelection;
  onImageModelSelectionChange?: (value: ImageModelSelection | undefined) => void;
  imageContinuityStrategy?: ImageContinuityStrategy;
  onImageContinuityStrategyChange?: (value: ImageContinuityStrategy) => void;
  verticalStoriesSettingEnabled?: boolean;
  isVerticalStory?: boolean;
  onVerticalStoryChange?: (value: boolean) => void;
  narrationVoiceConfig?: NarrationVoiceClientConfig | null;
  /** True while the per-language config is being (re)fetched after a language change. */
  narrationVoiceConfigLoading?: boolean;
  narrationVoiceSelection?: {
    genderBucket: NarrationGenderBucket;
    voiceId: string;
    accent: string;
  };
  onNarrationVoiceSelectionChange?: (value: { genderBucket: NarrationGenderBucket; voiceId: string; accent: string }) => void;
}

export default function AdvancedOptions({
  language,
  languageOptions,
  onLanguageChange,
  ageGroup,
  onAgeGroupChange,
  genre,
  onGenreChange,
  settingCountry,
  onSettingCountryChange,
  customSetting,
  onCustomSettingChange,
  maxBeats,
  onMaxBeatsChange,
  beatLengthLevel,
  onBeatLengthLevelChange,
  visualSettings,
  visualCatalog = BUILT_IN_STORY_VISUAL_CATALOG,
  onVisualSettingsChange,
  isSeedMode = false,
  sourceFidelity = 'strictly_follow',
  onSourceFidelityChange,
  pricingStoryLengthCap = 8,
  pricingStoryLengthUiLimitsEnabled = false,
  currentPlanLabel = 'free',
  onViewPlans,
  showCreatorSettings = false,
  creatorReferenceQuality = '0.5K',
  onCreatorReferenceQualityChange,
  storyPromptOnlyModeEnabled = false,
  imageGenerationMode = 'generate',
  imageGenerationAllowed = true,
  onImageGenerationModeChange,
  batchImageDeliveryEnabled = false,
  imageDeliveryMode = 'live',
  onImageDeliveryModeChange,
  episodicCharacters = false,
  onEpisodicCharactersChange,
  statefulContinuityAvailable = true,
  autoBuildStory = false,
  onAutoBuildStoryChange,
  imageModelPicker = null,
  imageModelSelection,
  onImageModelSelectionChange,
  imageContinuityStrategy = 'auto',
  onImageContinuityStrategyChange,
  verticalStoriesSettingEnabled = false,
  isVerticalStory = false,
  onVerticalStoryChange,
  narrationVoiceConfig = null,
  narrationVoiceConfigLoading = false,
  narrationVoiceSelection,
  onNarrationVoiceSelectionChange,
}: AdvancedOptionsProps) {
  const [allowOverflow, setAllowOverflow] = useState(false);
  const effectiveLanguageOptions: FilterDropdownOption[] =
    languageOptions && languageOptions.length > 0
      ? languageOptions.map((option) => ({ value: option.value, label: option.label }))
      : LANGUAGE_OPTIONS;
  const [playingSampleVoice, setPlayingSampleVoice] = useState<string | null>(null);
  const [sampleBuffering, setSampleBuffering] = useState(false);
  const sampleAudioCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const playingAudioRef = useRef<HTMLAudioElement | null>(null);
  const sliderMax = pricingStoryLengthUiLimitsEnabled ? Math.max(3, pricingStoryLengthCap) : 8;
  const resolvedBeatLength = resolveStoryBeatLength(ageGroup, beatLengthLevel);
  const beatLengthLocked = isSeedMode && sourceFidelity === 'strictly_follow';
  const planLabel = `${currentPlanLabel.charAt(0).toUpperCase()}${currentPlanLabel.slice(1)} plan limit`;
  const voiceGender = narrationVoiceSelection?.genderBucket || 'female';
  const voiceList = useMemo(
    () => voiceGender === 'male'
      ? narrationVoiceConfig?.maleVoiceList || []
      : narrationVoiceConfig?.femaleVoiceList || [],
    [narrationVoiceConfig?.femaleVoiceList, narrationVoiceConfig?.maleVoiceList, voiceGender]
  );
  const selectedVoice = narrationVoiceSelection?.voiceId || (
    voiceGender === 'male'
      ? narrationVoiceConfig?.defaultMaleVoice
      : narrationVoiceConfig?.defaultFemaleVoice
  ) || voiceList[0] || '';
  const voiceDropdownOptions: FilterDropdownOption[] = voiceList.map((voice) => ({ value: voice, label: voice }));
  const voiceAccent = narrationVoiceSelection?.accent || '';
  // Gate on the *currently selected* language, not just the fetched config: the
  // config refetch is async, so a stale English config would otherwise flash the
  // accent picker for a non-English language until the refetch resolves.
  const accentEnabled = Boolean(
    narrationVoiceConfig?.accentEnabled
    && (narrationVoiceConfig?.accentOptions?.length ?? 0) > 0
    && isEnglishNarrationLanguage(language)
  );
  const accentOptions = narrationVoiceConfig?.accentOptions ?? [];
  const selectedAccent = accentEnabled
    ? (accentOptions.some((option) => option.id === voiceAccent)
        ? voiceAccent
        : (narrationVoiceConfig?.defaultAccent && accentOptions.some((o) => o.id === narrationVoiceConfig.defaultAccent)
            ? narrationVoiceConfig!.defaultAccent
            : accentOptions[0]?.id || ''))
    : '';
  const accentDropdownOptions: FilterDropdownOption[] = accentOptions.map((option) => ({
    value: option.id,
    label: option.label,
  }));
  const storyboardImagesEnabled = imageGenerationAllowed && imageGenerationMode !== 'prompt_only';
  const imageModelOptions = imageModelPicker?.options ?? [];
  const selectedImageModelKey = imageModelSelection?.modelKey || imageModelPicker?.selectedModelKey || imageModelPicker?.defaultModelKey || '';
  const selectedImageModel = imageModelOptions.find((option) => option.modelKey === selectedImageModelKey)
    ?? imageModelOptions.find((option) => option.isDefault)
    ?? imageModelOptions[0];
  const imageModelDropdownOptions: FilterDropdownOption[] = imageModelOptions.map((option) => ({
    value: option.modelKey,
    label: `${option.displayName}${option.badge ? ` · ${option.badge}` : ''}`,
    hint: option.description || undefined,
  }));
  const orientationLabel = isVerticalStory ? 'Portrait' : 'Landscape';
  const optionsForCategory = (category: StoryVisualCategory, selectedKey: string) => {
    const published = getStoryVisualOptions(visualCatalog, category);
    const storedSnapshot = visualSettings.resolvedOptions?.[category];
    const snapshot = storedSnapshot?.key === selectedKey
      ? storedSnapshot
      : resolveStoryVisualOptionSnapshot(visualSettings, category);
    return published.some((option) => option.key === selectedKey) || snapshot?.key !== selectedKey
      ? published
      : [{
          ...snapshot,
          status: 'archived' as const,
          sortOrder: -1,
          isDefault: false,
        }, ...published];
  };
  const styleCatalogOptions = optionsForCategory('style', visualSettings.preset);
  const moodCatalogOptions = optionsForCategory('mood', visualSettings.theme);
  const paletteCatalogOptions = optionsForCategory('palette', visualSettings.palette);
  const detailCatalogOptions = optionsForCategory('detail', visualSettings.detail);
  const visualPresetOptions: FilterDropdownOption[] = styleCatalogOptions.map((option) => ({ value: option.key, label: option.label }));
  const moodOptions: FilterDropdownOption[] = moodCatalogOptions.map((option) => ({ value: option.key, label: option.label }));
  const paletteOptions: FilterDropdownOption[] = paletteCatalogOptions.map((option) => ({ value: option.key, label: option.label }));
  const detailOptions: FilterDropdownOption[] = detailCatalogOptions.map((option) => ({ value: option.key, label: option.label }));
  const visualPresetDescription = styleCatalogOptions.find((option) => option.key === visualSettings.preset)?.description || 'Choose the illustration style Kissago should use for storyboards.';
  const visualModifierDescriptions = [
    moodCatalogOptions.find((option) => option.key === visualSettings.theme)?.description,
    paletteCatalogOptions.find((option) => option.key === visualSettings.palette)?.description,
    detailCatalogOptions.find((option) => option.key === visualSettings.detail)?.description,
  ].filter(Boolean).join(' · ');
  const sourceFidelityDescription = SOURCE_FIDELITY_OPTIONS.find((option) => option.value === sourceFidelity)?.description || 'Choose how closely Kissago should preserve the source material.';
  // Guard against a stale config: after a language change the parent refetches
  // asynchronously, so the still-mounted config can belong to the *previous*
  // language (whose English samples are ready with a real audioUrl). Only trust
  // samples once the loaded config's languageCode matches the selected language —
  // otherwise a wrong-language sample could play under a non-English selection.
  const expectedNarrationLanguageCode = resolveStoryNarrationLanguage(language).languageCode;
  const configMatchesLanguage = narrationVoiceConfig?.languageCode === expectedNarrationLanguageCode;
  const samplesLoading = Boolean(narrationVoiceConfigLoading) || !configMatchesLanguage;
  const selectedVoiceSample = narrationVoiceConfig?.samples.find((candidate) => candidate.voiceId === selectedVoice);
  const selectedVoiceSampleReady =
    configMatchesLanguage && selectedVoiceSample?.status === 'ready' && Boolean(selectedVoiceSample.audioUrl);
  const selectedLanguageLabel =
    effectiveLanguageOptions.find((option) => option.value === language)?.label || 'this language';

  const setVisualSetting = (category: StoryVisualCategory, value: string) => {
    onVisualSettingsChange(selectStoryVisualOption(visualSettings, visualCatalog, category, value));
  };

  const stopSelectedVoiceSample = () => {
    playingAudioRef.current?.pause();
    playingAudioRef.current = null;
    setPlayingSampleVoice(null);
    setSampleBuffering(false);
  };

  const setNarrationVoiceGender = (genderBucket: NarrationGenderBucket) => {
    if (!narrationVoiceConfig || !onNarrationVoiceSelectionChange) return;
    stopSelectedVoiceSample();
    const nextVoiceList = genderBucket === 'male'
      ? narrationVoiceConfig.maleVoiceList
      : narrationVoiceConfig.femaleVoiceList;
    const defaultVoice = genderBucket === 'male'
      ? narrationVoiceConfig.defaultMaleVoice
      : narrationVoiceConfig.defaultFemaleVoice;
    const nextVoice = nextVoiceList.includes(defaultVoice) ? defaultVoice : nextVoiceList[0] || '';
    onNarrationVoiceSelectionChange({ genderBucket, voiceId: nextVoice, accent: selectedAccent });
  };

  const setNarrationVoice = (voiceId: string) => {
    stopSelectedVoiceSample();
    onNarrationVoiceSelectionChange?.({ genderBucket: voiceGender, voiceId, accent: selectedAccent });
  };

  const setNarrationAccent = (accent: string) => {
    onNarrationVoiceSelectionChange?.({ genderBucket: voiceGender, voiceId: selectedVoice, accent });
  };

  // Preload every ready sample for the current gender's voices (a handful of
  // small WAVs) so switching voices and pressing play is near-instant. Only runs
  // once the config actually matches the selected language, so we never preload a
  // stale/wrong-language sample.
  useEffect(() => {
    if (!configMatchesLanguage || !narrationVoiceConfig) return;
    const cache = sampleAudioCacheRef.current;
    for (const voiceId of voiceList) {
      const sample = narrationVoiceConfig.samples.find((candidate) => candidate.voiceId === voiceId);
      if (sample?.status !== 'ready' || !sample.audioUrl) continue;
      const cacheKey = `${voiceId}:${sample.audioUrl}`;
      if (cache.has(cacheKey)) continue;
      const audio = new Audio(sample.audioUrl);
      audio.preload = 'auto';
      audio.load();
      cache.set(cacheKey, audio);
    }
  }, [configMatchesLanguage, narrationVoiceConfig, voiceList]);

  const playSelectedVoiceSample = async () => {
    if (!selectedVoiceSampleReady || !selectedVoiceSample?.audioUrl || !selectedVoice) return;

    const cacheKey = `${selectedVoice}:${selectedVoiceSample.audioUrl}`;
    let audio = sampleAudioCacheRef.current.get(cacheKey);
    if (!audio) {
      audio = new Audio(selectedVoiceSample.audioUrl);
      audio.preload = 'auto';
      sampleAudioCacheRef.current.set(cacheKey, audio);
    }

    playingAudioRef.current?.pause();
    playingAudioRef.current = audio;
    setPlayingSampleVoice(selectedVoice);
    // Show a spinner between the click and the first audio frame — first play
    // fetches the remote WAV, so there is a network gap that would otherwise read
    // as a dead button.
    setSampleBuffering(true);
    try {
      audio.currentTime = 0;
      audio.onplaying = () => {
        if (playingAudioRef.current === audio) setSampleBuffering(false);
      };
      audio.onended = () => {
        setPlayingSampleVoice((current) => current === selectedVoice ? null : current);
        if (playingAudioRef.current === audio) {
          playingAudioRef.current = null;
          setSampleBuffering(false);
        }
      };
      audio.onerror = () => {
        setPlayingSampleVoice((current) => current === selectedVoice ? null : current);
        if (playingAudioRef.current === audio) {
          playingAudioRef.current = null;
          setSampleBuffering(false);
        }
      };
      await audio.play();
    } catch {
      setPlayingSampleVoice((current) => current === selectedVoice ? null : current);
      if (playingAudioRef.current === audio) {
        playingAudioRef.current = null;
        setSampleBuffering(false);
      }
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
              value={ageGroup}
              options={AGE_GROUP_OPTIONS}
              onChange={(value) => onAgeGroupChange(value as AgeGroup)}
              fullWidth
              size="form"
              mode="inline"
              ariaLabel="Age group"
              contextLabel="Audience"
            />

            <FilterDropdown
              value={genre}
              options={GENRE_OPTIONS}
              onChange={onGenreChange}
              fullWidth
              size="form"
              mode="inline"
              ariaLabel="Genre"
              contextLabel="Genre"
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
                contextLabel="Storyverse"
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

            <FilterDropdown
              value={language}
              options={effectiveLanguageOptions}
              onChange={(value) => onLanguageChange(value as StoryLanguage)}
              fullWidth
              size="form"
              mode="inline"
              ariaLabel="Story language"
              contextLabel="Language"
            />

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

            <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <h4 className="text-sm font-sans text-neutral-200">Beat length</h4>
                  <InfoPopover title="Beat length" ariaLabel="Show beat length details">
                    <p>Controls how much story text and narration each beat contains.</p>
                    <p>
                      The word range adapts to the selected audience. Each beat still forms one
                      scene with four storyboard panels and one narration track.
                    </p>
                    {beatLengthLocked && (
                      <p>Strict source mode keeps canonical source wording unchanged.</p>
                    )}
                  </InfoPopover>
                </div>
                <div className="text-right font-sans">
                  <p className="text-sm text-emerald-400">{resolvedBeatLength.label}</p>
                  <p className="text-xs text-neutral-500">
                    about {resolvedBeatLength.targetWords} words
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <span className="text-xs text-neutral-500">Brief</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={beatLengthLevel}
                  disabled={beatLengthLocked}
                  onChange={(event) => onBeatLengthLevelChange(Number(event.target.value) as StoryBeatLengthLevel)}
                  aria-label="Beat length"
                  aria-valuetext={`${STORY_BEAT_LENGTH_LABELS[beatLengthLevel]}, about ${resolvedBeatLength.targetWords} words per beat`}
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="text-xs text-neutral-500">Immersive</span>
              </div>
              <p className="mt-3 text-xs text-neutral-500">
                {beatLengthLocked
                  ? 'Canonical source text takes priority over this setting.'
                  : `${resolvedBeatLength.targetMinWords}-${resolvedBeatLength.targetMaxWords} words per beat for this audience.`}
              </p>
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
                      {imageGenerationAllowed ? (storyboardImagesEnabled ? 'On' : 'Off') : 'Off for this plan'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onImageGenerationModeChange?.(
                      storyboardImagesEnabled ? 'prompt_only' : 'generate'
                    )}
                    disabled={!imageGenerationAllowed}
                    className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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

            {batchImageDeliveryEnabled && storyboardImagesEnabled && (
              <div className="rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-sans text-neutral-200">Image delivery</h4>
                      <InfoPopover title="Image delivery" ariaLabel="Show image delivery details">
                        <p>
                          Live generates images immediately while you read, at full price.
                        </p>
                        <p>
                          Fast renders all images in one go after the story, keeping characters
                          consistent automatically. Regular price, ready in minutes.
                        </p>
                        <p>
                          Cost-saver sends all images to a provider batch — ready within about a
                          day and roughly 50% cheaper. Great for finishing a whole story affordably.
                        </p>
                      </InfoPopover>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      {imageDeliveryMode === 'stateful'
                        ? 'Fast (regular price, ready in minutes)'
                        : imageDeliveryMode === 'batch'
                        ? 'Cost-saver (~24h, ~50% cheaper)'
                        : 'Live (immediate)'}
                    </p>
                  </div>
                  <div
                    className="grid h-10 w-52 shrink-0 grid-cols-3 rounded-full border border-white/10 bg-neutral-900/70 p-1 text-xs"
                    role="group"
                    aria-label="Image delivery mode"
                  >
                    {([
                      { key: 'live', label: 'Live' },
                      { key: 'stateful', label: 'Fast' },
                      { key: 'batch', label: 'Saver' },
                    ] as const).map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onImageDeliveryModeChange?.(key)}
                        className={`inline-flex items-center justify-center rounded-full transition-colors ${
                          imageDeliveryMode === key ? 'bg-white text-black' : 'text-neutral-400 hover:text-neutral-100'
                        }`}
                        aria-pressed={imageDeliveryMode === key}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {imageDeliveryMode === 'stateful' && !statefulContinuityAvailable && (
                  <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    The selected image model doesn&apos;t support stateful threads. Fast delivery
                    will still run, falling back to reference-image continuity.
                  </p>
                )}

                {imageDeliveryMode === 'stateful' && (
                  <div className="mt-3 flex items-center justify-between gap-4 border-t border-white/10 pt-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-sans text-neutral-200">Episodic characters</h4>
                        <InfoPopover title="Episodic characters" ariaLabel="Show episodic details">
                          <p>
                            Generates and saves a portrait for each named character so they can be
                            reused consistently across future stories. Adds a small extra cost.
                          </p>
                          <p>
                            Off keeps characters consistent within this story via the stateful thread,
                            but doesn&apos;t save reusable character references.
                          </p>
                        </InfoPopover>
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">
                        Save reusable character portraits for cross-story continuity.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onEpisodicCharactersChange?.(!episodicCharacters)}
                      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                        episodicCharacters
                          ? 'justify-end border-emerald-400/60 bg-emerald-500/25'
                          : 'justify-start border-white/10 bg-neutral-800'
                      }`}
                      role="switch"
                      aria-checked={episodicCharacters}
                      aria-label="Episodic characters"
                    >
                      <span className="h-5 w-5 rounded-full bg-white shadow-sm transition-transform" />
                    </button>
                  </div>
                )}

                {(imageDeliveryMode === 'batch' || imageDeliveryMode === 'stateful') && (
                  <div className="mt-3 flex items-center justify-between gap-4 border-t border-white/10 pt-3">
                    <div className="min-w-0">
                      <h4 className="text-sm font-sans text-neutral-200">Auto-build whole story</h4>
                      <p className="mt-1 text-xs text-neutral-500">
                        Kissago picks a path automatically and prepares every beat, ready for visuals.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAutoBuildStoryChange?.(!autoBuildStory)}
                      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                        autoBuildStory
                          ? 'justify-end border-emerald-400/60 bg-emerald-500/25'
                          : 'justify-start border-white/10 bg-neutral-800'
                      }`}
                      role="switch"
                      aria-checked={autoBuildStory}
                      aria-label="Auto-build whole story"
                    >
                      <span className="h-5 w-5 rounded-full bg-white shadow-sm transition-transform" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {storyboardImagesEnabled && imageModelDropdownOptions.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                      <ImageIcon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-sm font-sans text-neutral-200">Image model</h4>
                      {selectedImageModel && (
                        <p className="mt-1 truncate text-xs text-neutral-500">
                          {selectedImageModel.description ? `${selectedImageModel.description} · ` : ''}
                          {selectedImageModel.coinCostPerImage.toLocaleString()} coins/image
                        </p>
                      )}
                    </div>
                  </div>
                  {selectedImageModel?.isRecommended && (
                    <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-emerald-200">
                      Best
                    </span>
                  )}
                </div>
                <FilterDropdown
                  value={selectedImageModelKey}
                  options={imageModelDropdownOptions}
                  onChange={(modelKey) => onImageModelSelectionChange?.({
                    taskKey: imageModelPicker?.taskKey,
                    modelKey,
                  })}
                  fullWidth
                  size="form"
                  mode="inline"
                  ariaLabel="Image model"
                />
                <div className="mt-3">
                  <FilterDropdown
                    value={imageContinuityStrategy}
                    options={IMAGE_CONTINUITY_DROPDOWN_OPTIONS}
                    onChange={(value) => onImageContinuityStrategyChange?.(value as ImageContinuityStrategy)}
                    fullWidth
                    size="form"
                    mode="inline"
                    ariaLabel="Image continuity strategy"
                  />
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
                options={visualPresetOptions}
                onChange={(value) => setVisualSetting('style', value)}
                fullWidth
                size="form"
                mode="inline"
                ariaLabel="Art style"
              />
              <p className="text-xs leading-relaxed text-neutral-500">{visualPresetDescription}</p>
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
              <h4 className="text-sm font-sans text-neutral-200">Visual direction</h4>

              <FilterDropdown
                value={visualSettings.theme}
                options={moodOptions}
                onChange={(value) => setVisualSetting('mood', value)}
                fullWidth
                size="form"
                mode="inline"
                ariaLabel="Story mood"
                contextLabel="Story mood"
              />

              <FilterDropdown
                value={visualSettings.palette}
                options={paletteOptions}
                onChange={(value) => setVisualSetting('palette', value)}
                fullWidth
                size="form"
                mode="inline"
                ariaLabel="Color and light"
                contextLabel="Color & light"
              />

              <FilterDropdown
                value={visualSettings.detail}
                options={detailOptions}
                onChange={(value) => setVisualSetting('detail', value)}
                fullWidth
                size="form"
                mode="inline"
                ariaLabel="Scene richness"
                contextLabel="Scene richness"
              />

              {visualModifierDescriptions && (
                <p className="border-t border-white/10 pt-3 text-xs leading-relaxed text-neutral-500">
                  {visualModifierDescriptions}
                </p>
              )}
            </div>

            {narrationVoiceConfig?.enabled && (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-sans text-neutral-200">Narration Voice</h4>
                    <InfoPopover title="Narration voice" ariaLabel="Show narration voice details">
                      <p>Selected voice will be used for the entire story narration.</p>
                      {narrationVoiceConfig.fallbackToEnglishSample && (
                        <p>English sample preview is being used because this story language does not have a stored sample yet.</p>
                      )}
                    </InfoPopover>
                  </div>

                  <div className="flex items-center gap-2">
                    {(['female', 'male'] as const).map((genderBucket) => (
                      <button
                        key={genderBucket}
                        type="button"
                        onClick={() => setNarrationVoiceGender(genderBucket)}
                        className={`min-h-9 rounded-full border px-4 py-1.5 text-sm transition-colors ${
                          voiceGender === genderBucket
                            ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                            : 'border-white/10 bg-neutral-900/60 text-neutral-300 hover:bg-white/10'
                        }`}
                      >
                        {genderBucket === 'female' ? 'Female' : 'Male'}
                      </button>
                    ))}
                  </div>
                </div>

                {voiceDropdownOptions.length > 0 && (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2 sm:grid-cols-[minmax(0,18rem)_auto_auto]">
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
                      disabled={samplesLoading || sampleBuffering || !selectedVoiceSampleReady || playingSampleVoice === selectedVoice}
                      className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-neutral-900/70 text-neutral-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={selectedVoice ? `Play ${selectedVoice} sample` : 'Play selected voice sample'}
                    >
                      {samplesLoading || sampleBuffering ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Volume2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={stopSelectedVoiceSample}
                      disabled={playingSampleVoice !== selectedVoice}
                      className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-neutral-900/70 text-neutral-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={selectedVoice ? `Stop ${selectedVoice} sample` : 'Stop voice sample'}
                    >
                      <Square className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}

                {samplesLoading ? (
                  <p className="text-xs leading-relaxed text-neutral-500">Loading voice previews…</p>
                ) : !selectedVoiceSampleReady ? (
                  <p className="text-xs leading-relaxed text-neutral-500">
                    {narrationVoiceConfig.fallbackToEnglishSample
                      ? `Voice previews aren't available in ${selectedLanguageLabel} yet — narration will use an English voice.`
                      : `Voice preview isn't available in ${selectedLanguageLabel} yet.`}
                  </p>
                ) : null}

                {accentEnabled && accentDropdownOptions.length > 0 && (
                  <div className="space-y-2 border-t border-white/10 pt-3">
                    <div className="flex items-center gap-2">
                      <h5 className="text-xs font-sans uppercase tracking-[0.14em] text-neutral-400">Accent</h5>
                      <InfoPopover title="Narration accent" ariaLabel="Show narration accent details">
                        <p>The accent tells the narrator how to pronounce the story — for example American, British, or Indian English.</p>
                        <p>It changes the delivery of the selected voice. The voice sample above previews the voice, not the exact accent.</p>
                      </InfoPopover>
                    </div>
                    <FilterDropdown
                      value={selectedAccent}
                      options={accentDropdownOptions}
                      onChange={setNarrationAccent}
                      fullWidth
                      size="form"
                      mode="inline"
                      ariaLabel="Choose narration accent"
                    />
                    <p className="text-xs leading-relaxed text-neutral-500">
                      Applies to the whole story. The sample preview reflects the voice, not the accent.
                    </p>
                  </div>
                )}
              </div>
            )}

            {accentEnabled && accentDropdownOptions.length > 0 && !narrationVoiceConfig?.enabled && (
              <div className="space-y-2 rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-sans text-neutral-200">Narration Accent</h4>
                  <InfoPopover title="Narration accent" ariaLabel="Show narration accent details">
                    <p>The accent tells the narrator how to pronounce the story — for example American, British, or Indian English.</p>
                    <p>It changes the delivery of the narrator voice for the whole story.</p>
                  </InfoPopover>
                </div>
                <FilterDropdown
                  value={selectedAccent}
                  options={accentDropdownOptions}
                  onChange={setNarrationAccent}
                  fullWidth
                  size="form"
                  mode="inline"
                  ariaLabel="Choose narration accent"
                />
                <p className="text-xs leading-relaxed text-neutral-500">
                  Applies to the whole story narration.
                </p>
              </div>
            )}

            {isSeedMode && (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-sans text-neutral-200">Seed preservation</h4>
                  <InfoPopover title="Seed preservation" ariaLabel="Show seed preservation details">
                    <p>{sourceFidelityDescription}</p>
                    <p>
                      Seed source text has a fixed {SEED_SOURCE_WORD_CAP}-word limit. Extra visual guidance has a separate {SEED_GUIDANCE_WORD_CAP}-word limit and cannot change the story.
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
