'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStoryStore, type LoadingReaderState } from '@/lib/store/story-store';
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
  loadingReaderAnticipationMs: number;
  loadingReaderStoryTextEnabled: boolean;
  loadingReaderOptionsEnabled: boolean;
  loadingReaderScrollSpeedPxPerSecond: number;
};

type ReaderMode = 'anticipation' | 'story' | 'fallback';

const AUTO_SCROLL_INTERVAL_MS = 50;
const MANUAL_SCROLL_PAUSE_MS = 5000;
const DEFAULT_LOADING_MESSAGE = 'kissago is weaving the story';

const defaultLoadingUiSettings: LoadingUiSettingsCache = {
  loadingNodeLabelsEnabled: true,
  loadingHintTypewriterEnabled: false,
  loadingReaderAnticipationMs: 10000,
  loadingReaderStoryTextEnabled: true,
  loadingReaderOptionsEnabled: true,
  loadingReaderScrollSpeedPxPerSecond: 24,
};

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

const anticipationLines = [
  'A path has opened.',
  'The choice is settling into the world.',
  'Characters are listening for what changes next.',
  'The scene is gathering color, sound, and consequence.',
];

let loadingUiSettingsCache: LoadingUiSettingsCache | null = null;

async function loadLoadingUiSettings(): Promise<LoadingUiSettingsCache> {
  if (loadingUiSettingsCache) {
    return loadingUiSettingsCache;
  }

  const settings = await getStoryboardSettings();
  loadingUiSettingsCache = {
    loadingNodeLabelsEnabled: settings.loadingNodeLabelsEnabled,
    loadingHintTypewriterEnabled: settings.loadingHintTypewriterEnabled,
    loadingReaderAnticipationMs: settings.loadingReaderAnticipationMs,
    loadingReaderStoryTextEnabled: settings.loadingReaderStoryTextEnabled,
    loadingReaderOptionsEnabled: settings.loadingReaderOptionsEnabled,
    loadingReaderScrollSpeedPxPerSecond: settings.loadingReaderScrollSpeedPxPerSecond,
  };
  return loadingUiSettingsCache;
}

function AnimatedText({
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
    const interval = window.setInterval(() => {
      index += 1;
      setTypedText(text.slice(0, index));
      if (index >= text.length) {
        window.clearInterval(interval);
      }
    }, 28);

    return () => window.clearInterval(interval);
  }, [text, typewriterEnabled]);

  return <>{typewriterEnabled ? typedText : text}</>;
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();

    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  return prefersReducedMotion;
}

function buildReaderFallback(reader: LoadingReaderState | null): LoadingReaderState {
  return reader || {
    flow: 'start_story',
    startedAt: Date.now(),
    storyTextReadyAt: null,
    message: DEFAULT_LOADING_MESSAGE,
    selectedOptionLabel: null,
    fallbackTitle: null,
    fallbackText: null,
    generatedStoryText: null,
    generatedOptions: [],
  };
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function LoadingReaderPanel({
  reader,
  clues,
  settings,
}: {
  reader: LoadingReaderState | null;
  clues: string[];
  settings: LoadingUiSettingsCache;
}) {
  const resolvedReader = useMemo(() => buildReaderFallback(reader), [reader]);
  const prefersReducedMotion = usePrefersReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const storyEndRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [manualPauseUntil, setManualPauseUntil] = useState(0);
  const [storyHasReachedEnd, setStoryHasReachedEnd] = useState(false);
  const [currentAnticipationIndex, setCurrentAnticipationIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

  const elapsedMs = Math.max(0, now - resolvedReader.startedAt);
  const storyTextAllowed = settings.loadingReaderStoryTextEnabled;
  const mode: ReaderMode = storyTextAllowed && resolvedReader.generatedStoryText
    ? 'story'
    : storyTextAllowed && elapsedMs >= settings.loadingReaderAnticipationMs
    ? 'fallback'
    : 'anticipation';
  const generatedOptions = resolvedReader.generatedOptions || [];
  const showOptionsPreview = settings.loadingReaderOptionsEnabled && mode === 'story' && storyHasReachedEnd && generatedOptions.length > 0;
  const anticipationItems = useMemo(
    () => dedupeLines([
      resolvedReader.message || DEFAULT_LOADING_MESSAGE,
      ...anticipationLines,
      ...clues.slice(0, 4),
    ]),
    [clues, resolvedReader.message]
  );
  const contentKey = [
    mode,
    resolvedReader.startedAt,
    resolvedReader.storyTextReadyAt,
    generatedOptions.length,
  ].join(':');

  const pauseAutoScroll = () => {
    setManualPauseUntil(Date.now() + MANUAL_SCROLL_PAUSE_MS);
  };
  const activeAnticipationLine = anticipationItems.length > 1
    ? anticipationItems[(currentAnticipationIndex % (anticipationItems.length - 1)) + 1] ?? 'The next beat is taking shape.'
    : 'The next beat is taking shape.';

  const updateStoryEndState = useCallback(() => {
    const scrollEl = scrollRef.current;
    const markerEl = storyEndRef.current;
    if (!scrollEl || !markerEl || mode !== 'story') {
      return;
    }

    const markerReached = markerEl.offsetTop <= scrollEl.scrollTop + scrollEl.clientHeight - 16;
    const contentFits = scrollEl.scrollHeight <= scrollEl.clientHeight + 4;
    setStoryHasReachedEnd(markerReached || contentFits);
  }, [mode]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    scrollEl.scrollTop = 0;

    const frame = window.requestAnimationFrame(() => {
      setStoryHasReachedEnd(false);
      updateStoryEndState();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode, resolvedReader.storyTextReadyAt, resolvedReader.generatedStoryText, updateStoryEndState]);

  useEffect(() => {
    if (prefersReducedMotion || mode === 'anticipation' || now < manualPauseUntil) {
      return;
    }

    const scrollStepPx = Math.max(
      0.25,
      (settings.loadingReaderScrollSpeedPxPerSecond * AUTO_SCROLL_INTERVAL_MS) / 1000
    );

    const interval = window.setInterval(() => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;

      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      if (maxScroll <= 0 || scrollEl.scrollTop >= maxScroll - 1) {
        updateStoryEndState();
        return;
      }

      scrollEl.scrollTop = Math.min(maxScroll, scrollEl.scrollTop + scrollStepPx);
      updateStoryEndState();
    }, AUTO_SCROLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [manualPauseUntil, mode, now, prefersReducedMotion, settings.loadingReaderScrollSpeedPxPerSecond, updateStoryEndState]);

  useEffect(() => {
    if (mode !== 'anticipation' || anticipationItems.length <= 2) {
      return;
    }

    const interval = window.setInterval(() => {
      setCurrentAnticipationIndex((current) => current + 1);
    }, settings.loadingHintTypewriterEnabled ? 5200 : 3600);

    return () => window.clearInterval(interval);
  }, [anticipationItems.length, mode, settings.loadingHintTypewriterEnabled]);

  return (
    <div className="relative h-[min(18rem,34dvh)] min-h-[12rem] overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-[0_16px_40px_rgba(0,0,0,0.16)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-neutral-950/88 to-transparent" />
      <div
        ref={scrollRef}
        onScroll={updateStoryEndState}
        onWheel={pauseAutoScroll}
        onTouchStart={pauseAutoScroll}
        onPointerDown={pauseAutoScroll}
        className="h-full overflow-y-auto scrollbar-none px-5 py-5 md:px-7 md:py-6"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={contentKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="min-h-full"
          >
            {mode === 'anticipation' && (
              <div className="flex min-h-full flex-col justify-center gap-3 text-center">
                <p className="text-xl font-serif italic leading-relaxed text-neutral-50 md:text-2xl">
                  {resolvedReader.message || DEFAULT_LOADING_MESSAGE}
                </p>
                <AnimatePresence mode="wait">
                  <motion.p
                    key={`${activeAnticipationLine}-${settings.loadingHintTypewriterEnabled ? 'typed' : 'plain'}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    className="mx-auto max-w-xl text-sm leading-relaxed text-neutral-300 md:text-base"
                  >
                    <AnimatedText
                      key={`${activeAnticipationLine}-${settings.loadingHintTypewriterEnabled ? 'typed' : 'plain'}`}
                      text={activeAnticipationLine}
                      typewriterEnabled={settings.loadingHintTypewriterEnabled}
                    />
                  </motion.p>
                </AnimatePresence>
              </div>
            )}

            {mode === 'fallback' && (
              <div className="mx-auto max-w-xl space-y-5 text-left">
                <div>
                  <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-emerald-300/80">
                    {resolvedReader.selectedOptionLabel ? 'Chosen path' : 'Story seed'}
                  </p>
                  {resolvedReader.selectedOptionLabel && (
                    <p className="mt-2 text-lg font-serif italic leading-relaxed text-neutral-100 md:text-xl">
                      {resolvedReader.selectedOptionLabel}
                    </p>
                  )}
                </div>
                {resolvedReader.fallbackTitle && (
                  <h3 className="text-xl font-serif leading-snug text-neutral-50 md:text-2xl">
                    {resolvedReader.fallbackTitle}
                  </h3>
                )}
                <p className="text-base font-serif leading-relaxed text-neutral-300 md:text-lg">
                  {resolvedReader.fallbackText || 'The next beat is still taking shape.'}
                </p>
              </div>
            )}

            {mode === 'story' && (
              <div className="mx-auto max-w-xl space-y-6 text-left">
                <div>
                  <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-emerald-300/80">
                    New beat
                  </p>
                  {resolvedReader.selectedOptionLabel && (
                    <p className="mt-2 text-sm font-sans leading-relaxed text-neutral-400">
                      {resolvedReader.selectedOptionLabel}
                    </p>
                  )}
                </div>
                <p className="text-lg font-serif leading-relaxed text-neutral-100 md:text-xl">
                  {resolvedReader.generatedStoryText}
                </p>
                <div ref={storyEndRef} className="h-px" />
                {showOptionsPreview && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="space-y-3 border-t border-white/10 pt-5"
                  >
                    <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-neutral-500">
                      What may open next
                    </p>
                    {generatedOptions.map((option) => (
                      <div key={option.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                        <p className="font-serif text-base leading-snug text-neutral-100">
                          {option.label}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-neutral-500">
                          {option.intent}
                        </p>
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-14 bg-gradient-to-t from-neutral-950/90 to-transparent" />
    </div>
  );
}

export default function LoadingState({
  backdropMode = 'scene',
  className = '',
}: LoadingStateProps) {
  const loadingClues = useStoryStore((state) => state.loadingClues);
  const loadingStage = useStoryStore((state) => state.loadingStage);
  const loadingReader = useStoryStore((state) => state.loadingReader);
  const autoBuildProgress = useStoryStore((state) => state.autoBuildProgress);
  const [loadingUiSettings, setLoadingUiSettings] = useState(
    loadingUiSettingsCache ?? defaultLoadingUiSettings
  );
  const [hoveredStepKey, setHoveredStepKey] = useState<string | null>(null);

  const cluesToUse = loadingClues?.length > 0 ? loadingClues : defaultClues;
  const backdropStyle = backdropMode === 'blocking'
    ? 'radial-gradient(ellipse at center, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0.64) 58%, rgba(0,0,0,0.84) 100%)'
    : 'radial-gradient(ellipse at center, rgba(0,0,0,0.24) 0%, rgba(0,0,0,0.56) 58%, rgba(0,0,0,0.78) 100%)';
  const activeStepIndex = loadingStage
    ? loadingStage.steps.findIndex((step) => step.key === loadingStage.currentStepKey)
    : -1;

  useEffect(() => {
    loadLoadingUiSettings()
      .then((settings) => setLoadingUiSettings(settings))
      .catch(() => setLoadingUiSettings(defaultLoadingUiSettings));
  }, []);

  const showNodeLabels = loadingUiSettings.loadingNodeLabelsEnabled;

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
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 py-4 ${className}`}
      style={{ background: backdropStyle }}
    >
      <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-white/12 bg-neutral-950/42 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-neutral-950/62 via-neutral-950/38 to-neutral-950/62" />
        <div className="relative p-5 md:p-8">
          <div className="space-y-5 md:space-y-6">
            <LoadingReaderPanel
              key={loadingReader?.startedAt || 'fallback'}
              reader={loadingReader}
              clues={cluesToUse}
              settings={loadingUiSettings}
            />

            {loadingStage && (
              <div className="space-y-5 text-left">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-sans uppercase tracking-[0.35em] text-neutral-400">
                      {autoBuildProgress?.active
                        ? 'Auto-building your story'
                        : loadingStage.flow === 'start_story' ? 'Starting your story' : 'Continuing your story'}
                    </p>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                    {autoBuildProgress?.active && (
                      <span className="ml-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-sans uppercase tracking-[0.18em] text-emerald-200">
                        Beat {Math.min(Math.max(autoBuildProgress.current, 1), autoBuildProgress.total)} of {autoBuildProgress.total}
                      </span>
                    )}
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
                    <div
                      className="grid gap-2"
                      style={{ gridTemplateColumns: `repeat(${loadingStage.steps.length}, minmax(0, 1fr))` }}
                    >
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
