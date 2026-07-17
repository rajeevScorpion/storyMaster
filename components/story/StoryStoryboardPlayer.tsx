'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { probeStoryAudioDurationMs } from '@/lib/storyboard/audio-duration';
import { getStoryboardPanelCropStyle, STORYBOARD_PANEL_SEQUENCE } from '@/lib/storyboard/layout';
import {
  getStoryboardPanelFromNarrationTiming,
  normalizeStoryboardNarrationTiming,
} from '@/lib/storyboard/narration-timing';
import { getEqualSplitStoryboardPanel } from '@/lib/storyboard/timing';
import type { StoryBeat } from '@/lib/types/story';
import type { ActiveStoryTransition } from '@/lib/hooks/useStoryTransitionPlayback';
import { getStoryMotionFrame } from '@/lib/story-effects/renderer';
import { normalizeStoryEffectConfig, storyEffectConfigEnabled, type StoryEffectConfig } from '@/lib/story-effects/settings';
import {
  normalizeStoryTransitionSettings,
  type StoryTransitionSettings,
} from '@/lib/story-transitions/settings';
import { getStoryTransitionFlashOpacity, getStoryTransitionLayerStyle } from '@/lib/story-transitions/render';

import ReelCaptionOverlay, { ReelTimedCaptionText } from './ReelCaptionOverlay';
import StoryTextOverlay from './StoryTextOverlay';
import StoryboardVignette from './StoryboardVignette';
import StoryEffectsLayer from './StoryEffectsLayer';

interface StoryStoryboardPlayerProps {
  gridUrl: string;
  audioUrl?: string;
  audioElapsedMs?: number;
  audioDurationMs?: number;
  cycleOverride: boolean;
  cycleMs: number;
  vignetteEnabled: boolean;
  vignetteAmountPercent: number;
  playbackState: 'idle' | 'playing' | 'paused';
  onImageError?: () => void;
  onImageLoad?: () => void;
  imageClassName?: string;
  showIndicators?: boolean;
  captions?: StoryBeat['reelCaptions'];
  narrationTiming?: StoryBeat['storyboardNarrationTiming'];
  textOverlayEnabled?: boolean;
  textOverlayStyle?: StoryBeat['reelTextOverlayStyle'];
  textHighlightSupported?: boolean;
  storyTextOverlayCaptions?: StoryBeat['storyTextOverlayCaptions'];
  storyTextOverlayEnabled?: boolean;
  storyTextOverlayMode?: StoryBeat['storyTextOverlayMode'];
  storyTextOverlayStyle?: StoryBeat['storyTextOverlayStyle'];
  storyTextOverlayWordsPerLine?: number;
  storyTextOverlayTextHighlightSupported?: boolean;
  storyTransitionSettings?: StoryTransitionSettings;
  activeStoryTransition?: ActiveStoryTransition | null;
  storyEffects?: StoryEffectConfig;
  effectSeed?: string;
  /**
   * Reader-only opt-in: enables swipe + tappable dots + sliding transition so
   * the viewer can browse storyboard panels by hand. Left off for the reel /
   * export render paths, which stay purely auto-advancing.
   */
  interactive?: boolean;
  /** Controlled manual panel override (from the parent). `null` = auto-advance. */
  manualPanel?: number | null;
  /** Fired when the viewer swipes or taps a dot to a new panel. */
  onPanelSelect?: (panelIndex: number) => void;
  /** Fired whenever the displayed panel changes (auto or manual) so the reader text can sync. */
  onActivePanelChange?: (panelIndex: number) => void;
}

const SWIPE_THRESHOLD_PX = 40;
const SWIPE_HINT_STORAGE_KEY = 'kissago:storyboard-swipe-hint-seen';

const slideVariants = {
  enter: (direction: number) => ({ x: direction >= 0 ? '100%' : '-100%' }),
  center: { x: '0%' },
  exit: (direction: number) => ({ x: direction >= 0 ? '-100%' : '100%' }),
};

export default function StoryStoryboardPlayer({
  gridUrl,
  audioUrl,
  audioElapsedMs = 0,
  audioDurationMs = 0,
  cycleOverride,
  cycleMs,
  vignetteEnabled,
  vignetteAmountPercent,
  playbackState,
  onImageError,
  onImageLoad,
  imageClassName,
  showIndicators = true,
  captions,
  narrationTiming,
  textOverlayEnabled = true,
  textOverlayStyle,
  textHighlightSupported = true,
  storyTextOverlayCaptions,
  storyTextOverlayEnabled = true,
  storyTextOverlayMode = 'word',
  storyTextOverlayStyle,
  storyTextOverlayWordsPerLine = 7,
  storyTextOverlayTextHighlightSupported = true,
  storyTransitionSettings,
  activeStoryTransition = null,
  storyEffects,
  effectSeed = gridUrl,
  interactive = false,
  manualPanel = null,
  onPanelSelect,
  onActivePanelChange,
}: StoryStoryboardPlayerProps) {
  const [intervalPanel, setIntervalPanel] = useState(0);
  const [ambientElapsedMs, setAmbientElapsedMs] = useState(0);
  const [probedDuration, setProbedDuration] = useState<{ audioUrl: string; durationMs: number } | null>(null);
  // Fade the grid in on first load so a freshly-rendered beat image reveals
  // smoothly instead of snapping in when its bytes arrive. Comparing the loaded
  // URL to the current gridUrl auto-resets on a new beat (the state still holds
  // the previous URL until the new image loads); once loaded, panel switches
  // within the same grid stay fully opaque since the grid is cached.
  const [loadedGridUrl, setLoadedGridUrl] = useState<string | null>(null);
  const gridRevealed = loadedGridUrl === gridUrl;
  const hasAudio = Boolean(audioUrl);
  const resolvedAudioDurationMs = audioDurationMs > 0
    ? audioDurationMs
    : probedDuration && probedDuration.audioUrl === audioUrl
      ? probedDuration.durationMs
      : 0;
  const validNarrationTiming = normalizeStoryboardNarrationTiming(
    narrationTiming,
    resolvedAudioDurationMs
  );
  const useNarrationTimeline = hasAudio && resolvedAudioDurationMs > 0;
  const panelDurationMs = cycleOverride ? cycleMs : STORYBOARD_ADVANCE_MS;

  useEffect(() => {
    if (!audioUrl || audioDurationMs > 0) return;
    const controller = new AbortController();
    probeStoryAudioDurationMs(audioUrl, controller.signal).then((durationMs) => {
      if (durationMs > 0) setProbedDuration({ audioUrl, durationMs });
    });
    return () => controller.abort();
  }, [audioDurationMs, audioUrl]);

  const panelCount = STORYBOARD_PANEL_SEQUENCE.length;
  // Honour the parent's manual panel on every instance (even non-interactive
  // ones) so the blurred backdrop stays in sync with the surface the viewer is
  // actually driving. `interactive` only gates input (swipe / tappable dots).
  const isManuallyControlled = manualPanel != null;

  useEffect(() => {
    if (useNarrationTimeline) return;
    // While the viewer is browsing panels by hand, freeze the auto-cycle.
    if (isManuallyControlled) return;
    const shouldCycle = !hasAudio || playbackState === 'playing';
    if (!shouldCycle) return;
    const id = window.setInterval(
      () => setIntervalPanel((panel) => Math.min(panel + 1, panelCount - 1)),
      panelDurationMs
    );
    return () => window.clearInterval(id);
  }, [hasAudio, isManuallyControlled, panelCount, panelDurationMs, playbackState, useNarrationTimeline]);

  const autoPanel = useNarrationTimeline
    ? validNarrationTiming
      ? getStoryboardPanelFromNarrationTiming(
          audioElapsedMs,
          resolvedAudioDurationMs,
          validNarrationTiming
        )
      : getEqualSplitStoryboardPanel(audioElapsedMs, resolvedAudioDurationMs)
    : intervalPanel;
  const activePanel = isManuallyControlled
    ? Math.max(0, Math.min(panelCount - 1, Math.floor(manualPanel as number)))
    : autoPanel;

  // Slide direction for the interactive transition: +1 forward, -1 back. Manual
  // swipes/taps set it synchronously; auto-advance is monotonic forward, so when
  // there's no manual override we simply treat it as forward.
  const [manualSlideDirection, setManualSlideDirection] = useState(1);
  const slideDirection = isManuallyControlled ? manualSlideDirection : 1;

  // Keep the parent (reader text) in sync with the displayed panel.
  useEffect(() => {
    onActivePanelChange?.(activePanel);
  }, [activePanel, onActivePanelChange]);

  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const dismissSwipeHint = () => {
    setShowSwipeHint(false);
    try {
      window.localStorage.setItem(SWIPE_HINT_STORAGE_KEY, '1');
    } catch {
      /* ignore storage errors */
    }
  };

  useEffect(() => {
    if (!interactive || !showIndicators || panelCount <= 1) return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(SWIPE_HINT_STORAGE_KEY) === '1';
    } catch {
      seen = false;
    }
    if (seen) return;
    // Defer the reveal into a timer callback (a gentle fade-in) so we never call
    // setState synchronously inside the effect body.
    const showTimer = window.setTimeout(() => setShowSwipeHint(true), 400);
    const hideTimer = window.setTimeout(() => setShowSwipeHint(false), 5400);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [interactive, panelCount, showIndicators]);

  const goToPanel = (panelIndex: number) => {
    dismissSwipeHint();
    const clamped = Math.max(0, Math.min(panelCount - 1, panelIndex));
    if (clamped === activePanel) return;
    // Set direction synchronously so the manual slide animates the right way.
    setManualSlideDirection(clamped > activePanel ? 1 : -1);
    onPanelSelect?.(clamped);
  };

  // Pointer-based swipe (works for touch + mouse drag) on the image area.
  const swipeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const handlePointerDown = (event: ReactPointerEvent) => {
    if (!interactive) return;
    swipeOriginRef.current = { x: event.clientX, y: event.clientY };
  };
  const handlePointerEnd = (event: ReactPointerEvent) => {
    if (!interactive) return;
    const origin = swipeOriginRef.current;
    swipeOriginRef.current = null;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    // Require a clearly horizontal drag past the threshold.
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return;
    goToPanel(activePanel + (dx < 0 ? 1 : -1));
  };

  const useInteractiveSlide = interactive && !activeStoryTransition && panelCount > 1;

  const activeCaptionObj = textOverlayEnabled
    ? captions?.find((caption) => caption.panelIndex === activePanel)
    : undefined;
  const activeCaption = activeCaptionObj?.text;
  const activeCaptionWordTimings = textHighlightSupported ? activeCaptionObj?.wordTimings : undefined;
  const activeStoryTextOverlayCaption = storyTextOverlayEnabled
    ? storyTextOverlayCaptions?.find((caption) => caption.panelIndex === activePanel)
    : undefined;
  const transitionSettings = normalizeStoryTransitionSettings(storyTransitionSettings);
  const useLegacyPanelFade = storyTransitionSettings === undefined;
  const transitionProgress = activeStoryTransition?.progress ?? 0;
  const normalizedEffects = normalizeStoryEffectConfig(storyEffects);
  const effectsEnabled = storyEffectConfigEnabled(normalizedEffects);
  const effectElapsedMs = hasAudio ? audioElapsedMs : ambientElapsedMs;
  useEffect(() => {
    if (hasAudio || !effectsEnabled) return;
    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      setAmbientElapsedMs(now - startedAt);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [effectsEnabled, gridUrl, hasAudio]);
  const panelBoundaries = validNarrationTiming
    ? [0, ...validNarrationTiming.panelEndTimesMs, resolvedAudioDurationMs]
    : [0, 0.25, 0.5, 0.75, 1].map((value) => value * Math.max(resolvedAudioDurationMs, panelDurationMs * 4));
  const panelProgress = (panelIndex: number) => {
    const startMs = panelBoundaries[panelIndex] ?? 0;
    const endMs = panelBoundaries[panelIndex + 1] ?? startMs + panelDurationMs;
    return Math.max(0, Math.min(1, (effectElapsedMs - startMs) / Math.max(1, endMs - startMs)));
  };
  const transitionLayerStyle = (layer: 'from' | 'to') => {
    if (!activeStoryTransition) return { opacity: 1 };
    return getStoryTransitionLayerStyle(transitionSettings, transitionProgress, layer);
  };
  const renderPanel = (panelIndex: number, layer?: 'from' | 'to') => {
    const motionFrame = getStoryMotionFrame(normalizedEffects, panelProgress(panelIndex));
    return (
    <div
      // Keyed so a panel switch mounts a fresh element: the transform
      // transition below must never animate across the panel cut.
      key={panelIndex}
      className="absolute inset-0 overflow-hidden"
      style={layer ? transitionLayerStyle(layer) : undefined}
    >
      <div className="absolute" style={getStoryboardPanelCropStyle(panelIndex)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={gridUrl}
          alt=""
          className="h-full w-full object-cover"
          onLoad={() => {
            setLoadedGridUrl(gridUrl);
            onImageLoad?.();
          }}
          onError={onImageError}
          style={effectsEnabled && normalizedEffects.motion.enabled ? {
            // translate3d + will-change keep the pan/zoom on the compositor;
            // the short linear transition interpolates between the ~50ms
            // narration clock ticks that drive re-renders, which otherwise
            // show as stair-stepped motion.
            transform: `translate3d(${motionFrame.translateXPercent}%, ${motionFrame.translateYPercent}%, 0) scale(${motionFrame.scale})`,
            transformOrigin: 'center',
            willChange: 'transform',
            opacity: gridRevealed ? 1 : 0,
            transition: layer ? 'opacity 500ms ease-out' : 'transform 120ms linear, opacity 500ms ease-out',
          } : {
            opacity: gridRevealed ? 1 : 0,
            transition: 'opacity 500ms ease-out',
          }}
        />
      </div>
    </div>
    );
  };
  const renderStoryOverlay = (panelIndex: number, layer?: 'from' | 'to') => {
    const caption = storyTextOverlayEnabled
      ? storyTextOverlayCaptions?.find((item) => item.panelIndex === panelIndex)
      : undefined;
    if (!caption) return null;
    return (
      <div className="pointer-events-none absolute inset-0 z-20" style={layer ? transitionLayerStyle(layer) : undefined}>
        <StoryTextOverlay
          caption={caption}
          enabled={storyTextOverlayEnabled}
          mode={storyTextOverlayMode}
          style={storyTextOverlayStyle}
          elapsedMs={hasAudio ? audioElapsedMs : null}
          isPlaying={playbackState === 'playing'}
          wordsPerLine={storyTextOverlayWordsPerLine}
          textHighlightSupported={storyTextOverlayTextHighlightSupported}
        />
      </div>
    );
  };

  return (
    <div
      className={`absolute inset-0 overflow-hidden ${interactive ? 'touch-pan-y select-none' : ''}`}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerUp={interactive ? handlePointerEnd : undefined}
      onPointerCancel={interactive ? () => { swipeOriginRef.current = null; } : undefined}
    >
      <div className={`absolute inset-0 overflow-hidden ${imageClassName ?? ''}`}>
        {activeStoryTransition ? (
          <>
            {renderPanel(activeStoryTransition.fromIndex, 'from')}
            {renderPanel(activeStoryTransition.toIndex, 'to')}
          </>
        ) : useInteractiveSlide ? (
          <AnimatePresence initial={false} custom={slideDirection}>
            <motion.div
              key={activePanel}
              custom={slideDirection}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ x: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }}
              className="absolute inset-0 overflow-hidden"
            >
              {renderPanel(activePanel)}
            </motion.div>
          </AnimatePresence>
        ) : useLegacyPanelFade ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={activePanel}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: 'easeInOut' }}
              className="absolute inset-0 overflow-hidden"
            >
              {renderPanel(activePanel)}
            </motion.div>
          </AnimatePresence>
        ) : renderPanel(activePanel)}
      </div>
      {effectsEnabled && (
        <StoryEffectsLayer
          config={normalizedEffects}
          elapsedMs={effectElapsedMs}
          playbackState={hasAudio ? playbackState : 'playing'}
          seed={effectSeed}
        />
      )}
      {activeStoryTransition && getStoryTransitionFlashOpacity(transitionSettings, transitionProgress) > 0 && (
        <div className="pointer-events-none absolute inset-0 z-[15] bg-white" style={{ opacity: getStoryTransitionFlashOpacity(transitionSettings, transitionProgress) }} />
      )}
      <StoryboardVignette enabled={vignetteEnabled} amountPercent={vignetteAmountPercent} />
      {activeStoryTransition ? (
        <>
          {renderStoryOverlay(activeStoryTransition.fromIndex, 'from')}
          {renderStoryOverlay(activeStoryTransition.toIndex, 'to')}
        </>
      ) : activeStoryTextOverlayCaption ? (
        renderStoryOverlay(activePanel)
      ) : activeCaption && (
        <ReelCaptionOverlay style={textOverlayStyle}>
          <ReelTimedCaptionText
            text={activeCaption}
            wordTimings={activeCaptionWordTimings}
            elapsedMs={hasAudio ? audioElapsedMs : null}
            isPlaying={playbackState === 'playing'}
            style={textOverlayStyle}
          />
        </ReelCaptionOverlay>
      )}
      {interactive && showIndicators && (
        <AnimatePresence>
          {showSwipeHint && (
            <motion.div
              key="swipe-hint"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.35 }}
              className="pointer-events-none absolute bottom-9 left-1/2 z-30 -translate-x-1/2"
            >
              <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-3 py-1 text-[11px] font-sans tracking-wide text-white/85 shadow-lg backdrop-blur-sm">
                <ChevronLeft className="h-3.5 w-3.5 animate-pulse" />
                <span>swipe</span>
                <ChevronRight className="h-3.5 w-3.5 animate-pulse" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
      {showIndicators && (
        <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1">
          {STORYBOARD_PANEL_SEQUENCE.map((_, panelIndex) => (
            interactive ? (
              // Small dot, generous invisible hit area (~28px) so it's easy to tap.
              <button
                key={panelIndex}
                type="button"
                aria-label={`Show panel ${panelIndex + 1}`}
                aria-current={panelIndex === activePanel}
                onClick={() => goToPanel(panelIndex)}
                onPointerDown={(event) => event.stopPropagation()}
                className="pointer-events-auto flex cursor-pointer items-center justify-center px-1.5 py-2.5"
              >
                <span
                  className={`block h-2 rounded-full transition-all duration-300 ${
                    panelIndex === activePanel
                      ? 'w-5 bg-white/90'
                      : 'w-2 bg-white/40 hover:bg-white/70'
                  }`}
                />
              </button>
            ) : (
              <div
                key={panelIndex}
                className={`mx-0.5 mb-2 h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                  panelIndex === activePanel ? 'scale-125 bg-white/70' : 'bg-white/25'
                }`}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}
