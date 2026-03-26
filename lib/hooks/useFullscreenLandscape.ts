import { useState, useEffect, useCallback } from 'react';

interface ScreenOrientationWithLock extends ScreenOrientation {
  lock(orientation: string): Promise<void>;
  unlock(): void;
}

export function useFullscreenLandscape(containerRef: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRotateHint, setShowRotateHint] = useState(false);

  // Track fullscreen state changes (user can exit via Escape or back button)
  useEffect(() => {
    function onFullscreenChange() {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);

      // Unlock orientation when exiting fullscreen
      if (!active) {
        try {
          const orientation = screen.orientation as ScreenOrientationWithLock;
          orientation.unlock?.();
        } catch {
          // Orientation API not supported
        }
      }
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Auto-dismiss rotate hint
  useEffect(() => {
    if (showRotateHint) {
      const timer = setTimeout(() => setShowRotateHint(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showRotateHint]);

  const enterFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;

    // Try Fullscreen API
    if (el.requestFullscreen) {
      try {
        await el.requestFullscreen();
        setIsFullscreen(true);

        // Try locking orientation to landscape (Android Chrome)
        try {
          const orientation = screen.orientation as ScreenOrientationWithLock;
          await orientation.lock('landscape');
        } catch {
          // Orientation lock not supported (iOS, desktop) — show rotate hint on mobile
          if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
            setShowRotateHint(true);
          }
        }
      } catch {
        // Fullscreen denied (iOS iPhone) — show rotate hint
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
          setShowRotateHint(true);
        }
      }
    } else {
      // No fullscreen API at all — show rotate hint on mobile
      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        setShowRotateHint(true);
      }
    }
  }, [containerRef]);

  const exitFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        const orientation = screen.orientation as ScreenOrientationWithLock;
        orientation.unlock?.();
      } catch {
        // Orientation API not supported
      }
      await document.exitFullscreen();
    }
    setIsFullscreen(false);
  }, []);

  const toggle = useCallback(() => {
    if (isFullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  return { isFullscreen, showRotateHint, toggle, dismissHint: () => setShowRotateHint(false) };
}
