/**
 * Module-singleton store for the site-wide navigation progress bar. A plain
 * subscriber list rather than Zustand: this is a single boolean-ish counter
 * with no derived state, and NavigationProgress is the only consumer.
 */

type ProgressListener = () => void;

export interface NavigationProgressSnapshot {
  isNavigating: boolean;
  token: number;
}

let navigationToken = 0;
let isNavigating = false;
let snapshot: NavigationProgressSnapshot = { isNavigating, token: navigationToken };
const listeners = new Set<ProgressListener>();

function emit(): void {
  // A fresh object only when state actually changes — useSyncExternalStore
  // requires a stable reference between emits or it re-renders forever.
  snapshot = { isNavigating, token: navigationToken };
  listeners.forEach((listener) => listener());
}

/** Marks a navigation as started. Safe to call repeatedly (e.g. rapid clicks). */
export function startNavigationProgress(): void {
  navigationToken += 1;
  isNavigating = true;
  emit();
}

/** Marks the in-flight navigation as complete. */
export function finishNavigationProgress(): void {
  if (!isNavigating) return;
  isNavigating = false;
  emit();
}

export function subscribeNavigationProgress(listener: ProgressListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `token` changes on every start, so a consumer can detect "a new navigation began" even if one was already in flight. */
export function getNavigationProgressSnapshot(): NavigationProgressSnapshot {
  return snapshot;
}
