'use client';

import {
  getActiveStoryOverlayLineIndex,
  getActiveStoryOverlayWordIndex,
  getStoryOverlayCaptionWords,
  groupStoryOverlayWords,
  normalizeStoryTextOverlayWordsPerLine,
} from '@/lib/story-overlay/captions';
import {
  getStoryOverlayTopPercent,
  normalizeStoryTextOverlayStyle,
  storyOverlayColorWithOpacity,
} from '@/lib/story-overlay/styles';
import type {
  StoryTextOverlayCaption,
  StoryTextOverlayMode,
  StoryTextOverlayStyle,
  StoryTextOverlayWordTiming,
} from '@/lib/story-overlay/types';

interface StoryTextOverlayProps {
  caption?: StoryTextOverlayCaption;
  enabled?: boolean;
  mode?: StoryTextOverlayMode;
  style?: StoryTextOverlayStyle;
  elapsedMs?: number | null;
  isPlaying?: boolean;
  wordsPerLine: number;
  textHighlightSupported?: boolean;
}

type IndexedWord = StoryTextOverlayWordTiming & { absoluteIndex: number };

export default function StoryTextOverlay({
  caption,
  enabled = true,
  mode = 'word',
  style,
  elapsedMs = null,
  wordsPerLine,
  textHighlightSupported = true,
}: StoryTextOverlayProps) {
  if (!enabled || !caption?.text?.trim()) return null;

  const normalizedStyle = normalizeStoryTextOverlayStyle(style);
  const resolvedWordsPerLine = normalizeStoryTextOverlayWordsPerLine(
    normalizedStyle.wordsPerLine ?? wordsPerLine
  );
  const words = getStoryOverlayCaptionWords(caption).map((word, absoluteIndex) => ({
    ...word,
    absoluteIndex,
  }));
  const lines = groupStoryOverlayWords<IndexedWord>(words, resolvedWordsPerLine);
  if (lines.length === 0) return null;

  const activeWordIndex = textHighlightSupported
    ? getActiveStoryOverlayWordIndex(caption.wordTimings, elapsedMs)
    : undefined;
  const activeLineIndex = mode === 'line'
    ? Math.min(
        lines.length - 1,
        getActiveStoryOverlayLineIndex(caption.wordTimings, elapsedMs, resolvedWordsPerLine)
      )
    : 0;
  const activeLine = mode === 'word'
    ? [words[activeWordIndex ?? 0] ?? words[0]].filter((word): word is IndexedWord => Boolean(word))
    : lines[activeLineIndex] ?? lines[0];
  const top = getStoryOverlayTopPercent(normalizedStyle);
  const justifyContent = normalizedStyle.align === 'left'
    ? 'flex-start'
    : normalizedStyle.align === 'right'
      ? 'flex-end'
      : 'center';
  const textAlign = normalizedStyle.align ?? 'center';
  const outlineWidth = normalizedStyle.outlineWidth ?? 0;

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-20 flex px-[7%]"
      style={{
        top: `${top}%`,
        justifyContent,
        transform: 'translateY(-50%)',
      }}
      aria-hidden
    >
      <div
        className="max-w-full rounded-lg px-3 py-2"
        style={{
          color: storyOverlayColorWithOpacity(normalizedStyle.color, normalizedStyle.textOpacity),
          backgroundColor: storyOverlayColorWithOpacity(
            normalizedStyle.backgroundColor,
            normalizedStyle.backgroundOpacity
          ),
          backdropFilter: normalizedStyle.backgroundBlur ? `blur(${normalizedStyle.backgroundBlur}px)` : undefined,
          fontFamily: normalizedStyle.fontFamily,
          fontSize: `${normalizedStyle.fontSize}px`,
          fontWeight: normalizedStyle.fontWeight,
          lineHeight: 1.2,
          textAlign,
          textShadow: normalizedStyle.shadowBlur
            ? `0 2px ${normalizedStyle.shadowBlur}px ${normalizedStyle.shadowColor}`
            : undefined,
          WebkitTextStroke: outlineWidth > 0
            ? `${outlineWidth}px ${normalizedStyle.outlineColor}`
            : undefined,
          paintOrder: outlineWidth > 0 ? 'stroke fill' : undefined,
        }}
      >
        <span
          className="inline-flex max-w-full flex-wrap items-center"
          style={{
            columnGap: `${normalizedStyle.wordHighlightWordSpacing ?? 0}px`,
            rowGap: `${Math.max(2, normalizedStyle.wordHighlightPaddingY ?? 0)}px`,
            justifyContent,
          }}
        >
          {activeLine.map((word) => {
            const highlighted = activeWordIndex === word.absoluteIndex;
            return (
              <span
                key={`${word.absoluteIndex}:${word.word}`}
                className="relative inline-block"
                style={{
                  padding: `${normalizedStyle.wordHighlightPaddingY ?? 0}px ${normalizedStyle.wordHighlightPaddingX ?? 0}px`,
                  borderRadius: highlighted ? `${normalizedStyle.wordHighlightBorderRadius ?? 0}px` : undefined,
                  backgroundColor: highlighted
                    ? storyOverlayColorWithOpacity(
                        normalizedStyle.wordHighlightColor,
                        normalizedStyle.wordHighlightOpacity
                      )
                    : undefined,
                  transform: highlighted ? `scale(${normalizedStyle.wordHighlightScale ?? 1})` : 'scale(1)',
                  transformOrigin: 'center',
                  transition: 'transform 140ms ease, background-color 140ms ease',
                  willChange: highlighted ? 'transform' : undefined,
                }}
              >
                {word.word}
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}
