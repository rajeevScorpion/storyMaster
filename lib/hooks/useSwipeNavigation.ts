import { useState, useCallback } from 'react';
import type { PanInfo } from 'motion/react';

const SWIPE_THRESHOLD = 50; // minimum px for a swipe
const DIRECTION_RATIO = 2; // x must be 2x y to count as horizontal

interface UseSwipeNavigationProps {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  enabled?: boolean;
}

export function useSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
}: UseSwipeNavigationProps) {
  const [dragX, setDragX] = useState(0);

  const onPan = useCallback(
    (_: unknown, info: PanInfo) => {
      if (!enabled) return;
      // Only apply horizontal drag feedback when gesture is clearly horizontal
      if (Math.abs(info.offset.x) > Math.abs(info.offset.y) * DIRECTION_RATIO) {
        setDragX(info.offset.x * 0.3);
      }
    },
    [enabled]
  );

  const onPanEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      setDragX(0);
      if (!enabled) return;

      const isHorizontal =
        Math.abs(info.offset.x) > SWIPE_THRESHOLD &&
        Math.abs(info.offset.x) > Math.abs(info.offset.y) * DIRECTION_RATIO;

      if (!isHorizontal) return;

      if (info.offset.x < 0) {
        onSwipeLeft();
      } else {
        onSwipeRight();
      }
    },
    [enabled, onSwipeLeft, onSwipeRight]
  );

  return { dragX, onPan, onPanEnd };
}
