'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

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
}

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
}: StoryStoryboardPlayerProps) {
  const [intervalPanel, setIntervalPanel] = useState(0);
  const [probedDuration, setProbedDuration] = useState<{ audioUrl: string; durationMs: number } | null>(null);
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

  useEffect(() => {
    if (useNarrationTimeline) return;
    const shouldCycle = !hasAudio || playbackState === 'playing';
    if (!shouldCycle) return;
    const id = window.setInterval(
      () => setIntervalPanel((panel) => Math.min(panel + 1, 3)),
      panelDurationMs
    );
    return () => window.clearInterval(id);
  }, [hasAudio, panelDurationMs, playbackState, useNarrationTimeline]);

  const activePanel = useNarrationTimeline
    ? validNarrationTiming
      ? getStoryboardPanelFromNarrationTiming(
          audioElapsedMs,
          resolvedAudioDurationMs,
          validNarrationTiming
        )
      : getEqualSplitStoryboardPanel(audioElapsedMs, resolvedAudioDurationMs)
    : intervalPanel;
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
  const panelBoundaries = validNarrationTiming
    ? [0, ...validNarrationTiming.panelEndTimesMs, resolvedAudioDurationMs]
    : [0, 0.25, 0.5, 0.75, 1].map((value) => value * Math.max(resolvedAudioDurationMs, panelDurationMs * 4));
  const panelProgress = (panelIndex: number) => {
    const startMs = panelBoundaries[panelIndex] ?? 0;
    const endMs = panelBoundaries[panelIndex + 1] ?? startMs + panelDurationMs;
    return Math.max(0, Math.min(1, (audioElapsedMs - startMs) / Math.max(1, endMs - startMs)));
  };
  const transitionLayerStyle = (layer: 'from' | 'to') => {
    if (!activeStoryTransition) return { opacity: 1 };
    const incoming = layer === 'to';
    if (transitionSettings.type === 'fade-black') {
      return {
        opacity: incoming
          ? transitionProgress < 0.5 ? 0 : (transitionProgress - 0.5) * 2
          : transitionProgress < 0.5 ? 1 - transitionProgress * 2 : 0,
      };
    }
    if (transitionSettings.type === 'soft-fade') {
      return {
        opacity: incoming ? transitionProgress : 1 - transitionProgress,
        filter: `blur(${(incoming ? 1 - transitionProgress : transitionProgress) * 8}px)`,
      };
    }
    return { opacity: incoming ? transitionProgress : 1 - transitionProgress };
  };
  const renderPanel = (panelIndex: number, layer?: 'from' | 'to') => {
    const motionFrame = getStoryMotionFrame(normalizedEffects, panelProgress(panelIndex));
    return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={layer ? transitionLayerStyle(layer) : undefined}
    >
      <div className="absolute" style={getStoryboardPanelCropStyle(panelIndex)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={gridUrl}
          alt=""
          className="h-full w-full object-cover"
          onLoad={onImageLoad}
          onError={onImageError}
          style={effectsEnabled && normalizedEffects.motion.enabled ? {
            transform: `translate(${motionFrame.translateXPercent}%, ${motionFrame.translateYPercent}%) scale(${motionFrame.scale})`,
            transformOrigin: 'center',
          } : undefined}
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
    <div className="absolute inset-0 overflow-hidden">
      <div className={`absolute inset-0 overflow-hidden ${imageClassName ?? ''}`}>
        {activeStoryTransition ? (
          <>
            {renderPanel(activeStoryTransition.fromIndex, 'from')}
            {renderPanel(activeStoryTransition.toIndex, 'to')}
          </>
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
          elapsedMs={audioElapsedMs}
          playbackState={playbackState}
          seed={effectSeed}
        />
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
      {showIndicators && (
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
          {STORYBOARD_PANEL_SEQUENCE.map((_, panelIndex) => (
            <div
              key={panelIndex}
              className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                panelIndex === activePanel ? 'scale-125 bg-white/70' : 'bg-white/25'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
