'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

const PANEL_TRANSFORMS = [
  'translate(0%, 0%)',
  'translate(-50%, 0%)',
  'translate(0%, -50%)',
  'translate(-50%, -50%)',
] as const;

const HOLD_PREVIEW_DELAY_MS = 350;
const STORYBOARD_THUMBNAIL_CYCLE_MS = 900;
const TOUCH_MOVE_CANCEL_PX = 10;

// Storyboard mode renders the image inside a 200%×200% wrapper so only one
// quadrant of a 2×2 grid is visible. Next/image's optimizer uses `sizes` to
// pick a source from srcset — passing the card-slot size leaves it half a
// resolution short and the result pixelates. Double the length values so the
// optimizer fetches a source sized for the actual 2× render box.
const SIZE_LENGTH_REGEX = /(\d*\.?\d+)(vw|vh|px|rem|em)/g;

function doubleSizesForCrop(sizes: string): string {
  return sizes.replace(SIZE_LENGTH_REGEX, (_match, num: string, unit: string) => {
    return `${parseFloat(num) * 2}${unit}`;
  });
}

interface StoryboardThumbnailProps {
  src: string;
  alt: string;
  sizes: string;
  isPreviewing: boolean;
  previewSessionId: number;
  isStoryboard?: boolean;
  allowAutoDetect?: boolean;
  className?: string;
  priority?: boolean;
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
  allowAutoDetect = false,
  className = '',
  priority = false,
}: StoryboardThumbnailProps) {
  const [panelState, setPanelState] = useState({ previewSessionId, panel: 0 });
  const [detectedStoryboard, setDetectedStoryboard] = useState(false);
  const shouldCrop = isStoryboard || detectedStoryboard;
  const displayPanel = shouldCrop && isPreviewing && panelState.previewSessionId === previewSessionId
    ? panelState.panel
    : 0;

  useEffect(() => {
    if (!shouldCrop || !isPreviewing) return;

    const id = window.setInterval(() => {
      setPanelState((state) => ({
        previewSessionId,
        panel: state.previewSessionId === previewSessionId
          ? (state.panel + 1) % PANEL_TRANSFORMS.length
          : 1,
      }));
    }, STORYBOARD_THUMBNAIL_CYCLE_MS);

    return () => window.clearInterval(id);
  }, [isPreviewing, previewSessionId, shouldCrop]);

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    if (isStoryboard || !allowAutoDetect) return;

    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth >= 1800 && naturalHeight >= 1000) {
      setDetectedStoryboard(true);
    }
  };

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
        onLoad={handleLoad}
        draggable={false}
      />
    );
  }

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`}>
      <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-105">
        <div
          className="absolute h-[200%] w-[200%] transition-transform duration-300 ease-in-out"
          style={{ transform: PANEL_TRANSFORMS[displayPanel] }}
        >
          <Image
            src={src}
            alt={alt}
            fill
            className="object-cover"
            referrerPolicy="no-referrer"
            sizes={doubleSizesForCrop(sizes)}
            priority={priority}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
