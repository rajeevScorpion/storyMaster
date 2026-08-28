'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { useReducedMotion } from 'motion/react';

import {
  finishNavigationProgress,
  getNavigationProgressSnapshot,
  startNavigationProgress,
  subscribeNavigationProgress,
} from '@/lib/navigation/progress';

const TRICKLE_TARGET = 80;
const TRICKLE_DURATION_MS = 1200;
const FADE_DURATION_MS = 220;
const POPSTATE_FALLBACK_MS = 600;
const HARD_TIMEOUT_MS = 15_000;

/**
 * Decides whether a click on an anchor should start the progress bar. Deliberately
 * conservative: anything that won't produce a same-tab, same-origin navigation to a
 * different path is left alone so the bar never lies about work that isn't happening.
 */
function shouldTrackAnchorClick(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;

  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#')) return false;
  if (/^(mailto|tel|sms):/i.test(href)) return false;

  let destination: URL;
  try {
    destination = new URL(anchor.href, window.location.href);
  } catch {
    return false;
  }

  if (destination.origin !== window.location.origin) return false;
  if (destination.pathname === window.location.pathname && destination.search === window.location.search) {
    // Hash-only change on the same page, or a re-click of the current location —
    // neither one produces a route change that usePathname() would ever report.
    return false;
  }

  return true;
}

/**
 * Site-wide top-of-viewport progress bar. Starts from a single capture-phase click
 * listener (so every next/link click is covered with no per-component wiring) and
 * from popstate, and finishes when usePathname() reports the route actually changed.
 *
 * Deliberately does NOT watch useSearchParams() or patch history.pushState: gallery
 * search mutates the URL via pushState/replaceState on every keystroke (see
 * docs/agent-context/GOTCHAS.md), and instrumenting either would flash the bar on
 * every character typed.
 */
export default function NavigationProgress() {
  const pathname = usePathname();
  const prefersReducedMotion = useReducedMotion();

  const { isNavigating, token } = useSyncExternalStore(
    subscribeNavigationProgress,
    getNavigationProgressSnapshot,
    getNavigationProgressSnapshot
  );

  const barRef = useRef<HTMLDivElement | null>(null);
  const trickleFrameRef = useRef<number | null>(null);
  const hardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popstateFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPathnameRef = useRef(pathname);

  // Global click/popstate listeners — mounted once.
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a');
      if (!anchor) return;
      if (!shouldTrackAnchorClick(event, anchor)) return;
      startNavigationProgress();
    };

    const handlePopState = () => {
      startNavigationProgress();
      if (popstateFallbackRef.current) clearTimeout(popstateFallbackRef.current);
      // Back/forward navigations are usually served from the client-side cache and
      // never touch usePathname() fast enough to feel like "progress" — this fallback
      // just clears the bar rather than leaving it stuck.
      popstateFallbackRef.current = setTimeout(() => {
        finishNavigationProgress();
      }, POPSTATE_FALLBACK_MS);
    };

    document.addEventListener('click', handleClick, true);
    window.addEventListener('popstate', handlePopState);

    return () => {
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // The route actually changed — finish whatever was in flight.
  useEffect(() => {
    if (lastPathnameRef.current !== pathname) {
      lastPathnameRef.current = pathname;
      finishNavigationProgress();
    }
  }, [pathname]);

  // Hard timeout so a navigation that never resolves (or a route that never
  // changes pathname) can't leave the bar running forever.
  useEffect(() => {
    if (!isNavigating) return;

    hardTimeoutRef.current = setTimeout(() => {
      finishNavigationProgress();
    }, HARD_TIMEOUT_MS);

    return () => {
      if (hardTimeoutRef.current) clearTimeout(hardTimeoutRef.current);
    };
  }, [isNavigating, token]);

  // Drive the actual bar width/opacity imperatively (rAF trickle + CSS transition for
  // the finish snap) rather than through React state, so this never re-renders the tree.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    if (trickleFrameRef.current) cancelAnimationFrame(trickleFrameRef.current);
    if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);

    // token === 0 means no navigation has ever started — leave the bar at its
    // resting w-0/opacity-0 className instead of running the finish/snap
    // transition against nothing.
    if (!isNavigating && token === 0) return;

    if (isNavigating) {
      bar.style.transition = 'none';
      bar.style.opacity = '1';
      bar.style.width = '0%';

      const start = performance.now();
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

      const tick = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / TRICKLE_DURATION_MS, 1);
        const width = easeOutCubic(progress) * TRICKLE_TARGET;
        bar.style.width = `${width}%`;
        if (progress < 1) {
          trickleFrameRef.current = requestAnimationFrame(tick);
        }
      };
      trickleFrameRef.current = requestAnimationFrame(tick);
    } else {
      // Snap to 100%, then fade out. Skip the width transition under reduced motion
      // but still fade (opacity alone isn't "motion" in the vestibular sense).
      bar.style.transition = prefersReducedMotion ? 'none' : 'width 150ms ease-out';
      bar.style.width = '100%';

      fadeTimeoutRef.current = setTimeout(() => {
        bar.style.transition = `opacity ${FADE_DURATION_MS}ms ${prefersReducedMotion ? 'linear' : 'ease-in'}`;
        bar.style.opacity = '0';
      }, prefersReducedMotion ? 0 : 150);
    }

    return () => {
      if (trickleFrameRef.current) cancelAnimationFrame(trickleFrameRef.current);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
    // `token` is read only to force a restart even if isNavigating stayed true across a rapid re-click.
  }, [isNavigating, token, prefersReducedMotion]);

  useEffect(() => {
    return () => {
      if (popstateFallbackRef.current) clearTimeout(popstateFallbackRef.current);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[1200] h-[3px]" aria-hidden="true">
      <div
        ref={barRef}
        className="relative h-full w-0 rounded-r-full bg-gradient-to-r from-emerald-500 via-emerald-300 to-teal-200 opacity-0 shadow-[0_0_10px_rgba(52,211,153,0.75),0_0_28px_rgba(16,185,129,0.35)]"
      >
        {!prefersReducedMotion && (
          <span className="absolute inset-y-0 right-0 w-[90px] max-w-full animate-pulse bg-gradient-to-r from-transparent to-white/70 blur-[1px]" />
        )}
      </div>
    </div>
  );
}
