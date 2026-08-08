'use client';

import Image from 'next/image';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import {
  getStoryboardPanelCropStyle,
  getStoryboardPanelObjectPosition,
  STORYBOARD_PANEL_OVERSCAN_SCALE,
  STORYBOARD_PANEL_SEQUENCE,
} from '@/lib/storyboard/layout';

const HOLD_PREVIEW_DELAY_MS = 350;
const STORYBOARD_THUMBNAIL_CYCLE_MS = 900;
const TOUCH_MOVE_CANCEL_PX = 10;

// Storyboard mode renders the image inside a 200%×200% wrapper so only one
// quadrant of a 2×2 grid is visible. Next/image's optimizer uses `sizes` to
// pick a source from srcset — passing the card-slot size leaves it half a
// resolution short and the result pixelates. Double the length values so the
// optimizer fetches a source sized for the actual 2× render box.
//
// Only the length at the end of each entry is scaled. Scaling every number in
// the string also moved the media-condition breakpoints, so
// `(max-width: 768px) 100vw, 1024px` became `(max-width: 1628px) 212vw,
// 2170px`: the wrong branch matched on mid-size screens, and 2170px overshot
// the 2048 source bucket into 3840. Oversized sources starve the image
// optimizer, which is what surfaced as "upstream image response timed out".
const SIZES_ENTRY_LENGTH_REGEX = /(\d*\.?\d+)(vw|vh|px|rem|em)\s*$/;

export function scaleSizesForCrop(sizes: string): string {
  const cropFactor = 2 * STORYBOARD_PANEL_OVERSCAN_SCALE;

  // Commas only ever separate entries in a `sizes` attribute — a media
  // condition cannot contain one — so splitting on them is safe.
  return sizes
    .split(',')
    .map((entry) =>
      entry.trim().replace(SIZES_ENTRY_LENGTH_REGEX, (_match, num: string, unit: string) => {
        const scaled = parseFloat(num) * cropFactor;
        return `${Number(scaled.toFixed(2))}${unit}`;
      })
    )
    .join(', ');
}

interface StoryboardThumbnailProps {
  src: string;
  alt: string;
  sizes: string;
  isPreviewing: boolean;
  previewSessionId: number;
  isStoryboard?: boolean;
  /**
   * Beat artwork to cycle while previewing, for slots whose resting image is
   * not a storyboard. A poster cover has nothing to cycle through, so the card
   * holds the poster whole and borrows the opening beat's grid on hover. Always
   * treated as a grid, and only fetched once a preview actually starts.
   */
  previewSrc?: string | null;
  className?: string;
  priority?: boolean;
  /**
   * Pin one panel instead of starting at panel 0 and cycling. The gallery hero
   * uses it to lay a vertical storyline's four panels side by side; a pinned
   * thumbnail never cycles, whatever `isPreviewing` says.
   */
  panel?: number;
}

interface StoryboardPreviewHandlers {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
}

export function useStoryboardThumbnailPreview(enabled: boolean): {
  isPreviewing: boolean;
  previewSessionId: number;
  previewHandlers: StoryboardPreviewHandlers;
  consumeSuppressedClick: (event: MouseEvent<HTMLElement>) => boolean;
} {
  const [isHovering, setIsHovering] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [previewSessionId, setPreviewSessionId] = useState(0);
  const holdTimerRef = useRef<number | null>(null);
  const longPressActiveRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const pointerStartRef = useRef<{ id: number; x: number; y: number } | null>(null);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const startPreviewSession = useCallback(() => {
    setPreviewSessionId((sessionId) => sessionId + 1);
  }, []);

  const resetHoldPreview = useCallback(() => {
    const shouldSuppressClick = longPressActiveRef.current || isHolding;
    clearHoldTimer();
    pointerStartRef.current = null;
    longPressActiveRef.current = false;
    setIsHolding(false);

    if (shouldSuppressClick) {
      suppressNextClickRef.current = true;
    }
  }, [clearHoldTimer, isHolding]);

  useEffect(() => {
    return () => clearHoldTimer();
  }, [clearHoldTimer]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.pointerType === 'mouse') return;

    clearHoldTimer();
    longPressActiveRef.current = false;
    pointerStartRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };

    holdTimerRef.current = window.setTimeout(() => {
      longPressActiveRef.current = true;
      suppressNextClickRef.current = true;
      startPreviewSession();
      setIsHolding(true);
    }, HOLD_PREVIEW_DELAY_MS);
  }, [clearHoldTimer, enabled, startPreviewSession]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.pointerType === 'mouse' || longPressActiveRef.current) return;

    const start = pointerStartRef.current;
    if (!start || start.id !== event.pointerId) return;

    const deltaX = Math.abs(event.clientX - start.x);
    const deltaY = Math.abs(event.clientY - start.y);
    if (deltaX > TOUCH_MOVE_CANCEL_PX || deltaY > TOUCH_MOVE_CANCEL_PX) {
      clearHoldTimer();
      pointerStartRef.current = null;
    }
  }, [clearHoldTimer, enabled]);

  const onPointerEnd = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.pointerType === 'mouse') return;
    resetHoldPreview();
  }, [enabled, resetHoldPreview]);

  const onPointerEnter = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.pointerType !== 'mouse') return;

    startPreviewSession();
    setIsHovering(true);
  }, [enabled, startPreviewSession]);

  const onPointerLeave = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!enabled) return;

    if (event.pointerType === 'mouse') {
      setIsHovering(false);
      return;
    }

    resetHoldPreview();
  }, [enabled, resetHoldPreview]);

  const onContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!enabled || (!longPressActiveRef.current && !suppressNextClickRef.current)) return;
    event.preventDefault();
  }, [enabled]);

  const consumeSuppressedClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!suppressNextClickRef.current) return false;

    event.preventDefault();
    event.stopPropagation();
    suppressNextClickRef.current = false;
    return true;
  }, []);

  return {
    isPreviewing: enabled && (isHovering || isHolding),
    previewSessionId,
    previewHandlers: {
      onPointerEnter,
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onPointerLeave,
      onContextMenu,
    },
    consumeSuppressedClick,
  };
}

export default function StoryboardThumbnail({
  src,
  alt,
  sizes,
  isPreviewing,
  previewSessionId,
  isStoryboard = true,
  previewSrc,
  className = '',
  priority = false,
  panel,
}: StoryboardThumbnailProps) {
  const [panelState, setPanelState] = useState({ previewSessionId, panel: 0 });
  // Auto-cycling the quadrants is decorative motion; hold on the first panel
  // when the viewer asked for reduced motion.
  const prefersReducedMotion = useReducedMotion();
  const isPinned = typeof panel === 'number';
  // Mounted only while previewing, so a card that is never hovered never pays
  // for the grid.
  const showsPreviewSource = isPreviewing && !!previewSrc;
  const activeSrc = showsPreviewSource ? previewSrc : src;
  const shouldCrop = showsPreviewSource || isStoryboard;
  const displayPanel = isPinned
    ? panel
    : shouldCrop && isPreviewing && panelState.previewSessionId === previewSessionId
      ? panelState.panel
      : 0;

  useEffect(() => {
    if (isPinned || !shouldCrop || !isPreviewing || prefersReducedMotion) return;

    const id = window.setInterval(() => {
      setPanelState((state) => ({
        previewSessionId,
        panel: state.previewSessionId === previewSessionId
          ? (state.panel + 1) % STORYBOARD_PANEL_SEQUENCE.length
          : 1,
      }));
    }, STORYBOARD_THUMBNAIL_CYCLE_MS);

    return () => window.clearInterval(id);
  }, [isPinned, isPreviewing, prefersReducedMotion, previewSessionId, shouldCrop]);

  if (!shouldCrop) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        className={`object-cover transition-transform duration-500 group-hover:scale-105 ${className}`}
        referrerPolicy="no-referrer"
        sizes={sizes}
        priority={priority}
        draggable={false}
      />
    );
  }

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`}>
      <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-105">
        <div
          className="absolute transition-all duration-300 ease-in-out"
          style={getStoryboardPanelCropStyle(displayPanel)}
        >
          <Image
            src={activeSrc}
            alt={alt}
            fill
            className="object-cover transition-[object-position] duration-300 ease-in-out"
            // Keeps the crop window centred on the panel when the slot's aspect
            // ratio differs from the image's; matches the wrapper's transition
            // so a panel cycle moves both together.
            style={{ objectPosition: getStoryboardPanelObjectPosition(displayPanel) }}
            referrerPolicy="no-referrer"
            sizes={scaleSizesForCrop(sizes)}
            priority={priority}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
