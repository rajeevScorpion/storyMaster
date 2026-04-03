'use client';

import { AgeGroup, AuthoringMode, StoryLanguage, VisualSettings } from '@/lib/types/story';
import {
  STORY_DETAIL_OPTIONS,
  STORY_PALETTE_OPTIONS,
  STORY_THEME_OPTIONS,
  VISUAL_PRESET_OPTIONS,
} from '@/lib/ai/story-config';
import { motion } from 'motion/react';

const LANGUAGE_OPTIONS: { value: StoryLanguage; label: string }[] = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi (हिन्दी)' },
];

const AGE_GROUP_OPTIONS: { value: AgeGroup; label: string }[] = [
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
      className="overflow-hidden"
    >
      <div className="mt-6 bg-neutral-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-6 space-y-5">
        <h3 className="text-sm font-sans uppercase tracking-widest text-neutral-400">
          Story Settings
        </h3>

        {/* Language */}
        <div className="space-y-2">
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as StoryLanguage)}
            className="w-full bg-neutral-800 border border-white/10 rounded-xl px-4 py-2.5 text-white font-sans text-sm outline-none focus:border-emerald-500/50 transition-colors appearance-none cursor-pointer"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Age Group */}
        <div className="space-y-2">
          <select
            value={ageGroup}
            onChange={(e) => onAgeGroupChange(e.target.value as AgeGroup)}
            className="w-full bg-neutral-800 border border-white/10 rounded-xl px-4 py-2.5 text-white font-sans text-sm outline-none focus:border-emerald-500/50 transition-colors appearance-none cursor-pointer"
          >
            {AGE_GROUP_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Setting / Country */}
        <div className="space-y-2">
          <select
            value={SETTING_PRESETS.includes(settingCountry) ? settingCountry : 'custom'}
            onChange={(e) => {
              const val = e.target.value;
              onSettingCountryChange(val);
              if (val !== 'custom') onCustomSettingChange('');
            }}
            className="w-full bg-neutral-800 border border-white/10 rounded-xl px-4 py-2.5 text-white font-sans text-sm outline-none focus:border-emerald-500/50 transition-colors appearance-none cursor-pointer"
          >
            {SETTING_PRESETS.map((s) => (
              <option key={s} value={s}>
                {s === 'generic' ? 'Any / Generic' : s === 'custom' ? 'Custom...' : s}
              </option>
            ))}
          </select>
          {settingCountry === 'custom' && (
            <input
              type="text"
              value={customSetting}
              onChange={(e) => onCustomSettingChange(e.target.value)}
              placeholder="Enter your setting..."
              className="w-full bg-neutral-800 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-neutral-500 font-sans text-sm outline-none focus:border-emerald-500/50 transition-colors mt-2"
            />
          )}
        </div>

        {/* Story Length */}
        <div className="space-y-2">
          <label className="text-sm text-neutral-300 font-sans">
            Story Length: <span className="text-emerald-400">{maxBeats} beats</span>
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-500">3</span>
            <input
              type="range"
              min={3}
              max={8}
              value={maxBeats}
              onChange={(e) => onMaxBeatsChange(Number(e.target.value))}
              className="flex-1 accent-emerald-500 cursor-pointer"
            />
            <span className="text-xs text-neutral-500">8</span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-neutral-300 font-sans">Visual preset</label>
          <select
            value={visualSettings.preset}
            onChange={(e) => setVisualSetting('preset', e.target.value as VisualSettings['preset'])}
            className="w-full bg-neutral-800 border border-white/10 rounded-xl px-4 py-2.5 text-white font-sans text-sm outline-none focus:border-emerald-500/50 transition-colors appearance-none cursor-pointer"
          >
            {VISUAL_PRESET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">
            {VISUAL_PRESET_OPTIONS.find((option) => option.value === visualSettings.preset)?.description}
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm text-neutral-300 font-sans">Theme</label>
            <select
              value={visualSettings.theme}
              onChange={(e) => setVisualSetting('theme', e.target.value as VisualSettings['theme'])}
              className="w-full bg-neutral-800 border border-white/10 rounded-xl px-4 py-2.5 text-white font-sans text-sm outline-none focus:border-emerald-500/50 transition-colors appearance-none cursor-pointer"
            >
              {STORY_THEME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-neutral-300 font-sans">Palette</label>
            <select
              value={visualSettings.palette}
              onChange={(e) => setVisualSetting('palette', e.target.value as VisualSettings['palette'])}
              className="w-full bg-neutral-800 border border-white/10 rounded-xl px-4 py-2.5 text-white font-sans text-sm outline-none focus:border-emerald-500/50 transition-colors appearance-none cursor-pointer"
            >
              {STORY_PALETTE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-neutral-300 font-sans">Detail</label>
            <select
              value={visualSettings.detail}
              onChange={(e) => setVisualSetting('detail', e.target.value as VisualSettings['detail'])}
              className="w-full bg-neutral-800 border border-white/10 rounded-xl px-4 py-2.5 text-white font-sans text-sm outline-none focus:border-emerald-500/50 transition-colors appearance-none cursor-pointer"
            >
              {STORY_DETAIL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="text-sm text-neutral-200 font-sans">Start from my own writing</h4>
              <p className="text-xs text-neutral-500 mt-1">
                Keep your opening text visible as canon and let Kissago continue from it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onAuthoringModeChange(authoringMode === 'seed_continue' ? 'prompt' : 'seed_continue')}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                authoringMode === 'seed_continue' ? 'bg-emerald-500/70' : 'bg-neutral-700'
              }`}
              aria-pressed={authoringMode === 'seed_continue'}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                  authoringMode === 'seed_continue' ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {authoringMode === 'seed_continue' && (
            <textarea
              value={preludeText}
              onChange={(e) => onPreludeTextChange(e.target.value)}
              rows={6}
              placeholder="Paste the opening scene, a partial draft, or a complete setup that Kissago should continue from..."
              className="w-full bg-neutral-800 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-neutral-500 font-sans text-sm outline-none focus:border-emerald-500/50 transition-colors"
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}
