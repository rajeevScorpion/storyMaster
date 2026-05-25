import { STORYBOARD_PANEL_CROP_INSET_RATIO } from '@/lib/storyboard/layout';
import {
  DEFAULT_REEL_TEXT_OVERLAY_STYLE,
  getReelCaptionTopPercent,
  normalizeReelTextOverlayStyle,
  reelColorWithOpacity,
  type ReelTextOverlayStyle,
} from '@/lib/reel/styles';
import type { VideoExportPreset } from '@/lib/types/pricing';
import {
  getActiveReelWordIndex,
  getReelSceneAtTime,
  getReelTransitionAtTime,
  type ReelTimeline,
  type ReelTimelineScene,
} from '@/lib/reel/timeline';

export const REEL_RENDER_REFERENCE_WIDTH = 425;

export interface ReelRenderOptions {
  textOverlayEnabled?: boolean;
  textOverlayStyle?: ReelTextOverlayStyle;
  vignetteEnabled?: boolean;
  vignetteAmountPercent?: number;
  watermark?: boolean;
  watermarkPreset?: VideoExportPreset;
  visualFit?: 'fill' | 'cover';
}

export type ReelImageAssets = Map<string, ImageBitmap>;

type WrappedWord = { text: string; index: number };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundedRect(
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

function resolveCanvasFont(fontFamily: string | undefined): string {
  if (!fontFamily || typeof document === 'undefined') {
    return fontFamily || DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontFamily;
  }
  return fontFamily.replace(/var\((--[^),\s]+)(?:,[^)]+)?\)/g, (_match, variableName: string) => (
    getComputedStyle(document.documentElement).getPropertyValue(variableName).trim()
    || DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontFamily
  ));
}

function drawPanel(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  scene: ReelTimelineScene,
  width: number,
  height: number,
  offsetX = 0,
  alpha = 1,
  visualFit: ReelRenderOptions['visualFit'] = 'fill'
) {
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const col = scene.panelIndex % 2;
  const row = scene.panelIndex >= 2 ? 1 : 0;
  const cropScale = 0.5 - STORYBOARD_PANEL_CROP_INSET_RATIO;
  const xFactor = col * 0.5 + STORYBOARD_PANEL_CROP_INSET_RATIO / 2;
  const yFactor = row * 0.5 + STORYBOARD_PANEL_CROP_INSET_RATIO / 2;
  let sourceX = sourceWidth * xFactor;
  let sourceY = sourceHeight * yFactor;
  let panelWidth = sourceWidth * cropScale;
  let panelHeight = sourceHeight * cropScale;

  if (visualFit === 'cover' && width > 0 && height > 0) {
    const sourceAspect = panelWidth / panelHeight;
    const targetAspect = width / height;
    if (sourceAspect > targetAspect) {
      const fittedWidth = panelHeight * targetAspect;
      sourceX += (panelWidth - fittedWidth) / 2;
      panelWidth = fittedWidth;
    } else if (sourceAspect < targetAspect) {
      const fittedHeight = panelWidth / targetAspect;
      sourceY += (panelHeight - fittedHeight) / 2;
      panelHeight = fittedHeight;
    }
  }

  context.save();
  context.globalAlpha = alpha;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    panelWidth,
    panelHeight,
    offsetX,
    0,
    width,
    height
  );
  context.restore();
}

function drawVisuals(
  context: CanvasRenderingContext2D,
  timeline: ReelTimeline,
  assets: ReelImageAssets,
  timeMs: number,
  visualFit: ReelRenderOptions['visualFit'] = 'fill'
) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const scene = getReelSceneAtTime(timeline, timeMs);
  if (!scene) return;
  const image = assets.get(scene.imageUrl);
  if (!image) return;

  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);

  const transition = getReelTransitionAtTime(timeline, timeMs);
  if (!transition) {
    drawPanel(context, image, scene, width, height, 0, 1, visualFit);
    return;
  }

  const fromImage = assets.get(transition.from.imageUrl);
  const toImage = assets.get(transition.to.imageUrl);
  if (!fromImage || !toImage) {
    drawPanel(context, image, scene, width, height, 0, 1, visualFit);
    return;
  }
  const progress = clamp01(transition.progress);

  switch (timeline.transitionSettings.type) {
    case 'blend':
      drawPanel(context, fromImage, transition.from, width, height, 0, 1, visualFit);
      drawPanel(context, toImage, transition.to, width, height, 0, progress, visualFit);
      break;
    case 'fade-black':
    case 'fade-white': {
      const midpointProgress = progress < 0.5 ? progress * 2 : (progress - 0.5) * 2;
      const color = timeline.transitionSettings.type === 'fade-white' ? '#ffffff' : '#000000';
      if (progress < 0.5) {
        drawPanel(context, fromImage, transition.from, width, height, 0, 1, visualFit);
        context.fillStyle = color;
        context.globalAlpha = midpointProgress;
        context.fillRect(0, 0, width, height);
      } else {
        context.fillStyle = color;
        context.globalAlpha = 1;
        context.fillRect(0, 0, width, height);
        context.globalAlpha = 1;
        drawPanel(context, toImage, transition.to, width, height, 0, midpointProgress, visualFit);
      }
      context.globalAlpha = 1;
      break;
    }
    case 'slide-left':
      drawPanel(context, fromImage, transition.from, width, height, -width * progress, 1, visualFit);
      drawPanel(context, toImage, transition.to, width, height, width * (1 - progress), 1, visualFit);
      break;
    case 'slide-right':
      drawPanel(context, fromImage, transition.from, width, height, width * progress, 1, visualFit);
      drawPanel(context, toImage, transition.to, width, height, -width * (1 - progress), 1, visualFit);
      break;
    case 'fast-cut':
    default:
      drawPanel(context, image, scene, width, height, 0, 1, visualFit);
      break;
  }
}

function drawVignette(context: CanvasRenderingContext2D, amountPercent: number) {
  const amount = Math.max(0, Math.min(100, amountPercent)) / 100;
  if (amount <= 0) return;
  const width = context.canvas.width;
  const height = context.canvas.height;
  const gradient = context.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.25,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.58
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.6, `rgba(0,0,0,${0.18 * amount})`);
  gradient.addColorStop(0.82, `rgba(0,0,0,${0.42 * amount})`);
  gradient.addColorStop(1, `rgba(0,0,0,${0.7 * amount})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function measureLine(
  context: CanvasRenderingContext2D,
  words: WrappedWord[],
  paddingX: number,
  wordSpacing: number
) {
  return words.reduce((sum, word, index) => (
    sum + context.measureText(word.text).width + paddingX * 2 + (index > 0 ? wordSpacing : 0)
  ), 0);
}

function wrapLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  paddingX: number,
  wordSpacing: number
): WrappedWord[][] {
  const words = text.trim().split(/\s+/).filter(Boolean).map((word, index) => ({ text: word, index }));
  const lines: WrappedWord[][] = [];
  let current: WrappedWord[] = [];

  words.forEach((word) => {
    const next = [...current, word];
    if (current.length === 0 || measureLine(context, next, paddingX, wordSpacing) <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = [word];
    }
  });
  if (current.length) lines.push(current);
  return lines;
}

function drawCaption(
  context: CanvasRenderingContext2D,
  scene: ReelTimelineScene | undefined,
  timeMs: number,
  styleInput: ReelTextOverlayStyle | undefined,
  narrationEnded: boolean
) {
  const caption = scene?.caption;
  if (!caption?.text?.trim()) return;
  const style = normalizeReelTextOverlayStyle(styleInput);
  const scale = context.canvas.width / REEL_RENDER_REFERENCE_WIDTH;
  const fontSize = Math.max(1, Math.round((style.fontSize ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontSize) * scale));
  const paddingX = Math.round((style.wordHighlightPaddingX ?? 0) * scale);
  const paddingY = Math.round((style.wordHighlightPaddingY ?? 0) * scale);
  const wordSpacing = Math.round((style.wordHighlightWordSpacing ?? 0) * scale);
  const lineHeight = Math.round(fontSize * 1.2 + paddingY * 2);
  const boxPaddingX = Math.round(12 * scale);
  const boxPaddingY = Math.round(8 * scale);
  const maxTextWidth = context.canvas.width - Math.round(32 * scale) * 2 - boxPaddingX * 2;

  context.save();
  context.font = `${style.fontWeight} ${fontSize}px ${resolveCanvasFont(style.fontFamily)}`;
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  const lines = wrapLines(context, caption.text, maxTextWidth, paddingX, wordSpacing);
  const widths = lines.map((line) => measureLine(context, line, paddingX, wordSpacing));
  const textWidth = Math.max(...widths, 1);
  const boxWidth = textWidth + boxPaddingX * 2;
  const boxHeight = lineHeight * lines.length + boxPaddingY * 2;
  const anchorY = context.canvas.height * (getReelCaptionTopPercent(style) / 100);
  const safe = Math.round(12 * scale);
  const x = style.align === 'left'
    ? safe
    : style.align === 'right'
      ? context.canvas.width - safe - boxWidth
      : (context.canvas.width - boxWidth) / 2;
  const y = Math.max(safe, Math.min(context.canvas.height - safe - boxHeight, anchorY - boxHeight / 2));

  if ((style.backgroundBlur ?? 0) > 0) {
    const snapshot = document.createElement('canvas');
    snapshot.width = context.canvas.width;
    snapshot.height = context.canvas.height;
    const snapshotContext = snapshot.getContext('2d');
    snapshotContext?.drawImage(context.canvas, 0, 0);
    context.save();
    roundedRect(context, x, y, boxWidth, boxHeight, Math.round(8 * scale));
    context.clip();
    context.filter = `blur(${Math.round((style.backgroundBlur ?? 0) * scale)}px)`;
    context.drawImage(snapshot, 0, 0);
    context.restore();
  }
  if ((style.backgroundOpacity ?? 0) > 0) {
    context.fillStyle = reelColorWithOpacity(style.backgroundColor, style.backgroundOpacity);
    roundedRect(context, x, y, boxWidth, boxHeight, Math.round(8 * scale));
    context.fill();
  }

  const activeWordIndex = narrationEnded ? undefined : getActiveReelWordIndex(scene, timeMs);
  const textLeft = x + boxPaddingX;
  lines.forEach((line, lineIndex) => {
    const lineWidth = widths[lineIndex];
    let cursorX = style.align === 'left'
      ? textLeft
      : style.align === 'right'
        ? x + boxWidth - boxPaddingX - lineWidth
        : x + (boxWidth - lineWidth) / 2;
    const textY = y + boxPaddingY + lineHeight * lineIndex + lineHeight / 2;
    line.forEach((word, index) => {
      const wordWidth = context.measureText(word.text).width;
      const wordBoxWidth = wordWidth + paddingX * 2;
      if (word.index === activeWordIndex) {
        context.fillStyle = reelColorWithOpacity(style.wordHighlightColor, style.wordHighlightOpacity);
        roundedRect(
          context,
          cursorX,
          textY - lineHeight / 2,
          wordBoxWidth,
          lineHeight,
          Math.round((style.wordHighlightBorderRadius ?? 0) * scale)
        );
        context.fill();
      }
      context.fillStyle = style.color ?? '#ffffff';
      context.shadowColor = style.shadowColor ?? 'transparent';
      context.shadowBlur = Math.round((style.shadowBlur ?? 0) * scale);
      context.shadowOffsetY = Math.round(2 * scale);
      context.fillText(word.text, cursorX + paddingX, textY);
      cursorX += wordBoxWidth + (index < line.length - 1 ? wordSpacing : 0);
    });
  });
  context.restore();
}

function drawWatermark(context: CanvasRenderingContext2D, preset?: VideoExportPreset) {
  const text = 'kissago';
  const shortEdge = Math.min(context.canvas.width, context.canvas.height);
  const pillHeight = Math.max(18, Math.round(shortEdge * (
    preset?.watermarkSize === 'small' ? 0.031 : preset?.watermarkSize === 'large' ? 0.043 : 0.037
  )));
  const fontSize = Math.max(10, Math.round(pillHeight * 0.54));
  const paddingX = Math.max(8, Math.round(pillHeight * 0.58));
  const offset = Math.max(18, Math.round(shortEdge * 0.035));
  context.save();
  context.font = `600 ${fontSize}px "Georgia", "Times New Roman", serif`;
  const width = Math.ceil(context.measureText(text).width + paddingX * 2);
  const x = preset?.watermarkPosition === 'top-right'
    ? context.canvas.width - width - offset
    : offset;
  const y = offset;
  context.fillStyle = 'rgba(255,255,255,0.06)';
  context.strokeStyle = 'rgba(255,255,255,0.5)';
  context.lineWidth = Math.max(1, pillHeight * 0.045);
  roundedRect(context, x, y, width, pillHeight, pillHeight / 2);
  context.fill();
  context.stroke();
  context.fillStyle = 'rgba(255,255,255,0.5)';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, x + width / 2, y + pillHeight / 2 + pillHeight * 0.03);
  context.restore();
}

export function drawReelFrame(
  context: CanvasRenderingContext2D,
  timeline: ReelTimeline,
  assets: ReelImageAssets,
  timeMs: number,
  options: ReelRenderOptions = {}
) {
  const clampedTimeMs = Math.max(0, Math.min(timeMs, timeline.totalDurationMs));
  drawVisuals(context, timeline, assets, clampedTimeMs, options.visualFit);
  if (options.vignetteEnabled) {
    drawVignette(context, options.vignetteAmountPercent ?? 100);
  }
  if (options.textOverlayEnabled !== false) {
    drawCaption(
      context,
      getReelSceneAtTime(timeline, clampedTimeMs),
      clampedTimeMs,
      options.textOverlayStyle,
      clampedTimeMs >= timeline.narrationDurationMs
    );
  }
  if (options.watermark) {
    drawWatermark(context, options.watermarkPreset);
  }
}

export async function loadReelImageAssets(urls: string[]): Promise<ReelImageAssets> {
  const assets: ReelImageAssets = new Map();
  await Promise.all([...new Set(urls)].map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load a reel image.');
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    assets.set(url, bitmap);
  }));
  return assets;
}

export function releaseReelImageAssets(assets: ReelImageAssets) {
  assets.forEach((asset) => {
    asset.close();
  });
}
