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
  if (!wordTimings?.length || elapsedMs === null || !isPlaying) {
    return <>{text}</>;
  }

  const highlightBg = reelColorWithOpacity(normalized.wordHighlightColor, normalized.wordHighlightOpacity);
  const tokens = text.split(/(\s+)/);
  let wordIdx = 0;

  return (
    <>
      {tokens.map((token, index) => {
        if (/^\s+$/.test(token)) return <span key={index}>{token}</span>;
        const timing = wordTimings[wordIdx++];
        const isActive = timing != null
          && elapsedMs >= timing.startMs
          && elapsedMs < timing.endMs;

        return (
          <span
            key={index}
            className="relative inline-block"
            style={{ padding: '0 3px', margin: '0 -3px' }}
          >
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-0 rounded"
                style={{ backgroundColor: highlightBg }}
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

  return (
    <div
      className={`absolute inset-x-4 z-20 flex -translate-y-1/2 ${alignClass} ${className ?? ''}`}
      style={{ top: `${topPercent}%` }}
    >
      <div
        style={{
          color: normalized.color,
          fontFamily: normalized.fontFamily,
          fontSize: normalized.fontSize ? `${normalized.fontSize}px` : undefined,
          fontWeight: normalized.fontWeight,
          textShadow: normalized.shadowColor
            ? `0 2px ${normalized.shadowBlur ?? 12}px ${normalized.shadowColor}`
            : undefined,
          backgroundColor: reelColorWithOpacity(normalized.backgroundColor, normalized.backgroundOpacity),
        }}
        className="max-w-xl rounded-lg px-3 py-2 leading-snug text-white shadow-lg backdrop-blur-sm"
      >
        {content}
      </div>
    </div>
  );
}
