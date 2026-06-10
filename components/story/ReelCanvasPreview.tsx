'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  surface?: 'preview' | 'backdrop';
  resetPanelKey?: string;
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
  surface = 'preview',
  resetPanelKey,
  onImageLoad,
  onImageError,
}: ReelCanvasPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onImageLoadRef = useRef(onImageLoad);
  const onImageErrorRef = useRef(onImageError);
  const [assets, setAssets] = useState<ReelImageAssets | null>(null);
  const [sequenceDurationsMs, setSequenceDurationsMs] = useState<number[]>([]);
  const [backdropSize, setBackdropSize] = useState({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
  const [manualElapsedMs, setManualElapsedMs] = useState<number | null>(null);
  const previewSequence = useMemo(() => (
    playAllActive && sequence?.length
      ? sequence
      : [{ beat, imageUrl, audioUrl: beat.audioUrl, nodeId: currentNodeId ?? 'current' }]
  ), [beat, currentNodeId, imageUrl, playAllActive, sequence]);
  const renderSequence = useMemo(() => previewSequence.map((item) => ({
    ...item,
    imageUrl: toReelFetchUrl(item.imageUrl),
  })), [previewSequence]);
  const imageAssetsKey = useMemo(
    () => previewSequence.map((item) => `${item.nodeId}:${item.imageUrl}`).join('|'),
    [previewSequence]
  );
  const audioDurationKey = useMemo(
    () => previewSequence.map((item) => `${item.nodeId}:${item.audioUrl ?? ''}`).join('|'),
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
  const renderElapsedMs = manualElapsedMs ?? absoluteElapsedMs;
  const isBackdrop = surface === 'backdrop';

  useEffect(() => {
    if (!isBackdrop || !containerRef.current) return;
    const container = containerRef.current;
    const updateSize = () => {
      const { width, height } = container.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const next = {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      };
      setBackdropSize((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [isBackdrop]);

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
    // `audioDurationKey` tracks audio inputs while avoiding reloads for narration time updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioDurationKey]);

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
    // `imageAssetsKey` tracks only image inputs so voice changes do not reload bitmaps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageAssetsKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !assets) return;
    drawReelFrame(context, timeline, assets, renderElapsedMs, {
      textOverlayEnabled: !isBackdrop && textOverlayEnabled,
      textOverlayStyle,
      vignetteEnabled: !isBackdrop && vignetteEnabled,
      vignetteAmountPercent,
      visualFit: isBackdrop ? 'cover' : 'fill',
    });
  }, [renderElapsedMs, assets, isBackdrop, textOverlayEnabled, textOverlayStyle, timeline, vignetteAmountPercent, vignetteEnabled]);

  // Clear manual panel override once audio starts advancing
  useEffect(() => {
    if (absoluteElapsedMs > 0) setManualElapsedMs(null);
  }, [absoluteElapsedMs]);

  useEffect(() => {
    setManualElapsedMs(null);
  }, [resetPanelKey]);

  const activePanel = getReelSceneAtTime(timeline, renderElapsedMs)?.panelIndex ?? 0;
  const canvasSize = isBackdrop ? backdropSize : { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT };

  const handlePanelDotClick = useCallback((panelIndex: number) => {
    const scene = timeline.scenes.find((s) => s.beatIndex === activeIndex && s.panelIndex === panelIndex);
    if (scene) setManualElapsedMs(scene.startMs);
  }, [activeIndex, timeline.scenes]);

  return (
    <div ref={containerRef} aria-hidden={isBackdrop || undefined} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className="h-full w-full"
      />
      {!isBackdrop && (
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-2.5">
          {[0, 1, 2, 3].map((panelIndex) => (
            <button
              key={panelIndex}
              type="button"
              onClick={() => handlePanelDotClick(panelIndex)}
              title={`Panel ${panelIndex + 1}`}
              className={`h-2.5 w-2.5 rounded-full transition-all duration-200 cursor-pointer ${
                panelIndex === activePanel ? 'bg-emerald-400 scale-110' : 'bg-white/25 hover:bg-emerald-400/70'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
