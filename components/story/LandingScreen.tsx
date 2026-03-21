'use client';

import { useState, useEffect } from 'react';
import { useStoryStore } from '@/lib/store/story-store';
import { AgeGroup, StoryConfig, StoryLanguage } from '@/lib/types/story';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AdvancedOptions from './AdvancedOptions';
import Gallery from './Gallery';

interface LandingScreenProps {
  onBegin?: (prompt: string, config?: StoryConfig) => void;
}

export default function LandingScreen({ onBegin }: LandingScreenProps) {
  const [prompt, setPrompt] = useState('');
  const startStory = useStoryStore((state) => state.startStory);
  const isLoading = useStoryStore((state) => state.isLoading);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [language, setLanguage] = useState<StoryLanguage>('english');
  const [ageGroup, setAgeGroup] = useState<AgeGroup>('all_ages');
  const [settingCountry, setSettingCountry] = useState('generic');
  const [customSetting, setCustomSetting] = useState('');
  const [maxBeats, setMaxBeats] = useState(6);

  // Restore prompt after OAuth redirect
  useEffect(() => {
    const savedPrompt = sessionStorage.getItem('kissago_pending_prompt');
    if (savedPrompt) {
      setPrompt(savedPrompt);
      sessionStorage.removeItem('kissago_pending_prompt');
      const savedConfig = sessionStorage.getItem('kissago_pending_config');
      if (savedConfig) {
        try {
          const config = JSON.parse(savedConfig) as StoryConfig;
          setLanguage(config.language);
          setAgeGroup(config.ageGroup);
          setSettingCountry(config.settingCountry);
          setMaxBeats(config.maxBeats);
        } catch { /* ignore parse errors */ }
        sessionStorage.removeItem('kissago_pending_config');
      }
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && !isLoading) {
      const config: StoryConfig = {
        language,
        ageGroup,
        settingCountry: settingCountry === 'custom' ? customSetting || 'generic' : settingCountry,
        maxBeats,
      };
      if (onBegin) {
        onBegin(prompt.trim(), config);
      } else {
        startStory(prompt.trim(), config);
      }
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-900/20 rounded-full blur-3xl mix-blend-screen" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-900/20 rounded-full blur-3xl mix-blend-screen" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="z-10 max-w-2xl w-full text-center space-y-8"
      >
        <div className="space-y-4">
          <h1 className="text-5xl md:text-7xl font-serif text-neutral-100 tracking-tight">
            Kissago
          </h1>
          <p className="text-lg md:text-xl text-neutral-400 font-sans max-w-lg mx-auto leading-relaxed">
            Co-create magical, illustrated branching stories with Kissago.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="relative max-w-xl mx-auto mt-12">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-indigo-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
            <div className="relative flex items-center bg-neutral-900 border border-white/10 rounded-2xl p-2 shadow-2xl">
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

          {/* Advanced Options Toggle */}
          <div className="mt-4">
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
                  maxBeats={maxBeats}
                  onMaxBeatsChange={setMaxBeats}
                />
              )}
            </AnimatePresence>
          </div>
        </form>

        <div className="pt-12 flex gap-4 justify-center text-sm text-neutral-500 font-sans">
          <button
            onClick={() => setPrompt("A brave little toaster's journey to the moon")}
            className="hover:text-neutral-300 transition-colors"
          >
            Try: &quot;A brave little toaster...&quot;
          </button>
          <span>•</span>
          <button
            onClick={() => setPrompt("The mystery of the glowing forest")}
            className="hover:text-neutral-300 transition-colors"
          >
            &quot;The mystery of the glowing forest&quot;
          </button>
        </div>
      </motion.div>

      {/* Public Storylines Gallery */}
      <Gallery />
    </div>
  );
}
