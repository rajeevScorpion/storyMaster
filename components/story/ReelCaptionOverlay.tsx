'use client';

import type { ReactNode } from 'react';
import { normalizeReelTextOverlayStyle, type ReelTextOverlayStyle } from '@/lib/reel/styles';

interface ReelCaptionOverlayProps {
  children?: ReactNode;
  className?: string;
  style?: ReelTextOverlayStyle;
  text?: string;
}

function backgroundColorFor(style: ReelTextOverlayStyle): string | undefined {
  const opacity = typeof style.backgroundOpacity === 'number' ? style.backgroundOpacity : undefined;
  if (opacity === 0) return 'transparent';
  return style.backgroundColor;
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
  const positionClass = normalized.position === 'upper'
    ? 'top-16'
    : normalized.position === 'middle'
      ? 'top-1/2 -translate-y-1/2'
      : 'bottom-9';
  const alignClass = normalized.align === 'left'
    ? 'justify-start text-left'
    : normalized.align === 'right'
      ? 'justify-end text-right'
      : 'justify-center text-center';

  return (
    <div className={`absolute inset-x-4 z-20 flex ${positionClass} ${alignClass} ${className ?? ''}`}>
      <div
        style={{
          color: normalized.color,
          fontFamily: normalized.fontFamily,
          fontSize: normalized.fontSize ? `${normalized.fontSize}px` : undefined,
          fontWeight: normalized.fontWeight,
          textShadow: normalized.shadowColor
            ? `0 2px ${normalized.shadowBlur ?? 12}px ${normalized.shadowColor}`
            : undefined,
          backgroundColor: backgroundColorFor(normalized),
        }}
        className="max-w-xl rounded-lg px-3 py-2 leading-snug text-white shadow-lg backdrop-blur-sm"
      >
        {content}
      </div>
    </div>
  );
}
