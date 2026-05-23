'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { parseR2UrlLikeReference } from '@/lib/media/r2-reference';
import { DEFAULT_VIDEO_EXPORT_PRESET, normalizeVideoExportPreset, type VideoExportPreset } from '@/lib/types/pricing';
import type { StoryAspectRatio, StoryBeat } from '@/lib/types/story';
import { STORYBOARD_PANEL_CROP_INSET_RATIO } from '@/lib/storyboard/layout';
import {
  DEFAULT_REEL_TEXT_OVERLAY_STYLE,
  clampNumber,
  getReelCaptionTopPercent,
  normalizeReelTextOverlayStyle,
  reelColorWithOpacity,
} from '@/lib/reel/styles';

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  const assetBaseURL = new URL('/ffmpeg/', window.location.origin);
  const classWorkerURL = new URL('ffmpeg-worker.js', assetBaseURL).href;
  const coreURL = new URL('ffmpeg-core.js', assetBaseURL).href;
  const wasmURL = new URL('ffmpeg-core.wasm', assetBaseURL).href;

  const ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    console.log('[ffmpeg]', message);
  });

  await ffmpeg.load({ classWorkerURL, coreURL, wasmURL });

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const cleanup = () => {
      audio.src = '';
    };

    audio.addEventListener('loadedmetadata', () => {
      const duration = audio.duration;
      cleanup();
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    });

    audio.addEventListener('error', () => {
      cleanup();
      resolve(0);
    });

    audio.src = url;
  });
}

function toExportFetchUrl(url: string): string {
  const r2Reference = parseR2UrlLikeReference(url);
  if (typeof window === 'undefined') return url;

  const proxyUrl = new URL('/api/media/r2/object', window.location.origin);
  if (r2Reference) {
    proxyUrl.searchParams.set('bucket', r2Reference.bucket);
    proxyUrl.searchParams.set('key', r2Reference.objectKey);
    return proxyUrl.toString();
  }

  try {
    const assetUrl = new URL(url);
    if (
      assetUrl.protocol === 'https:'
      && assetUrl.pathname.startsWith('/stories/')
      && /^media(?:-stage)?\.kissago\.cc$/i.test(assetUrl.hostname)
    ) {
      proxyUrl.searchParams.set('url', assetUrl.toString());
      return proxyUrl.toString();
    }
  } catch {
    // Keep non-URL values untouched.
  }

  return url;
}

const FADE_DURATION = 0.6;
const LANDSCAPE_OUTPUT_WIDTH = 1280;
const LANDSCAPE_OUTPUT_HEIGHT = 720;
const FPS = 24;
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const AUDIO_BITRATE = '96k';
const EXPORT_IMAGE_QUALITY = 0.92;

type ExportCanvasSize = {
  width: number;
  height: number;
};

type BeatSegment = {
  index: number;
  imageUrl: string;
  audioUrl: string | null;
  isStoryboard: boolean;
  panelDuration: number;
  panelDurations: number[];
  totalDuration: number;
  reelCaptions?: StoryBeat['reelCaptions'];
  textOverlayEnabled?: boolean;
  textOverlayStyle?: StoryBeat['reelTextOverlayStyle'];
};

type ReelCaption = NonNullable<StoryBeat['reelCaptions']>[number];

type CaptionFrameSlice = {
  duration: number;
  activeWordIndex?: number;
  isPanelFirst: boolean;
  isPanelLast: boolean;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getStoryboardPanelDurationsSeconds(beat: StoryBeat, audioDuration: number): number[] {
  const fallbackSeconds = STORYBOARD_ADVANCE_MS / 1000;
  const timedCaptions = beat.reelCaptions?.filter((caption) => (
    typeof caption.startMs === 'number'
    && typeof caption.endMs === 'number'
    && caption.endMs > caption.startMs
  ));

  if (timedCaptions?.length) {
    const durations = Array.from({ length: 4 }, (_, panelIndex) => {
      const caption = timedCaptions.find((item) => item.panelIndex === panelIndex);
      return caption ? Math.max(0.5, (caption.endMs! - caption.startMs!) / 1000) : fallbackSeconds;
    });
    const total = durations.reduce((sum, duration) => sum + duration, 0);
    if (audioDuration > 0 && total > 0) {
      const scale = audioDuration / total;
      return durations.map((duration) => Math.max(0.5, duration * scale));
    }
    return durations;
  }

  const equalDuration = audioDuration > 0 ? audioDuration / 4 : fallbackSeconds;
  return [equalDuration, equalDuration, equalDuration, equalDuration];
}

function buildCaptionFrameSlices(
  caption: ReelCaption | undefined,
  panelDurationSeconds: number
): CaptionFrameSlice[] {
  const panelDurationMs = Math.max(1, panelDurationSeconds * 1000);
  const wordTimings = caption?.wordTimings;
  if (!caption || !wordTimings?.length) {
    return [{
      duration: panelDurationSeconds,
      isPanelFirst: true,
      isPanelLast: true,
    }];
  }

  const firstWordStart = wordTimings[0]?.startMs;
  const lastWordEnd = wordTimings[wordTimings.length - 1]?.endMs;
  const captionStartMs = typeof caption.startMs === 'number' ? caption.startMs : firstWordStart;
  const captionEndMs = typeof caption.endMs === 'number' ? caption.endMs : lastWordEnd;
  if (
    typeof captionStartMs !== 'number'
    || typeof captionEndMs !== 'number'
    || captionEndMs <= captionStartMs
  ) {
    return [{
      duration: panelDurationSeconds,
      isPanelFirst: true,
      isPanelLast: true,
    }];
  }

  const scale = panelDurationMs / (captionEndMs - captionStartMs);
  const minSliceMs = 1000 / FPS;
  const slices: Array<{ startMs: number; endMs: number; activeWordIndex?: number }> = [];
  let cursorMs = 0;

  wordTimings.forEach((timing, activeWordIndex) => {
    const startMs = clampNumber((timing.startMs - captionStartMs) * scale, 0, panelDurationMs);
    const endMs = clampNumber((timing.endMs - captionStartMs) * scale, 0, panelDurationMs);
    if (startMs > cursorMs + minSliceMs) {
      slices.push({ startMs: cursorMs, endMs: startMs });
    }
    if (endMs > startMs + minSliceMs) {
      slices.push({ startMs, endMs, activeWordIndex });
      cursorMs = endMs;
    }
  });

  if (cursorMs < panelDurationMs - minSliceMs) {
    slices.push({ startMs: cursorMs, endMs: panelDurationMs });
  }

  if (slices.length === 0) {
    return [{
      duration: panelDurationSeconds,
      isPanelFirst: true,
      isPanelLast: true,
    }];
  }

  return slices.map((slice, index) => ({
    duration: Math.max(minSliceMs / 1000, (slice.endMs - slice.startMs) / 1000),
    activeWordIndex: slice.activeWordIndex,
    isPanelFirst: index === 0,
    isPanelLast: index === slices.length - 1,
  }));
}

function getExportCanvasSize(
  aspectRatio: StoryAspectRatio,
  videoExportPreset: VideoExportPreset
): ExportCanvasSize {
  if (aspectRatio === '9:16') {
    const [width, height] = videoExportPreset.verticalResolution
      .split('x')
      .map((value) => Number.parseInt(value, 10));

    return { width, height };
  }

  return {
    width: LANDSCAPE_OUTPUT_WIDTH,
    height: LANDSCAPE_OUTPUT_HEIGHT,
  };
}

function getWatermarkOffset(canvasSize: ExportCanvasSize): number {
  return Math.max(18, Math.round(Math.min(canvasSize.width, canvasSize.height) * 0.035));
}

function getWatermarkMetrics(canvasSize: ExportCanvasSize, videoExportPreset: VideoExportPreset) {
  const shortEdge = Math.min(canvasSize.width, canvasSize.height);
  const heightMultiplier = videoExportPreset.watermarkSize === 'small'
    ? 0.031
    : videoExportPreset.watermarkSize === 'large'
      ? 0.043
      : 0.037;
  const pillHeight = Math.max(18, Math.round(shortEdge * heightMultiplier));
  const fontSize = Math.max(10, Math.round(pillHeight * 0.54));
  const horizontalPadding = Math.max(8, Math.round(pillHeight * 0.58));
  const borderWidth = Math.max(1, pillHeight * 0.045);
  const offset = getWatermarkOffset(canvasSize);

  return {
    pillHeight,
    fontSize,
    horizontalPadding,
    borderWidth,
    offset,
  };
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawWatermark(
  context: CanvasRenderingContext2D,
  canvasSize: ExportCanvasSize,
  videoExportPreset: VideoExportPreset
) {
  const fontFamily = '"Georgia", "Times New Roman", serif';
  const text = 'kissago';
  const metrics = getWatermarkMetrics(canvasSize, videoExportPreset);

  context.save();
  context.font = `600 ${metrics.fontSize}px ${fontFamily}`;
  const textWidth = context.measureText(text).width;
  const pillWidth = Math.ceil(textWidth + metrics.horizontalPadding * 2);
  const x = videoExportPreset.watermarkPosition === 'top-right'
    ? canvasSize.width - pillWidth - metrics.offset
    : metrics.offset;
  const y = metrics.offset;

  context.fillStyle = 'rgba(255, 255, 255, 0.06)';
  context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  context.lineWidth = metrics.borderWidth;
  drawRoundedRect(context, x, y, pillWidth, metrics.pillHeight, metrics.pillHeight / 2);
  context.fill();
  context.stroke();

  context.font = `600 ${metrics.fontSize}px ${fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.fillStyle = 'rgba(255, 255, 255, 0.5)';
  context.fillText(text, x + pillWidth / 2, y + metrics.pillHeight / 2 + metrics.pillHeight * 0.03);
  context.restore();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error('Failed to fetch story image for export.');
      }
      return response.blob();
    })
    .then((blob) => new Promise<HTMLImageElement>((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load story image for export.'));
      };
      image.src = objectUrl;
    }));
}

function createExportCanvas(canvasSize: ExportCanvasSize): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  return canvas;
}

async function waitForExportFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.ready) return;
  await document.fonts.ready.catch(() => undefined);
}

function resolveCanvasFontFamily(fontFamily: string | undefined): string {
  if (!fontFamily || typeof window === 'undefined') {
    return fontFamily || DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontFamily;
  }

  return fontFamily.replace(/var\((--[^),\s]+)(?:,[^)]+)?\)/g, (_match, variableName: string) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
    return value || DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontFamily;
  });
}

function drawBlurredRoundedBackdrop(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  blur: number
) {
  if (blur <= 0) return;

  const source = createExportCanvas({
    width: context.canvas.width,
    height: context.canvas.height,
  });
  const sourceContext = source.getContext('2d');
  if (!sourceContext) return;
  sourceContext.drawImage(context.canvas, 0, 0);

  context.save();
  drawRoundedRect(context, x, y, width, height, radius);
  context.clip();
  context.filter = `blur(${blur}px)`;
  context.drawImage(source, 0, 0);
  context.filter = 'none';
  context.restore();
}

function drawContainedImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  canvasSize: ExportCanvasSize
) {
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvasSize.width, canvasSize.height);

  const scale = Math.min(
    canvasSize.width / image.naturalWidth,
    canvasSize.height / image.naturalHeight
  );
  const drawWidth = Math.round(image.naturalWidth * scale);
  const drawHeight = Math.round(image.naturalHeight * scale);
  const dx = Math.round((canvasSize.width - drawWidth) / 2);
  const dy = Math.round((canvasSize.height - drawHeight) / 2);

  context.drawImage(image, dx, dy, drawWidth, drawHeight);
}

function drawStoryboardPanel(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  panelIndex: number,
  canvasSize: ExportCanvasSize
) {
  const col = panelIndex % 2;
  const row = panelIndex >= 2 ? 1 : 0;
  const cropScale = 0.5 - STORYBOARD_PANEL_CROP_INSET_RATIO;
  const xFactor = col * 0.5 + STORYBOARD_PANEL_CROP_INSET_RATIO / 2;
  const yFactor = row * 0.5 + STORYBOARD_PANEL_CROP_INSET_RATIO / 2;
  const sourceWidth = image.naturalWidth * cropScale;
  const sourceHeight = image.naturalHeight * cropScale;
  const sourceX = image.naturalWidth * xFactor;
  const sourceY = image.naturalHeight * yFactor;

  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvasSize.width, canvasSize.height);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvasSize.width,
    canvasSize.height
  );
}

type WrappedCanvasWord = {
  text: string;
  wordIndex: number;
};

function measureCanvasWordLine(
  context: CanvasRenderingContext2D,
  line: WrappedCanvasWord[],
  highlightPaddingX: number,
  wordSpacing: number
): number {
  return line.reduce((total, word, index) => (
    total
      + context.measureText(word.text).width
      + (index === 0 ? highlightPaddingX * 2 : wordSpacing)
  ), 0);
}

function wrapCanvasWords(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  highlightPaddingX: number,
  wordSpacing: number
): WrappedCanvasWord[][] {
  const words = text.trim().split(/\s+/).filter(Boolean).map((word, wordIndex) => ({ text: word, wordIndex }));
  const lines: WrappedCanvasWord[][] = [];
  let current: WrappedCanvasWord[] = [];

  for (const word of words) {
    const next = [...current, word];
    if (measureCanvasWordLine(context, next, highlightPaddingX, wordSpacing) <= maxWidth || current.length === 0) {
      current = next;
    } else {
      lines.push(current);
      current = [word];
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function drawReelCaptionOverlay(
  context: CanvasRenderingContext2D,
  canvasSize: ExportCanvasSize,
  caption: ReelCaption | undefined,
  styleInput: StoryBeat['reelTextOverlayStyle'],
  activeWordIndex?: number
) {
  const captionText = caption?.text;
  if (!captionText?.trim()) return;

  const style = {
    ...DEFAULT_REEL_TEXT_OVERLAY_STYLE,
    ...normalizeReelTextOverlayStyle(styleInput),
  };
  const fontSize = Math.max(22, Math.round(canvasSize.width * 0.055 * (style.fontSize / DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontSize)));
  const styleFontSize = style.fontSize || DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontSize;
  const highlightPaddingX = Math.round(fontSize * ((style.wordHighlightPaddingX ?? 0) / styleFontSize));
  const highlightPaddingY = Math.round(fontSize * ((style.wordHighlightPaddingY ?? 0) / styleFontSize));
  const highlightBorderRadius = Math.round(fontSize * ((style.wordHighlightBorderRadius ?? 0) / styleFontSize));
  const wordSpacing = Math.round(fontSize * ((style.wordHighlightWordSpacing ?? 0) / styleFontSize));
  const baseLineHeight = Math.round(fontSize * 1.2);
  const lineHeight = baseLineHeight + highlightPaddingY * 2;
  const horizontalPadding = Math.round(canvasSize.width * 0.045);
  const verticalPadding = Math.round(fontSize * 0.42);
  const maxTextWidth = canvasSize.width - horizontalPadding * 4;
  const backgroundBlur = style.backgroundBlur ?? 0;

  context.save();
  context.font = `${style.fontWeight} ${fontSize}px ${resolveCanvasFontFamily(style.fontFamily)}`;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  const lines = wrapCanvasWords(context, captionText, maxTextWidth, highlightPaddingX, wordSpacing);
  const lineWidths = lines.map((line) => measureCanvasWordLine(context, line, highlightPaddingX, wordSpacing));
  const textWidth = Math.min(maxTextWidth, Math.max(...lineWidths, 0));
  const boxWidth = textWidth + horizontalPadding * 2;
  const boxHeight = lines.length * lineHeight + verticalPadding * 2;
  const x = style.align === 'left'
    ? horizontalPadding
    : style.align === 'right'
      ? canvasSize.width - boxWidth - horizontalPadding
      : (canvasSize.width - boxWidth) / 2;
  const safePadding = Math.max(18, Math.round(canvasSize.height * 0.025));
  const anchorY = canvasSize.height * (getReelCaptionTopPercent(style) / 100);
  const y = Math.max(
    safePadding,
    Math.min(canvasSize.height - boxHeight - safePadding, anchorY - boxHeight / 2)
  );
  const contentLeft = x + horizontalPadding;
  const contentRight = x + boxWidth - horizontalPadding;
  const contentCenter = x + boxWidth / 2;

  const boxRadius = Math.round(fontSize * 0.28);
  drawBlurredRoundedBackdrop(context, x, y, boxWidth, boxHeight, boxRadius, backgroundBlur);
  if ((style.backgroundOpacity ?? 0) > 0) {
    context.fillStyle = reelColorWithOpacity(style.backgroundColor, style.backgroundOpacity);
    drawRoundedRect(context, x, y, boxWidth, boxHeight, boxRadius);
    context.fill();
  }
  if (typeof activeWordIndex === 'number') {
    context.save();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = reelColorWithOpacity(style.wordHighlightColor, style.wordHighlightOpacity);

    lines.forEach((line, lineIndex) => {
      const activeIndex = line.findIndex((word) => word.wordIndex === activeWordIndex);
      if (activeIndex < 0) return;

      const lineWidth = lineWidths[lineIndex] ?? 0;
      const lineStartX = style.align === 'left'
        ? contentLeft
        : style.align === 'right'
          ? contentRight - lineWidth
          : contentCenter - lineWidth / 2;
      const beforeWidth = line.slice(0, activeIndex).reduce(
        (total, word) => total + context.measureText(word.text).width + wordSpacing,
        0
      );
      const activeWord = line[activeIndex];
      const activeWidth = context.measureText(activeWord.text).width;
      const textY = y + verticalPadding + lineHeight * lineIndex + lineHeight / 2;
      const highlightHeight = lineHeight;
      const highlightX = lineStartX + beforeWidth;
      const highlightY = textY - highlightHeight / 2;
      drawRoundedRect(
        context,
        highlightX,
        highlightY,
        activeWidth + highlightPaddingX * 2,
        highlightHeight,
        highlightBorderRadius
      );
      context.fill();
    });
    context.restore();
  }

  context.fillStyle = style.color;
  context.shadowColor = style.shadowColor;
  context.shadowBlur = style.shadowBlur;
  context.shadowOffsetY = 2;
  lines.forEach((line, lineIndex) => {
    const lineWidth = lineWidths[lineIndex] ?? 0;
    let cursorX = style.align === 'left'
      ? contentLeft
      : style.align === 'right'
        ? contentRight - lineWidth
        : contentCenter - lineWidth / 2;
    const textY = y + verticalPadding + lineHeight * lineIndex + lineHeight / 2;

    line.forEach((word, wordIndex) => {
      const wordWidth = context.measureText(word.text).width;
      context.fillText(word.text, cursorX + highlightPaddingX, textY);
      cursorX += wordWidth + (wordIndex < line.length - 1 ? wordSpacing : 0);
    });
  });
  context.restore();
}

async function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value);
        return;
      }

      reject(new Error('Failed to encode export image.'));
    }, 'image/jpeg', EXPORT_IMAGE_QUALITY);
  });

  return new Uint8Array(await blob.arrayBuffer());
}

async function renderBeatFrameBytes(
  imageUrl: string,
  canvasSize: ExportCanvasSize,
  videoExportPreset: VideoExportPreset,
  showWatermark: boolean
): Promise<Uint8Array> {
  const image = await loadImage(imageUrl);
  const canvas = createExportCanvas(canvasSize);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to prepare export canvas.');
  }

  drawContainedImage(context, image, canvasSize);
  if (showWatermark) {
    drawWatermark(context, canvasSize, videoExportPreset);
  }

  return canvasToJpegBytes(canvas);
}

async function renderStoryboardPanelBytes(
  image: HTMLImageElement,
  panelIndex: number,
  canvasSize: ExportCanvasSize,
  videoExportPreset: VideoExportPreset,
  showWatermark: boolean,
  caption?: ReelCaption,
  textOverlayStyle?: StoryBeat['reelTextOverlayStyle'],
  activeWordIndex?: number
): Promise<Uint8Array> {
  const canvas = createExportCanvas(canvasSize);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to prepare storyboard export canvas.');
  }

  drawStoryboardPanel(context, image, panelIndex, canvasSize);
  drawReelCaptionOverlay(context, canvasSize, caption, textOverlayStyle, activeWordIndex);
  if (showWatermark) {
    drawWatermark(context, canvasSize, videoExportPreset);
  }

  return canvasToJpegBytes(canvas);
}

export type ExportPhase = 'idle' | 'loading' | 'preparing' | 'encoding' | 'finalizing';

export interface VideoExportState {
  isExporting: boolean;
  progress: number;
  phase: ExportPhase;
  error: string | null;
}

export interface VideoExportOptions {
  aspectRatio?: StoryAspectRatio;
  videoExportPreset?: VideoExportPreset | null;
  showWatermark?: boolean;
}

export function useVideoExport() {
  const [state, setState] = useState<VideoExportState>({
    isExporting: false,
    progress: 0,
    phase: 'idle',
    error: null,
  });
  const cancelledRef = useRef(false);
  const activeFfmpegRef = useRef<FFmpeg | null>(null);

  useEffect(() => {
    if (!state.isExporting) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.isExporting]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    activeFfmpegRef.current?.terminate();
    if (ffmpegInstance === activeFfmpegRef.current) {
      ffmpegInstance = null;
    }
    activeFfmpegRef.current = null;
  }, []);

  const exportVideo = useCallback(
    async (beats: StoryBeat[], storyTitle: string, options: VideoExportOptions = {}): Promise<boolean> => {
      const videoBeats = beats.filter((beat) => Boolean(beat.imageUrl));
      if (videoBeats.length === 0) {
        setState((current) => ({ ...current, error: 'No images found in this story.' }));
        return false;
      }

      const aspectRatio: StoryAspectRatio = options.aspectRatio === '9:16' ? '9:16' : '16:9';
      const videoExportPreset = normalizeVideoExportPreset(options.videoExportPreset ?? DEFAULT_VIDEO_EXPORT_PRESET);
      const canvasSize = getExportCanvasSize(aspectRatio, videoExportPreset);
      const showWatermark = options.showWatermark === true;

      cancelledRef.current = false;
      setState({ isExporting: true, progress: 0, phase: 'loading', error: null });

      if (typeof SharedArrayBuffer === 'undefined') {
        setState({
          isExporting: false,
          progress: 0,
          phase: 'idle',
          error: 'Video export is not supported in this browser. Try Chrome or Edge.',
        });
        return false;
      }

      let ffmpeg: Awaited<ReturnType<typeof getFFmpeg>>;
      try {
        ffmpeg = await getFFmpeg();
        activeFfmpegRef.current = ffmpeg;
      } catch (error) {
        ffmpegInstance = null;
        const message = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
        console.error('[useVideoExport] FFmpeg load failed:', error);
        setState({ isExporting: false, progress: 0, phase: 'idle', error: `Failed to load video encoder: ${message}` });
        return false;
      }

      if (cancelledRef.current) {
        setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
        return false;
      }

      setState((current) => ({ ...current, phase: 'preparing', progress: 5 }));
      await waitForExportFonts();

      const segments: BeatSegment[] = await Promise.all(
        videoBeats.map(async (beat, index) => {
          const imageUrl = toExportFetchUrl(beat.imageUrl!);
          const audioUrl = beat.audioUrl ? toExportFetchUrl(beat.audioUrl) : null;
          const audioDuration = audioUrl ? await probeAudioDuration(audioUrl) : 0;
          const isStoryboard = beat.isStoryboard === true;
          const fallbackSeconds = STORYBOARD_ADVANCE_MS / 1000;
          const panelDurations = isStoryboard
            ? getStoryboardPanelDurationsSeconds(beat, audioDuration)
            : [audioDuration > 0 ? audioDuration : fallbackSeconds];
          const panelDuration = panelDurations[0] ?? fallbackSeconds;

          return {
            index,
            imageUrl,
            audioUrl,
            isStoryboard,
            panelDuration,
            panelDurations,
            totalDuration: panelDurations.reduce((sum, duration) => sum + duration, 0),
            reelCaptions: beat.reelCaptions,
            textOverlayEnabled: beat.reelTextOverlayEnabled !== false,
            textOverlayStyle: beat.reelTextOverlayStyle,
          };
        })
      );

      setState((current) => ({ ...current, phase: 'encoding', progress: 10 }));

      const segmentFiles: string[] = [];
      const transientFilePatterns = [/^seg_\d+\.mp4$/, /^img_\d+(?:_\d+){0,2}\.jpg$/, /^aud_\d+\.wav$/];
      let currentSegmentIndex = 0;

      const handleEncodingProgress = ({ progress }: { progress: number }) => {
        const normalizedProgress = clamp01(progress);
        const completedFraction = (currentSegmentIndex + normalizedProgress) / Math.max(segments.length, 1);
        setState((current) => ({
          ...current,
          progress: 10 + Math.round(completedFraction * 75),
        }));
      };

      ffmpeg.on('progress', handleEncodingProgress);

      try {
        for (let index = 0; index < segments.length; index += 1) {
          const segment = segments[index];
          currentSegmentIndex = index;
          const audioFile = segment.audioUrl ? `aud_${index}.wav` : null;
          const outputFile = `seg_${index}.mp4`;

          if (cancelledRef.current) {
            for (const file of segmentFiles) {
              try {
                await ffmpeg.deleteFile(file);
              } catch {
                // ignore
              }
            }
            setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
            return false;
          }

          if (segment.audioUrl && audioFile) {
            await ffmpeg.writeFile(audioFile, await fetchFile(segment.audioUrl));
          }

          const withFade = (
            inputLabel: string,
            outputLabel: string,
            duration: number,
            fadeIn = true,
            fadeOut = true
          ) => {
            const fade = Math.max(0, Math.min(FADE_DURATION, duration / 2 - 0.01));
            const fadeInFilter = fade > 0 && fadeIn ? `,fade=t=in:d=${fade.toFixed(3)}` : '';
            const fadeOutFilter = fade > 0 && fadeOut ? `,fade=t=out:st=${(duration - fade).toFixed(3)}:d=${fade.toFixed(3)}` : '';
            const fadeFilter = `${fadeInFilter}${fadeOutFilter}`;
            return `[${inputLabel}]format=yuv420p,setsar=1${fadeFilter}[${outputLabel}]`;
          };

          const args: string[] = [];
          const durationSeconds = segment.isStoryboard ? segment.totalDuration : segment.panelDuration;

          if (segment.isStoryboard) {
            const storyboardImage = await loadImage(segment.imageUrl);
            const frameFiles: string[] = [];
            const frameDurations: number[] = [];
            const frameFadeFlags: Array<{ fadeIn: boolean; fadeOut: boolean }> = [];

            for (let panelIndex = 0; panelIndex < 4; panelIndex += 1) {
              const panelDuration = segment.panelDurations[panelIndex] ?? segment.panelDuration;
              const caption = segment.textOverlayEnabled
                ? segment.reelCaptions?.find((item) => item.panelIndex === panelIndex)
                : undefined;
              const frameSlices = buildCaptionFrameSlices(caption, panelDuration);

              for (let sliceIndex = 0; sliceIndex < frameSlices.length; sliceIndex += 1) {
                const frame = frameSlices[sliceIndex];
                const frameFile = `img_${index}_${panelIndex}_${sliceIndex}.jpg`;
                frameFiles.push(frameFile);
                frameDurations.push(frame.duration);
                frameFadeFlags.push({
                  fadeIn: frame.isPanelFirst,
                  fadeOut: frame.isPanelLast,
                });
                const frameBytes = await renderStoryboardPanelBytes(
                  storyboardImage,
                  panelIndex,
                  canvasSize,
                  videoExportPreset,
                  showWatermark,
                  caption,
                  segment.textOverlayStyle,
                  frame.activeWordIndex
                );
                await ffmpeg.writeFile(frameFile, frameBytes);

                args.push(
                  '-framerate', String(FPS),
                  '-loop', '1',
                  '-t', frame.duration.toFixed(3),
                  '-i', frameFile
                );
              }
            }

            const storyboardDurationSeconds = frameDurations.reduce((sum, duration) => sum + duration, 0) || durationSeconds;

            if (audioFile) {
              args.push('-i', audioFile);
            } else {
              args.push(
                '-f', 'lavfi',
                '-t', storyboardDurationSeconds.toFixed(3),
                '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SAMPLE_RATE}`
              );
            }

            const audioInputIndex = frameFiles.length;
            const videoOutputLabels = frameFiles.map((_, frameIndex) => `v${frameIndex}`);
            const filterComplex = [
              ...videoOutputLabels.map((label, frameIndex) => withFade(
                `${frameIndex}:v`,
                label,
                frameDurations[frameIndex] ?? segment.panelDuration,
                frameFadeFlags[frameIndex]?.fadeIn,
                frameFadeFlags[frameIndex]?.fadeOut
              )),
              `${videoOutputLabels.map((label) => `[${label}]`).join('')}concat=n=${videoOutputLabels.length}:v=1:a=0[vout]`,
              `[${audioInputIndex}:a]aresample=${AUDIO_SAMPLE_RATE},aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,apad=whole_dur=${storyboardDurationSeconds.toFixed(3)},atrim=duration=${storyboardDurationSeconds.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
            ].join(';');

            args.push(
              '-filter_complex', filterComplex,
              '-map', '[vout]',
              '-map', '[aout]',
              '-c:v', 'libx264',
              '-preset', 'ultrafast',
              '-crf', '23',
              '-pix_fmt', 'yuv420p',
              '-c:a', 'aac',
              '-b:a', AUDIO_BITRATE,
              '-ar', String(AUDIO_SAMPLE_RATE),
              '-ac', String(AUDIO_CHANNELS),
              '-shortest',
              outputFile
            );

            const exitCode = await ffmpeg.exec(args);
            if (exitCode !== 0) {
              throw new Error(`Segment ${segment.index + 1} encoding failed (ffmpeg exit code ${exitCode}).`);
            }

            for (const frameFile of frameFiles) {
              await ffmpeg.deleteFile(frameFile);
            }
          } else {
            const imageFile = `img_${index}.jpg`;
            const imageBytes = await renderBeatFrameBytes(
              segment.imageUrl,
              canvasSize,
              videoExportPreset,
              showWatermark
            );
            await ffmpeg.writeFile(imageFile, imageBytes);

            args.push(
              '-framerate', String(FPS),
              '-loop', '1',
              '-t', durationSeconds.toFixed(3),
              '-i', imageFile
            );

            if (audioFile) {
              args.push('-i', audioFile);
            } else {
              args.push(
                '-f', 'lavfi',
                '-t', durationSeconds.toFixed(3),
                '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SAMPLE_RATE}`
              );
            }

            const filterComplex = [
              withFade('0:v', 'vout', durationSeconds),
              `[1:a]aresample=${AUDIO_SAMPLE_RATE},aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,apad=whole_dur=${durationSeconds.toFixed(3)},atrim=duration=${durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
            ].join(';');

            args.push(
              '-filter_complex', filterComplex,
              '-map', '[vout]',
              '-map', '[aout]',
              '-c:v', 'libx264',
              '-preset', 'ultrafast',
              '-crf', '23',
              '-pix_fmt', 'yuv420p',
              '-c:a', 'aac',
              '-b:a', AUDIO_BITRATE,
              '-ar', String(AUDIO_SAMPLE_RATE),
              '-ac', String(AUDIO_CHANNELS),
              '-shortest',
              outputFile
            );

            const exitCode = await ffmpeg.exec(args);
            if (exitCode !== 0) {
              throw new Error(`Segment ${segment.index + 1} encoding failed (ffmpeg exit code ${exitCode}).`);
            }

            await ffmpeg.deleteFile(imageFile);
          }

          segmentFiles.push(outputFile);

          if (audioFile) {
            await ffmpeg.deleteFile(audioFile);
          }

          setState((current) => ({
            ...current,
            progress: 10 + Math.round(((index + 1) / segments.length) * 75),
          }));
        }

        if (cancelledRef.current) {
          for (const file of segmentFiles) {
            try {
              await ffmpeg.deleteFile(file);
            } catch {
              // ignore
            }
          }
          setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
          return false;
        }

        ffmpeg.off('progress', handleEncodingProgress);
        setState((current) => ({ ...current, phase: 'finalizing', progress: 90 }));

        const concatList = segmentFiles.map((file) => `file '${file}'`).join('\n');
        await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList));

        const concatExitCode = await ffmpeg.exec([
          '-f', 'concat',
          '-safe', '0',
          '-i', 'concat.txt',
          '-c', 'copy',
          'output.mp4',
        ]);

        if (concatExitCode !== 0) {
          throw new Error(`Final video assembly failed (ffmpeg exit code ${concatExitCode}).`);
        }

        const outputData = await ffmpeg.readFile('output.mp4');
        const outputBytes = outputData instanceof Uint8Array
          ? outputData.slice()
          : new TextEncoder().encode(outputData as string);
        const outputBlob = new Blob([outputBytes], { type: 'video/mp4' });

        for (const file of [...segmentFiles, 'concat.txt', 'output.mp4']) {
          try {
            await ffmpeg.deleteFile(file);
          } catch {
            // ignore
          }
        }

        if (cancelledRef.current) {
          setState({ isExporting: false, progress: 0, phase: 'idle', error: null });
          return false;
        }

        const url = URL.createObjectURL(outputBlob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${storyTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'story'}.mp4`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        setState({ isExporting: false, progress: 100, phase: 'idle', error: null });
        setTimeout(() => {
          setState((current) => (current.progress === 100 ? { ...current, progress: 0 } : current));
        }, 1500);
        return true;
      } catch (error) {
        for (const file of ['concat.txt', 'output.mp4']) {
          try {
            await ffmpeg.deleteFile(file);
          } catch {
            // ignore
          }
        }

        const dirEntries = await ffmpeg.listDir('.').catch(() => []);
        for (const entry of dirEntries) {
          if (!entry.isDir && transientFilePatterns.some((pattern) => pattern.test(entry.name))) {
            try {
              await ffmpeg.deleteFile(entry.name);
            } catch {
              // ignore
            }
          }
        }

        setState({
          isExporting: false,
          progress: 0,
          phase: 'idle',
          error: cancelledRef.current ? null : (error instanceof Error ? error.message : 'Export failed.'),
        });
        return false;
      } finally {
        ffmpeg.off('progress', handleEncodingProgress);
        if (activeFfmpegRef.current === ffmpeg) {
          activeFfmpegRef.current = null;
        }
      }
    },
    []
  );

  return { exportVideo, cancel, ...state };
}
