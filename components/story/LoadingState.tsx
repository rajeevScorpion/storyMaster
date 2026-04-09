'use client';

import { useState, useEffect } from 'react';
import { useStoryStore } from '@/lib/store/story-store';
import { getStoryboardSettings } from '@/app/actions/admin';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  backdropMode?: 'scene' | 'blocking';
  className?: string;
}

type LoadingUiSettingsCache = {
  loadingNodeLabelsEnabled: boolean;
  loadingHintTypewriterEnabled: boolean;
};

let loadingUiSettingsCache: LoadingUiSettingsCache | null = null;

async function loadLoadingUiSettings(): Promise<LoadingUiSettingsCache> {
  if (loadingUiSettingsCache) {
    return loadingUiSettingsCache;
  }

  const settings = await getStoryboardSettings();
  loadingUiSettingsCache = {
    loadingNodeLabelsEnabled: settings.loadingNodeLabelsEnabled,
    loadingHintTypewriterEnabled: settings.loadingHintTypewriterEnabled,
  };
  return loadingUiSettingsCache;
}

function AnimatedClueText({
  text,
  typewriterEnabled,
}: {
  text: string;
  typewriterEnabled: boolean;
}) {
  const [typedText, setTypedText] = useState(typewriterEnabled ? '' : text);

  useEffect(() => {
    if (!typewriterEnabled) {
      return;
    }

    let index = 0;
    const interval = setInterval(() => {
      index += 1;
      setTypedText(text.slice(0, index));
      if (index >= text.length) {
        clearInterval(interval);
      }
    }, 28);

    return () => clearInterval(interval);
  }, [text, typewriterEnabled]);

  return <>&quot;{typewriterEnabled ? typedText : text}&quot;</>;
}

function RotatingClue({ clues, clueKey }: { clues: string[]; clueKey: string }) {
  const [currentClueIndex, setCurrentClueIndex] = useState(0);
  const [typewriterEnabled, setTypewriterEnabled] = useState(
    loadingUiSettingsCache?.loadingHintTypewriterEnabled ?? false
  );

  useEffect(() => {
    loadLoadingUiSettings()
      .then((settings) => setTypewriterEnabled(settings.loadingHintTypewriterEnabled))
      .catch(() => setTypewriterEnabled(false));
  }, []);

  useEffect(() => {
    if (!clues || clues.length === 0) return;

    const interval = setInterval(() => {
      setCurrentClueIndex((prev) => (prev + 1) % clues.length);
    }, 6500);

    return () => clearInterval(interval);
  }, [clues]);

  return (
    <div className="flex h-[8.75rem] items-center justify-center rounded-2xl border border-white/10 bg-black/20 px-6 py-5 shadow-[0_16px_40px_rgba(0,0,0,0.16)]">
      <AnimatePresence mode="wait">
        <motion.p
          key={`${clueKey}-${currentClueIndex}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.85, ease: 'easeInOut' }}
          className="mx-auto max-w-xl text-center text-lg font-serif italic leading-relaxed text-neutral-100 md:text-xl"
        >
          <AnimatedClueText
            key={`${clueKey}-${currentClueIndex}-${typewriterEnabled ? 'typewriter' : 'static'}`}
            text={clues[currentClueIndex]}
            typewriterEnabled={typewriterEnabled}
          />
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

export default function LoadingState({
  backdropMode = 'scene',
  className = '',
}: LoadingStateProps) {
  const loadingClues = useStoryStore((state) => state.loadingClues);
  const loadingStage = useStoryStore((state) => state.loadingStage);
  const [showNodeLabels, setShowNodeLabels] = useState(
    loadingUiSettingsCache?.loadingNodeLabelsEnabled ?? false
  );
  const [hoveredStepKey, setHoveredStepKey] = useState<string | null>(null);

  const defaultClues = [
    'Kissago is weaving the next moment...',
    'The story is deciding how it wants to unfold...',
    'A fresh choice can open surprising paths ahead...',
    'Small decisions now can echo through the rest of the story...',
    'The next scene is finding its rhythm...',
    'The first beat is doing extra work behind the curtain...',
    'New branches often begin with tiny, unexpected turns...',
    'Your story is gathering scene, mood, and momentum...',
  ];

  const cluesToUse = loadingClues?.length > 0 ? loadingClues : defaultClues;
  const backdropStyle = backdropMode === 'blocking'
    ? 'radial-gradient(ellipse at center, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0.64) 58%, rgba(0,0,0,0.84) 100%)'
    : 'radial-gradient(ellipse at center, rgba(0,0,0,0.24) 0%, rgba(0,0,0,0.56) 58%, rgba(0,0,0,0.78) 100%)';
  const activeStepIndex = loadingStage
    ? loadingStage.steps.findIndex((step) => step.key === loadingStage.currentStepKey)
    : -1;

  useEffect(() => {
    loadLoadingUiSettings()
      .then((settings) => setShowNodeLabels(settings.loadingNodeLabelsEnabled))
      .catch(() => setShowNodeLabels(false));
  }, []);

  const currentStep = loadingStage?.steps[activeStepIndex] || null;
  const hoveredStep = loadingStage?.steps.find((step) => step.key === hoveredStepKey) || null;
  const hoveredStepIndex = hoveredStep
    ? loadingStage?.steps.findIndex((step) => step.key === hoveredStep.key) ?? -1
    : -1;
  const hoveredStepIsFirst = hoveredStepIndex === 0;
  const hoveredStepIsLast = loadingStage ? hoveredStepIndex === loadingStage.steps.length - 1 : false;
  const hoveredStepLeftPercent =
    hoveredStep &&
    loadingStage &&
    loadingStage.steps.length > 1 &&
    hoveredStepIndex > 0 &&
    hoveredStepIndex < loadingStage.steps.length - 1
      ? `${(hoveredStepIndex / (loadingStage.steps.length - 1)) * 100}%`
      : '50%';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 ${className}`}
      style={{ background: backdropStyle }}
    >
      <div className="relative w-full max-w-2xl overflow-hidden rounded-[2rem] border border-white/12 bg-neutral-950/42 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-neutral-950/62 via-neutral-950/38 to-neutral-950/62" />
        <div className="relative p-7 md:p-8">
          <div className="space-y-6">
            <RotatingClue
              key={`${loadingStage?.currentStepKey || 'idle'}:${cluesToUse.length}`}
              clues={cluesToUse}
              clueKey={loadingStage?.currentStepKey || 'clue'}
            />

            {loadingStage && (
              <div className="space-y-5 text-left">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-sans uppercase tracking-[0.35em] text-neutral-400">
                      {loadingStage.flow === 'start_story' ? 'Starting your story' : 'Continuing your story'}
                    </p>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                  </div>
                  <h2 className="mt-3 text-2xl font-serif text-neutral-50 md:text-[2rem]">
                    {currentStep?.label || 'Working'}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-200/90 md:text-base">
                    {loadingStage.detail}
                  </p>
                </div>

                <div className={showNodeLabels ? 'relative space-y-3 pt-2' : 'relative pt-1'}>
                  <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-3 h-0 overflow-visible">
                    <AnimatePresence mode="wait">
                      {hoveredStep && (
                        <motion.div
                          key={hoveredStep.key}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.08 }}
                          style={
                            hoveredStepIsFirst
                              ? { left: 0 }
                              : hoveredStepIsLast
                              ? { right: 0 }
                              : { left: hoveredStepLeftPercent }
                          }
                          className={`absolute inline-flex rounded-2xl border border-white/12 bg-neutral-950/88 px-4 py-3 text-sm text-neutral-100 shadow-[0_20px_40px_rgba(0,0,0,0.28)] backdrop-blur-md ${
                            hoveredStepIsFirst || hoveredStepIsLast ? 'translate-x-0' : '-translate-x-1/2'
                          }`}
                        >
                          {hoveredStep.tooltip}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex items-center">
                    {loadingStage.steps.map((step, index) => {
                      const isComplete = activeStepIndex > index;
                      const isActive = activeStepIndex === index;
                      const nodeClass = isComplete
                        ? 'border-emerald-300 bg-emerald-300 shadow-[0_0_0_6px_rgba(16,185,129,0.12)]'
                        : isActive
                        ? 'border-emerald-300 bg-emerald-400/35 shadow-[0_0_0_8px_rgba(16,185,129,0.12)]'
                        : 'border-white/20 bg-white/5';
                      const connectorClass = activeStepIndex > index
                        ? 'bg-emerald-300/75'
                        : 'bg-white/12';

                      return (
                        <div key={step.key} className="group flex flex-1 items-center last:flex-none">
                          <button
                            type="button"
                            aria-label={`${step.label}. ${step.tooltip}`}
                            onMouseEnter={() => setHoveredStepKey(step.key)}
                            onMouseLeave={() => setHoveredStepKey((current) => (current === step.key ? null : current))}
                            onFocus={() => setHoveredStepKey(step.key)}
                            onBlur={() => setHoveredStepKey((current) => (current === step.key ? null : current))}
                            className={`h-4 w-4 shrink-0 rounded-full border transition-colors cursor-pointer ${nodeClass}`}
                          />
                          {index < loadingStage.steps.length - 1 && (
                            <div className={`mx-2 h-[2px] flex-1 rounded-full transition-colors ${connectorClass}`} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {showNodeLabels && (
                    <div className="grid grid-cols-5 gap-2">
                      {loadingStage.steps.map((step, index) => {
                        const isActive = activeStepIndex === index;
                        const isComplete = activeStepIndex > index;
                        return (
                          <p
                            key={step.key}
                            className={`text-center text-[10px] font-sans uppercase tracking-[0.18em] ${
                              isActive ? 'text-emerald-200' : isComplete ? 'text-neutral-300' : 'text-neutral-500'
                            }`}
                          >
                            {step.label}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>

                {loadingStage.flow === 'start_story' && (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-relaxed text-neutral-200/85">
                    The first beat usually takes a little longer while Kissago sets the scene and prepares your characters.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
