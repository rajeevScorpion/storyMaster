/**
 * Minimal in-process TTL cache with single-flight de-duplication.
 *
 * Deliberately not Redis: the gallery's hot data is small, public, and cheap to
 * recompute, and the deployment (Cloud Run standalone) has no shared cache
 * today. Per-instance caching still removes the repeated work that dominates a
 * feed request, and an extra instance only means an extra cold fill.
 *
 * Two properties matter for correctness:
 *
 * - **Single flight.** Concurrent callers for the same key await one promise,
 *   so a burst of requests after a cold start issues one query, not N.
 * - **No user data in shared keys.** Callers must key on public inputs only.
 *   Anything scoped to a viewer (saved lists, progress) is fetched per request
 *   and merged on top — see `getGalleryRails`.
 *
 * A rejected fill is never cached; the next caller retries.
 */

interface CacheEntry<T> {
  /** Resolved value, or the in-flight promise while the fill is running. */
  value: Promise<T>;
  expiresAt: number;
}

/** Bound the map so a long-running instance cannot grow without limit. */
const MAX_ENTRIES = 2000;

const store = new Map<string, CacheEntry<unknown>>();

function evictExpired(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

/**
 * Return the cached value for `key`, or run `fill` and cache it for `ttlMs`.
 */
export function cached<T>(key: string, ttlMs: number, fill: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = store.get(key) as CacheEntry<T> | undefined;

  if (existing && existing.expiresAt > now) {
    return existing.value;
  }

  const value = fill();
  store.set(key, { value, expiresAt: now + ttlMs });

  // A failed fill must not be served to later callers, and must not linger as
  // an unhandled rejection if nobody else awaits this entry.
  value.catch(() => {
    const current = store.get(key);
    if (current?.value === value) store.delete(key);
  });

  if (store.size > MAX_ENTRIES) {
    evictExpired(now);
    // Still over budget after dropping expired entries: shed oldest-inserted
    // keys (Map preserves insertion order) rather than growing unbounded.
    while (store.size > MAX_ENTRIES) {
      const oldest = store.keys().next();
      if (oldest.done) break;
      store.delete(oldest.value);
    }
  }

  return value;
}

/**
 * Batch variant: resolve many keys at once, calling `fill` only for the keys
 * that are missing or stale. Used for per-storyline data (cover flags, signed
 * URLs) where a feed request touches dozens of ids at a time.
 */
export async function cachedMany<T>(
  keys: string[],
  ttlMs: number,
  fill: (missingKeys: string[]) => Promise<Map<string, T>>
): Promise<Map<string, T>> {
  const now = Date.now();
  const resolved = new Map<string, T>();
  const pending: Array<[string, Promise<T>]> = [];
  const missing: string[] = [];

  for (const key of new Set(keys)) {
    const entry = store.get(key) as CacheEntry<T> | undefined;
    if (entry && entry.expiresAt > now) {
      pending.push([key, entry.value]);
    } else {
      missing.push(key);
    }
  }

  for (const [key, value] of pending) {
    try {
      resolved.set(key, await value);
    } catch {
      // A previously cached fill that failed: treat as missing this round.
      missing.push(key);
    }
  }

  if (missing.length === 0) return resolved;

  const filled = await fill(missing);
  for (const key of missing) {
    if (!filled.has(key)) continue;
    const value = filled.get(key) as T;
    resolved.set(key, value);
    store.set(key, { value: Promise.resolve(value), expiresAt: now + ttlMs });
  }

  return resolved;
}

/** Drop cached entries whose key starts with `prefix`. */
export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Test hook — clears everything. */
export function clearCache(): void {
  store.clear();
}
