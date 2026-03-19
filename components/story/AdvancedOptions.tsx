'use client';

import { AgeGroup } from '@/lib/types/story';
import { motion } from 'motion/react';

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
  ageGroup: AgeGroup;
  onAgeGroupChange: (v: AgeGroup) => void;
  settingCountry: string;
  onSettingCountryChange: (v: string) => void;
  customSetting: string;
  onCustomSettingChange: (v: string) => void;
  maxBeats: number;
  onMaxBeatsChange: (v: number) => void;
}

export default function AdvancedOptions({
  ageGroup,
  onAgeGroupChange,
  settingCountry,
  onSettingCountryChange,
  customSetting,
  onCustomSettingChange,
  maxBeats,
  onMaxBeatsChange,
}: AdvancedOptionsProps) {
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
      </div>
    </motion.div>
  );
}
