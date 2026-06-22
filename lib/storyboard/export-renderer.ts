import { STORYBOARD_PANEL_CROP_INSET_RATIO } from '@/lib/storyboard/layout';
import {
  getActiveStoryOverlayLineIndex,
  getActiveStoryOverlayWordIndex,
  getStoryOverlayCaptionWords,
  groupStoryOverlayWords,
  normalizeStoryTextOverlayWordsPerLine,
} from '@/lib/story-overlay/captions';
import {
  DEFAULT_STORY_TEXT_OVERLAY_STYLE,
  getStoryOverlayTopPercent,
  normalizeStoryTextOverlayStyle,
  storyOverlayColorWithOpacity,
} from '@/lib/story-overlay/styles';
import {
  getStoryExportFrameState,
  getStoryExportSceneAtTime,
  type StoryExportScene,
  type StoryExportTimeline,
} from '@/lib/storyboard/export-timeline';
import type { VideoExportPreset } from '@/lib/types/pricing';

export type StoryExportImageAssets = Map<string, ImageBitmap>;

interface StoryExportRenderOptions {
  textOverlayEnabled?: boolean;
  watermark?: boolean;
  watermarkPreset?: VideoExportPreset;
  vignetteEnabled?: boolean;
  vignetteAmountPercent?: number;
  storyTextOverlayWordsPerLine?: number;
}

type WrappedWord = { text: string; index: number };

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, safeRadius);
}

function resolveCanvasFont(fontFamily?: string): string {
  if (!fontFamily || typeof document === 'undefined') return fontFamily || DEFAULT_STORY_TEXT_OVERLAY_STYLE.fontFamily;
  return fontFamily.replace(/var\((--[^),\s]+)(?:,[^)]+)?\)/g, (_match, variableName: string) => (
    getComputedStyle(document.documentElement).getPropertyValue(variableName).trim()
    || DEFAULT_STORY_TEXT_OVERLAY_STYLE.fontFamily
  ));
}

function drawContainedImage(context: CanvasRenderingContext2D, image: ImageBitmap) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawStoryboardPanel(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  panelIndex: number
) {
  const col = panelIndex % 2;
  const row = panelIndex >= 2 ? 1 : 0;
  const cropScale = 0.5 - STORYBOARD_PANEL_CROP_INSET_RATIO;
  let sourceX = image.width * (col * 0.5 + STORYBOARD_PANEL_CROP_INSET_RATIO / 2);
  let sourceY = image.height * (row * 0.5 + STORYBOARD_PANEL_CROP_INSET_RATIO / 2);
  let sourceWidth = image.width * cropScale;
  let sourceHeight = image.height * cropScale;
  const targetAspect = context.canvas.width / context.canvas.height;
  const sourceAspect = sourceWidth / sourceHeight;
  if (sourceAspect > targetAspect) {
    const fittedWidth = sourceHeight * targetAspect;
    sourceX += (sourceWidth - fittedWidth) / 2;
    sourceWidth = fittedWidth;
  } else if (sourceAspect < targetAspect) {
    const fittedHeight = sourceWidth / targetAspect;
    sourceY += (sourceHeight - fittedHeight) / 2;
    sourceHeight = fittedHeight;
  }
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    context.canvas.width,
    context.canvas.height
  );
}

function measureWords(
  context: CanvasRenderingContext2D,
  words: WrappedWord[],
  paddingX: number,
  spacing: number
) {
  return words.reduce((sum, word, index) => (
    sum + context.measureText(word.text).width + paddingX * 2 + (index > 0 ? spacing : 0)
  ), 0);
}

function getActiveStoryWordIndex(scene: StoryExportScene, timeMs: number): number | undefined {
  const localBeatTimeMs = timeMs - scene.beatStartMs;
  return getActiveStoryOverlayWordIndex(scene.storyTextOverlayCaption?.wordTimings, localBeatTimeMs);
}

function drawStoryTextOverlay(
  context: CanvasRenderingContext2D,
  scene: StoryExportScene,
  timeMs: number,
  wordsPerLine: number
) {
  if (!scene.storyTextOverlayCaption?.text?.trim()) return;
  const style = normalizeStoryTextOverlayStyle(scene.storyTextOverlayStyle);
  const resolvedWordsPerLine = normalizeStoryTextOverlayWordsPerLine(
    style.wordsPerLine ?? wordsPerLine
  );
  const scale = context.canvas.width / 425;
  const fontSize = Math.max(1, Math.round((style.fontSize ?? DEFAULT_STORY_TEXT_OVERLAY_STYLE.fontSize) * scale));
  const paddingX = Math.round((style.wordHighlightPaddingX ?? 0) * scale);
  const paddingY = Math.round((style.wordHighlightPaddingY ?? 0) * scale);
  const spacing = Math.round((style.wordHighlightWordSpacing ?? 0) * scale);
  const lineHeight = Math.round(fontSize * 1.2 + paddingY * 2);
  const boxPaddingX = Math.round(12 * scale);
  const boxPaddingY = Math.round(8 * scale);

  context.save();
  context.font = `${style.fontWeight} ${fontSize}px ${resolveCanvasFont(style.fontFamily)}`;
  context.textBaseline = 'middle';
  const words = getStoryOverlayCaptionWords(scene.storyTextOverlayCaption)
    .map((word, index) => ({ text: word.word, index }));
  const groupedLines = groupStoryOverlayWords<WrappedWord>(words, resolvedWordsPerLine);
  const localBeatTimeMs = timeMs - scene.beatStartMs;
  const activeWordIndex = scene.storyTextOverlayTextHighlightSupported
    ? getActiveStoryWordIndex(scene, timeMs)
    : undefined;
  const activeLineIndex = scene.storyTextOverlayMode === 'line'
    ? Math.min(
        groupedLines.length - 1,
        getActiveStoryOverlayLineIndex(scene.storyTextOverlayCaption.wordTimings, localBeatTimeMs, resolvedWordsPerLine)
      )
    : 0;
  const lines = scene.storyTextOverlayMode === 'word'
    ? [[words[activeWordIndex ?? 0] ?? words[0]].filter((word): word is WrappedWord => Boolean(word))]
    : [groupedLines[activeLineIndex] ?? groupedLines[0] ?? []];
  const visibleLines = lines.filter((line) => line.length > 0);
  if (visibleLines.length === 0) {
    context.restore();
    return;
  }
  const widths = visibleLines.map((line) => measureWords(context, line, paddingX, spacing));
  const boxWidth = Math.max(...widths, 1) + boxPaddingX * 2;
  const boxHeight = lineHeight * visibleLines.length + boxPaddingY * 2;
  const safe = 12 * scale;
  const x = style.align === 'left'
    ? safe
    : style.align === 'right'
      ? context.canvas.width - safe - boxWidth
      : (context.canvas.width - boxWidth) / 2;
  const anchorY = context.canvas.height * (getStoryOverlayTopPercent(style) / 100);
  const y = Math.max(safe, Math.min(context.canvas.height - safe - boxHeight, anchorY - boxHeight / 2));

  if ((style.backgroundOpacity ?? 0) > 0) {
    context.fillStyle = storyOverlayColorWithOpacity(style.backgroundColor, style.backgroundOpacity ?? 0);
    roundedRect(context, x, y, boxWidth, boxHeight, 8 * scale);
    context.fill();
  }

  visibleLines.forEach((line, lineIndex) => {
    const lineWidth = widths[lineIndex];
    let cursorX = style.align === 'left'
      ? x + boxPaddingX
      : style.align === 'right'
        ? x + boxWidth - boxPaddingX - lineWidth
        : x + (boxWidth - lineWidth) / 2;
    const textY = y + boxPaddingY + lineHeight * lineIndex + lineHeight / 2;
    line.forEach((word, index) => {
      const wordWidth = context.measureText(word.text).width;
      const wordBoxWidth = wordWidth + paddingX * 2;
      const highlighted = word.index === activeWordIndex;
      const highlightScale = highlighted ? style.wordHighlightScale ?? 1 : 1;
      context.save();
      if (highlightScale !== 1) {
        context.translate(cursorX + wordBoxWidth / 2, textY);
        context.scale(highlightScale, highlightScale);
        context.translate(-(cursorX + wordBoxWidth / 2), -textY);
      }
      if (highlighted) {
        context.fillStyle = storyOverlayColorWithOpacity(style.wordHighlightColor, style.wordHighlightOpacity);
        roundedRect(context, cursorX, textY - lineHeight / 2, wordBoxWidth, lineHeight, (style.wordHighlightBorderRadius ?? 0) * scale);
        context.fill();
      }
      context.shadowColor = style.shadowColor ?? 'transparent';
      context.shadowBlur = (style.shadowBlur ?? 0) * scale;
      if ((style.outlineWidth ?? 0) > 0) {
        context.lineJoin = 'round';
        context.miterLimit = 2;
        context.lineWidth = Math.max(0, (style.outlineWidth ?? 0) * scale);
        context.strokeStyle = storyOverlayColorWithOpacity(style.outlineColor, 1);
        context.strokeText(word.text, cursorX + paddingX, textY);
      }
      context.fillStyle = storyOverlayColorWithOpacity(style.color, style.textOpacity);
      context.fillText(word.text, cursorX + paddingX, textY);
      context.restore();
      cursorX += wordBoxWidth + (index < line.length - 1 ? spacing : 0);
    });
  });
  context.restore();
}

function drawVignette(context: CanvasRenderingContext2D, amountPercent: number) {
  const amount = Math.max(0, Math.min(100, amountPercent)) / 100;
  if (amount <= 0) return;
  const width = context.canvas.width;
  const height = context.canvas.height;
  const gradient = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25, width / 2, height / 2, Math.max(width, height) * 0.58);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, `rgba(0,0,0,${0.7 * amount})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawWatermark(context: CanvasRenderingContext2D, preset?: VideoExportPreset) {
  const shortEdge = Math.min(context.canvas.width, context.canvas.height);
  const pillHeight = Math.max(18, Math.round(shortEdge * (preset?.watermarkSize === 'small' ? 0.031 : preset?.watermarkSize === 'large' ? 0.043 : 0.037)));
  const fontSize = Math.max(10, Math.round(pillHeight * 0.54));
  const paddingX = Math.max(8, Math.round(pillHeight * 0.58));
  const offset = Math.max(18, Math.round(shortEdge * 0.035));
  context.save();
  context.font = `600 ${fontSize}px Georgia, serif`;
  const width = Math.ceil(context.measureText('kissago').width + paddingX * 2);
  const x = preset?.watermarkPosition === 'top-right' ? context.canvas.width - width - offset : offset;
  const y = offset;
  context.fillStyle = 'rgba(255,255,255,0.06)';
  context.strokeStyle = 'rgba(255,255,255,0.5)';
  roundedRect(context, x, y, width, pillHeight, pillHeight / 2);
  context.fill();
  context.stroke();
  context.fillStyle = 'rgba(255,255,255,0.5)';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('kissago', x + width / 2, y + pillHeight / 2);
  context.restore();
}

export function drawStoryExportFrame(
  context: CanvasRenderingContext2D,
  timeline: StoryExportTimeline,
  assets: StoryExportImageAssets,
  timeMs: number,
  options: StoryExportRenderOptions = {}
) {
  context.fillStyle = '#000000';
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  const state = getStoryExportFrameState(timeline, timeMs);
  const drawScene = (scene: StoryExportScene | undefined, opacity = 1, blurPx = 0) => {
    if (!scene || opacity <= 0) return;
    const image = assets.get(scene.imageUrl);
    if (!image) return;
    context.save();
    context.globalAlpha = opacity;
    context.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
    if (scene.isStoryboard) drawStoryboardPanel(context, image, scene.panelIndex);
    else drawContainedImage(context, image);
    if (options.vignetteEnabled) drawVignette(context, options.vignetteAmountPercent ?? 100);
    if (options.textOverlayEnabled !== false && scene.storyTextOverlayEnabled && scene.isStoryboard) {
      drawStoryTextOverlay(
        context,
        scene,
        state.narrationTimeMs,
        options.storyTextOverlayWordsPerLine ?? 7
      );
    }
    context.restore();
  };

  if (state.transition) {
    const fromScene = timeline.scenes[state.transition.fromIndex];
    const toScene = timeline.scenes[state.transition.toIndex];
    const progress = state.transition.progress;
    const type = timeline.transitionTimeline.transitionSettings.type;
    if (type === 'fade-black') {
      if (progress < 0.5) drawScene(fromScene, 1 - progress * 2);
      else drawScene(toScene, (progress - 0.5) * 2);
    } else if (type === 'soft-fade') {
      drawScene(fromScene, 1 - progress, progress * 8);
      drawScene(toScene, progress, (1 - progress) * 8);
    } else {
      drawScene(fromScene, 1 - progress);
      drawScene(toScene, progress);
    }
  } else {
    drawScene(getStoryExportSceneAtTime(timeline, timeMs));
  }

  context.filter = 'none';
  context.globalAlpha = 1;
  if (options.watermark) drawWatermark(context, options.watermarkPreset);
}

export async function loadStoryExportImageAssets(urls: string[]): Promise<StoryExportImageAssets> {
  const assets: StoryExportImageAssets = new Map();
  await Promise.all([...new Set(urls)].map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load a story image.');
    assets.set(url, await createImageBitmap(await response.blob()));
  }));
  return assets;
}

export function releaseStoryExportImageAssets(assets: StoryExportImageAssets) {
  assets.forEach((image) => image.close());
}
