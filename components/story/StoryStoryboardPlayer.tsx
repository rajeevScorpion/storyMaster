'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { probeStoryAudioDurationMs } from '@/lib/storyboard/audio-duration';
import { getStoryboardPanelCropStyle, STORYBOARD_PANEL_SEQUENCE } from '@/lib/storyboard/layout';
import { getEqualSplitStoryboardPanel } from '@/lib/storyboard/timing';
import type { StoryBeat } from '@/lib/types/story';

import ReelCaptionOverlay, { ReelTimedCaptionText } from './ReelCaptionOverlay';
import StoryboardVignette from './StoryboardVignette';

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
  textOverlayEnabled?: boolean;
  textOverlayStyle?: StoryBeat['reelTextOverlayStyle'];
  textHighlightSupported?: boolean;
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
  textOverlayEnabled = true,
  textOverlayStyle,
  textHighlightSupported = true,
}: StoryStoryboardPlayerProps) {
  const [intervalPanel, setIntervalPanel] = useState(0);
  const [probedDuration, setProbedDuration] = useState<{ audioUrl: string; durationMs: number } | null>(null);
  const hasAudio = Boolean(audioUrl);
  const resolvedAudioDurationMs = audioDurationMs > 0
    ? audioDurationMs
    : probedDuration && probedDuration.audioUrl === audioUrl
      ? probedDuration.durationMs
      : 0;
  const panelDurationMs = cycleOverride ? cycleMs : STORYBOARD_ADVANCE_MS;

  useEffect(() => {
    if (!audioUrl || audioDurationMs > 0 || cycleOverride) return;
    const controller = new AbortController();
    probeStoryAudioDurationMs(audioUrl, controller.signal).then((durationMs) => {
      if (durationMs > 0) setProbedDuration({ audioUrl, durationMs });
    });
    return () => controller.abort();
  }, [audioDurationMs, audioUrl, cycleOverride]);

  useEffect(() => {
    if (hasAudio && !cycleOverride) return;
    const shouldCycle = !hasAudio || cycleOverride || playbackState === 'playing';
    if (!shouldCycle) return;
    const id = window.setInterval(
      () => setIntervalPanel((panel) => Math.min(panel + 1, 3)),
      panelDurationMs
    );
    return () => window.clearInterval(id);
  }, [cycleOverride, hasAudio, panelDurationMs, playbackState]);

  const activePanel = hasAudio && !cycleOverride
    ? resolvedAudioDurationMs > 0
      ? getEqualSplitStoryboardPanel(audioElapsedMs, resolvedAudioDurationMs)
      : 0
    : intervalPanel;
  const activeCaptionObj = textOverlayEnabled
    ? captions?.find((caption) => caption.panelIndex === activePanel)
    : undefined;
  const activeCaption = activeCaptionObj?.text;
  const activeCaptionWordTimings = textHighlightSupported ? activeCaptionObj?.wordTimings : undefined;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className={`absolute inset-0 overflow-hidden ${imageClassName ?? ''}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activePanel}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
            className="absolute inset-0 overflow-hidden"
          >
            <div className="absolute" style={getStoryboardPanelCropStyle(activePanel)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={gridUrl}
                alt=""
                className="h-full w-full object-cover"
                onLoad={onImageLoad}
                onError={onImageError}
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <StoryboardVignette enabled={vignetteEnabled} amountPercent={vignetteAmountPercent} />
      {activeCaption && (
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
