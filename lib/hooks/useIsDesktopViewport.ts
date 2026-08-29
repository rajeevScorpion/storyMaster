'use client';

import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 1024px)'; // matches Tailwind's `lg:` breakpoint

/**
 * True at `lg:` and above — used only to pick between two fully separate
 * dialog implementations (Sheet vs Modal) that each run their own
 * scroll-lock/focus-trap, so unlike a CSS-only `md:hidden` split, only one
 * may actually be mounted at a time.
 *
 * Reads `matchMedia` synchronously in the initializer rather than deferring
 * to an effect. That's normally an SSR/hydration hazard, but every consumer
 * of this hook (LegalDocumentModal -> Modal/Sheet) always renders via
 * `createPortal` and returns null outright when `document` is undefined —
 * server and first-client-render both produce nothing at this component's
 * position either way, so there's no in-place tree for the value to
 * mismatch against. Do not reuse this hook for anything that renders inline.
 */
export function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(DESKTOP_QUERY).matches
  );

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return isDesktop;
}
