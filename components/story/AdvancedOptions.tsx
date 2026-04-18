'use client';

import { useState } from 'react';
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
import { Coins } from 'lucide-react';

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
}: AdvancedOptionsProps) {
  const [allowOverflow, setAllowOverflow] = useState(false);
  const sliderMax = pricingStoryLengthUiLimitsEnabled ? Math.max(3, pricingStoryLengthCap) : 8;
  const planLabel = `${currentPlanLabel.charAt(0).toUpperCase()}${currentPlanLabel.slice(1)} plan limit`;

  const setVisualSetting = <K extends keyof VisualSettings,>(key: K, value: VisualSettings[K]) => {
    onVisualSettingsChange({
      ...visualSettings,
      [key]: value,
    });
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
                <div>
                  {pricingStoryLengthUiLimitsEnabled && (
                    <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">
                      {planLabel}
                    </p>
                  )}
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

              {pricingStoryLengthUiLimitsEnabled && sliderMax < 8 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/15 bg-emerald-500/8 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                      <Coins className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm text-neutral-100">Your current plan allows up to {sliderMax} beats per story.</p>
                      <p className="mt-1 text-xs text-neutral-500">Upgrade for longer story adventures and more monthly coins.</p>
                    </div>
                  </div>
                  {onViewPlans && (
                    <button
                      type="button"
                      onClick={onViewPlans}
                      className="rounded-2xl border border-white/10 bg-neutral-900/60 px-4 py-2 text-sm text-neutral-200 hover:bg-white/10"
                    >
                      See plans
                    </button>
                  )}
                </div>
              )}
            </div>
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
              <p className="text-xs leading-relaxed text-neutral-500">
                {VISUAL_PRESET_OPTIONS.find((option) => option.value === visualSettings.preset)?.description}
              </p>
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

            {isSeedMode && (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <div className="space-y-1">
                  <h4 className="text-sm font-sans text-neutral-200">Seed preservation</h4>
                  <p className="text-xs leading-relaxed text-neutral-500">
                    Choose how closely Kissago should preserve the user&apos;s source material while shaping it into beats.
                  </p>
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
                <p className="text-xs leading-relaxed text-neutral-500">
                  {SOURCE_FIDELITY_OPTIONS.find((option) => option.value === sourceFidelity)?.description}
                </p>
                <div className="rounded-2xl border border-white/10 bg-neutral-900/60 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">Shared cap</p>
                  <p className="mt-1 text-sm text-neutral-300">
                    Prompt text, seeded source text, and extra guidance share a {authoringWordCap}-word limit.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreatorSettings && (
        <div className="mx-auto mt-4 w-full max-w-4xl rounded-[28px] border border-white/10 bg-neutral-900/60 p-5 text-left backdrop-blur-md md:p-6 lg:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Creator Settings</p>
              <h3 className="text-lg font-serif text-neutral-100">Character reference quality</h3>
              <p className="text-sm leading-relaxed text-neutral-400">
                Studio stories already use character sheets here. Turn this on to ask for a larger 1K sheet with extra turnaround detail.
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
              aria-pressed={creatorReferenceQuality === '1K'}
              aria-label="Toggle 1K character sheet references"
            >
              <span className="h-5 w-5 rounded-full bg-white shadow-sm transition-transform" />
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-neutral-950/40 p-4">
            <p className="text-sm text-neutral-100">
              Use 1K character sheet references
            </p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              Off keeps the faster 0.5K sheet with a close-up, front view, and 3/4 view. On upgrades the sheet to 1K and adds a back view for stronger consistency.
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
