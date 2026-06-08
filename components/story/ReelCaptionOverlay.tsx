'use client';

import type { ReactNode } from 'react';
import type { WordTiming } from '@/lib/types/story';
import {
  getReelCaptionTopPercent,
  normalizeReelTextOverlayStyle,
  reelColorWithOpacity,
  type ReelTextOverlayStyle,
} from '@/lib/reel/styles';

interface ReelCaptionOverlayProps {
  children?: ReactNode;
  className?: string;
  style?: ReelTextOverlayStyle;
  text?: string;
}

interface ReelTimedCaptionTextProps {
  text: string;
  wordTimings?: WordTiming[];
  elapsedMs: number | null;
  isPlaying: boolean;
  style?: ReelTextOverlayStyle;
}

export function ReelTimedCaptionText({
  text,
  wordTimings,
  elapsedMs,
  isPlaying,
  style,
}: ReelTimedCaptionTextProps) {
  const normalized = normalizeReelTextOverlayStyle(style);
  if (!wordTimings?.length) {
    return <>{text}</>;
  }

  const highlightBg = reelColorWithOpacity(normalized.wordHighlightColor, normalized.wordHighlightOpacity);
  const highlightPaddingX = normalized.wordHighlightPaddingX ?? 0;
  const highlightPaddingY = normalized.wordHighlightPaddingY ?? 0;
  const highlightBorderRadius = normalized.wordHighlightBorderRadius ?? 0;
  const wordSpacing = normalized.wordHighlightWordSpacing ?? 0;
  const tokens = text.split(/(\s+)/);
  let wordIdx = 0;

  return (
    <>
      {tokens.map((token, index) => {
        if (/^\s+$/.test(token)) return null;
        const currentWordIndex = wordIdx;
        const timing = wordTimings[wordIdx++];
        const isActive = timing != null
          && isPlaying
          && elapsedMs !== null
          && elapsedMs >= timing.startMs
          && elapsedMs < timing.endMs;

        return (
          <span
            key={index}
            className="relative inline-block"
            style={{
              marginLeft: currentWordIndex > 0 ? `${wordSpacing - highlightPaddingX * 2}px` : undefined,
              padding: `${highlightPaddingY}px ${highlightPaddingX}px`,
            }}
          >
            {isActive && (
              <span
                aria-hidden
                className="absolute rounded"
                style={{
                  backgroundColor: highlightBg,
                  borderRadius: `${highlightBorderRadius}px`,
                  inset: 0,
                  zIndex: -1,
                }}
              />
            )}
            <span className="relative z-[1]">{token}</span>
          </span>
        );
      })}
    </>
  );
}

export default function ReelCaptionOverlay({
  children,
  className,
  style,
  text,
}: ReelCaptionOverlayProps) {
  const content = children ?? text;
  if (!content) return null;

  const normalized = normalizeReelTextOverlayStyle(style);
  const alignClass = normalized.align === 'left'
    ? 'justify-start text-left'
    : normalized.align === 'right'
      ? 'justify-end text-right'
      : 'justify-center text-center';
  const topPercent = getReelCaptionTopPercent(normalized);
  const backgroundBlur = normalized.backgroundBlur ?? 0;
  const hasBackdrop = (normalized.backgroundOpacity ?? 0) > 0 || backgroundBlur > 0;

  return (
    <div
      className={`absolute inset-x-4 z-20 flex -translate-y-1/2 ${alignClass} ${className ?? ''}`}
      style={{ top: `${topPercent}%` }}
    >
      <div
        style={{
          color: reelColorWithOpacity(normalized.color, normalized.textOpacity),
          fontFamily: normalized.fontFamily,
          fontSize: normalized.fontSize ? `${normalized.fontSize}px` : undefined,
          fontWeight: normalized.fontWeight,
          textShadow: normalized.shadowColor
            ? `0 2px ${normalized.shadowBlur ?? 12}px ${normalized.shadowColor}`
            : undefined,
          backgroundColor: reelColorWithOpacity(normalized.backgroundColor, normalized.backgroundOpacity),
          backdropFilter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : undefined,
          WebkitBackdropFilter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : undefined,
          isolation: 'isolate',
        }}
        className={`max-w-xl rounded-lg px-3 py-2 leading-snug text-white ${hasBackdrop ? 'shadow-lg' : ''}`}
      >
        {content}
      </div>
    </div>
  );
}
