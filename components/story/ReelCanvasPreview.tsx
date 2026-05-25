'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoryBeat } from '@/lib/types/story';
import type { ReelTextOverlayStyle } from '@/lib/reel/styles';
import type { ReelTransitionSettings } from '@/lib/reel/transitions';
import { toReelFetchUrl } from '@/lib/reel/media';
import { buildReelTimeline, getReelSceneAtTime } from '@/lib/reel/timeline';
import {
  drawReelFrame,
  loadReelImageAssets,
  releaseReelImageAssets,
  type ReelImageAssets,
} from '@/lib/reel/renderer';

interface ReelCanvasPreviewProps {
  beat: StoryBeat;
  imageUrl: string;
  audioDurationMs: number;
  elapsedMs: number;
  textOverlayEnabled: boolean;
  textOverlayStyle?: ReelTextOverlayStyle;
  transitionSettings: ReelTransitionSettings;
  vignetteEnabled: boolean;
  vignetteAmountPercent: number;
  sequence?: ReelPreviewBeat[];
  currentNodeId?: string;
  playAllActive?: boolean;
  onImageLoad?: () => void;
  onImageError?: () => void;
}

export interface ReelPreviewBeat {
  beat: StoryBeat;
  imageUrl: string;
  audioUrl?: string;
  nodeId: string;
}

const PREVIEW_WIDTH = 425;
const PREVIEW_HEIGHT = Math.round(PREVIEW_WIDTH * 16 / 9);

function probeDurationMs(audioUrl: string | undefined): Promise<number> {
  if (!audioUrl) return Promise.resolve(0);
  return new Promise((resolve) => {
    const audio = new Audio();
    const cleanUp = () => {
      audio.src = '';
    };
    audio.addEventListener('loadedmetadata', () => {
      const durationMs = audio.duration * 1000;
      cleanUp();
      resolve(Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0);
    });
    audio.addEventListener('error', () => {
      cleanUp();
      resolve(0);
    });
    audio.src = audioUrl;
  });
}

export default function ReelCanvasPreview({
  beat,
  imageUrl,
  audioDurationMs,
  elapsedMs,
  textOverlayEnabled,
  textOverlayStyle,
  transitionSettings,
  vignetteEnabled,
  vignetteAmountPercent,
  sequence,
  currentNodeId,
  playAllActive = false,
  onImageLoad,
  onImageError,
}: ReelCanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onImageLoadRef = useRef(onImageLoad);
  const onImageErrorRef = useRef(onImageError);
  const [assets, setAssets] = useState<ReelImageAssets | null>(null);
  const [sequenceDurationsMs, setSequenceDurationsMs] = useState<number[]>([]);
  const previewSequence = useMemo(() => (
    playAllActive && sequence?.length
      ? sequence
      : [{ beat, imageUrl, audioUrl: beat.audioUrl, nodeId: currentNodeId ?? 'current' }]
  ), [beat, currentNodeId, imageUrl, playAllActive, sequence]);
  const renderSequence = useMemo(() => previewSequence.map((item) => ({
    ...item,
    imageUrl: toReelFetchUrl(item.imageUrl),
  })), [previewSequence]);
  const sequenceKey = useMemo(
    () => previewSequence.map((item) => `${item.nodeId}:${item.imageUrl}:${item.audioUrl ?? ''}`).join('|'),
    [previewSequence]
  );
  const activeIndex = playAllActive
    ? Math.max(0, previewSequence.findIndex((item) => item.nodeId === currentNodeId))
    : 0;
  const timeline = useMemo(() => buildReelTimeline(renderSequence.map((item, index) => ({
    beat: item.beat,
    imageUrl: item.imageUrl,
    durationMs: index === activeIndex && audioDurationMs > 0
      ? audioDurationMs
      : sequenceDurationsMs[index] ?? 0,
  })), transitionSettings, 0), [
    activeIndex,
    audioDurationMs,
    renderSequence,
    sequenceDurationsMs,
    transitionSettings,
  ]);
  const absoluteElapsedMs = playAllActive
    ? timeline.beatDurationsMs.slice(0, activeIndex).reduce((sum, durationMs) => sum + durationMs, 0) + elapsedMs
    : elapsedMs;

  useEffect(() => {
    onImageLoadRef.current = onImageLoad;
    onImageErrorRef.current = onImageError;
  }, [onImageError, onImageLoad]);

  useEffect(() => {
    let alive = true;
    Promise.all(previewSequence.map((item) => probeDurationMs(item.audioUrl)))
      .then((durationsMs) => {
        if (alive) setSequenceDurationsMs(durationsMs);
      });
    return () => {
      alive = false;
    };
    // `sequenceKey` tracks the audio inputs while avoiding reloads for narration time updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceKey]);

  useEffect(() => {
    let alive = true;
    let loadedAssets: ReelImageAssets | null = null;
    loadReelImageAssets(renderSequence.map((item) => item.imageUrl))
      .then((nextAssets) => {
        loadedAssets = nextAssets;
        if (!alive) {
          releaseReelImageAssets(nextAssets);
          return;
        }
        setAssets(nextAssets);
        onImageLoadRef.current?.();
      })
      .catch(() => {
        if (alive) onImageErrorRef.current?.();
      });
    return () => {
      alive = false;
      if (loadedAssets) releaseReelImageAssets(loadedAssets);
    };
    // `sequenceKey` tracks media inputs while preserving loaded bitmaps as playback ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !assets) return;
    drawReelFrame(context, timeline, assets, absoluteElapsedMs, {
      textOverlayEnabled,
      textOverlayStyle,
      vignetteEnabled,
      vignetteAmountPercent,
    });
  }, [absoluteElapsedMs, assets, textOverlayEnabled, textOverlayStyle, timeline, vignetteAmountPercent, vignetteEnabled]);

  const activePanel = getReelSceneAtTime(timeline, absoluteElapsedMs)?.panelIndex ?? 0;

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvasRef}
        width={PREVIEW_WIDTH}
        height={PREVIEW_HEIGHT}
        className="h-full w-full"
      />
      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
        {[0, 1, 2, 3].map((panelIndex) => (
          <div
            key={panelIndex}
            className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
              panelIndex === activePanel ? 'scale-125 bg-white/70' : 'bg-white/25'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
