'use client';

import { useState } from 'react';
import { AgeGroup, AuthoringMode, StoryLanguage, VisualSettings } from '@/lib/types/story';
import {
  STORY_DETAIL_OPTIONS,
  STORY_PALETTE_OPTIONS,
  STORY_THEME_OPTIONS,
  VISUAL_PRESET_OPTIONS,
} from '@/lib/ai/story-config';
import { motion } from 'motion/react';
import FilterDropdown, { type FilterDropdownOption } from '@/components/ui/FilterDropdown';

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
  authoringMode: AuthoringMode;
  onAuthoringModeChange: (v: AuthoringMode) => void;
  preludeText: string;
  onPreludeTextChange: (v: string) => void;
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
  authoringMode,
  onAuthoringModeChange,
  preludeText,
  onPreludeTextChange,
}: AdvancedOptionsProps) {
  const [allowOverflow, setAllowOverflow] = useState(false);

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
              <div className="flex items-center justify-end gap-3">
                <p className="text-sm font-sans text-neutral-300">
                  <span className="text-emerald-400">{maxBeats}</span> beats
                </p>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <span className="text-xs text-neutral-500">3</span>
                <input
                  type="range"
                  min={3}
                  max={8}
                  value={maxBeats}
                  onChange={(e) => onMaxBeatsChange(Number(e.target.value))}
                  aria-label="Story length"
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-500"
                />
                <span className="text-xs text-neutral-500">8</span>
              </div>
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

            <div className="space-y-4 rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-sm font-sans text-neutral-200">Start from my own writing</h4>
                  <p className="text-xs leading-relaxed text-neutral-500">
                    Keep your opening text visible as canon and let Kissago continue from it.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onAuthoringModeChange(authoringMode === 'seed_continue' ? 'prompt' : 'seed_continue')}
                  className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                    authoringMode === 'seed_continue'
                      ? 'justify-end border-emerald-400/60 bg-emerald-500/25'
                      : 'justify-start border-white/10 bg-neutral-800'
                  }`}
                  aria-pressed={authoringMode === 'seed_continue'}
                  aria-label="Toggle authored prelude mode"
                >
                  <span className="h-5 w-5 rounded-full bg-white shadow-sm transition-transform" />
                </button>
              </div>

              {authoringMode === 'seed_continue' && (
                <textarea
                  value={preludeText}
                  onChange={(e) => onPreludeTextChange(e.target.value)}
                  rows={6}
                  placeholder="Paste the opening scene, a partial draft, or a complete setup that Kissago should continue from..."
                  className="min-h-36 w-full rounded-2xl border border-white/10 bg-neutral-800/80 px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-emerald-500/50"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
