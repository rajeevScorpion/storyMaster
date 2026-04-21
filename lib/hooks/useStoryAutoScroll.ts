'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_AUTO_SCROLL_PX_PER_SECOND = 28;

export function useStoryAutoScroll<T extends HTMLElement>({
  enabled = true,
  resetKey,
  pxPerSecond = DEFAULT_AUTO_SCROLL_PX_PER_SECOND,
}: {
  enabled?: boolean;
  resetKey: string | number;
  pxPerSecond?: number;
}) {
  const scrollRef = useRef<T>(null);
  const frameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    lastTimestampRef.current = null;
  }, []);

  const toggleAutoScroll = useCallback(() => {
    if (!enabled) return;
    setIsAutoScrolling((current) => !current);
  }, [enabled]);

  const stopAutoScroll = useCallback(() => {
    setIsAutoScrolling(false);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = 0;
    }
    cancelFrame();
    queueMicrotask(() => setIsAutoScrolling(false));
  }, [cancelFrame, resetKey]);

  useEffect(() => {
    if (!enabled || !isAutoScrolling) {
      cancelFrame();
      return;
    }

    const step = (timestamp: number) => {
      const element = scrollRef.current;
      if (!element) {
        lastTimestampRef.current = timestamp;
        frameRef.current = window.requestAnimationFrame(step);
        return;
      }

      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      if (maxScrollTop <= 0 || element.scrollTop >= maxScrollTop - 1) {
        setIsAutoScrolling(false);
        cancelFrame();
        return;
      }

      const lastTimestamp = lastTimestampRef.current ?? timestamp;
      const deltaSeconds = Math.max(0, (timestamp - lastTimestamp) / 1000);
      lastTimestampRef.current = timestamp;
      element.scrollTop = Math.min(maxScrollTop, element.scrollTop + deltaSeconds * pxPerSecond);
      frameRef.current = window.requestAnimationFrame(step);
    };

    frameRef.current = window.requestAnimationFrame(step);
    return cancelFrame;
  }, [cancelFrame, enabled, isAutoScrolling, pxPerSecond]);

  return {
    scrollRef,
    isAutoScrolling,
    toggleAutoScroll,
    stopAutoScroll,
  };
}
