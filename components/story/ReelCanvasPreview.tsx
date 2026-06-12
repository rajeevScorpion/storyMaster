'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  textHighlightSupported?: boolean;
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
const PREVIEW_IMAGE_ASSET_CACHE_LIMIT = 6;

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const previewImageAssetCache = new Map<string, ReelImageAssets>();

function getCachedPreviewImageAssets(cacheKey: string): ReelImageAssets | null {
  const assets = previewImageAssetCache.get(cacheKey);
  if (!assets) return null;
  previewImageAssetCache.delete(cacheKey);
  previewImageAssetCache.set(cacheKey, assets);
  return assets;
}

function rememberPreviewImageAssets(cacheKey: string, assets: ReelImageAssets): ReelImageAssets {
  const existingAssets = previewImageAssetCache.get(cacheKey);
  if (existingAssets) {
    if (existingAssets !== assets) releaseReelImageAssets(assets);
    previewImageAssetCache.delete(cacheKey);
    previewImageAssetCache.set(cacheKey, existingAssets);
    return existingAssets;
  }

  previewImageAssetCache.set(cacheKey, assets);
  while (previewImageAssetCache.size > PREVIEW_IMAGE_ASSET_CACHE_LIMIT) {
    const oldestKey = previewImageAssetCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldestAssets = previewImageAssetCache.get(oldestKey);
    previewImageAssetCache.delete(oldestKey);
    if (oldestAssets) releaseReelImageAssets(oldestAssets);
  }

  return assets;
}

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
    audio.src = toReelFetchUrl(audioUrl);
  });
}

function stripWordTimings(beat: StoryBeat): StoryBeat {
  if (!beat.reelCaptions?.some((caption) => caption.wordTimings?.length)) return beat;
  return {
    ...beat,
    reelCaptions: beat.reelCaptions.map((caption) => ({
      ...caption,
      wordTimings: undefined,
    })),
  };
}

export default function ReelCanvasPreview({
  beat,
  imageUrl,
  audioDurationMs,
  elapsedMs,
  textOverlayEnabled,
  textOverlayStyle,
  textHighlightSupported = true,
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
  const isBackdrop = surface === 'backdrop';
  const previewSequence = useMemo(() => (
    playAllActive && sequence?.length
      ? sequence
      : [{ beat, imageUrl, audioUrl: beat.audioUrl, nodeId: currentNodeId ?? 'current' }]
  ), [beat, currentNodeId, imageUrl, playAllActive, sequence]);
  const renderSequence = useMemo(() => previewSequence.map((item) => {
    const keepHighlights = playAllActive
      ? item.beat.narrationMetadata?.textHighlightSupported === true
      : textHighlightSupported;
    return {
      ...item,
      beat: keepHighlights ? item.beat : stripWordTimings(item.beat),
      imageUrl: toReelFetchUrl(item.imageUrl),
    };
  }), [playAllActive, previewSequence, textHighlightSupported]);
  const imageAssetsKey = useMemo(
    () => [...new Set(renderSequence.map((item) => item.imageUrl))].join('|'),
    [renderSequence]
  );
  const [assets, setAssets] = useState<ReelImageAssets | null>(() => (
    isBackdrop ? null : getCachedPreviewImageAssets(imageAssetsKey)
  ));
  const [sequenceDurationsMs, setSequenceDurationsMs] = useState<number[]>([]);
  const [backdropSize, setBackdropSize] = useState({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
  const [manualElapsedMs, setManualElapsedMs] = useState<number | null>(null);
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
    const cachedAssets = isBackdrop ? null : getCachedPreviewImageAssets(imageAssetsKey);
    if (cachedAssets) {
      setAssets(cachedAssets);
      onImageLoadRef.current?.();
      return () => {
        alive = false;
      };
    }

    loadReelImageAssets(renderSequence.map((item) => item.imageUrl))
      .then((nextAssets) => {
        loadedAssets = nextAssets;
        const reusableAssets = isBackdrop
          ? nextAssets
          : rememberPreviewImageAssets(imageAssetsKey, nextAssets);
        if (!alive) {
          if (isBackdrop) releaseReelImageAssets(nextAssets);
          return;
        }
        setAssets(reusableAssets);
        onImageLoadRef.current?.();
      })
      .catch(() => {
        if (alive) onImageErrorRef.current?.();
      });
    return () => {
      alive = false;
      if (isBackdrop && loadedAssets) releaseReelImageAssets(loadedAssets);
    };
    // `imageAssetsKey` tracks only image inputs so voice changes do not reload bitmaps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageAssetsKey, isBackdrop]);

  useBrowserLayoutEffect(() => {
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
