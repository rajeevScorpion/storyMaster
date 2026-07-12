import 'server-only';

import type { PricingRuntimeContext } from '@/lib/types/pricing';

/**
 * Per-instance, user-scoped cache for the pricing runtime context.
 *
 * The cached context is display/gating-only: real coin authorization always
 * re-reads fresh state via `loadPricingState` + the `pricing_authorize_spend`
 * RPC, so a stale entry can never over-spend. Cross-instance staleness on
 * Cloud Run is bounded by the TTL; coin-mutating paths in
 * `lib/pricing/enforcement.ts` invalidate the local instance eagerly and the
 * client's post-generation refresh passes `forceRefresh: true`.
 */

interface CacheEntry {
  cachedAtMs: number;
  data: PricingRuntimeContext;
}

const TTL_MS = 30_000;
const MAX_ENTRIES = 500;

const cache = new Map<string, CacheEntry>();

export function buildPricingRuntimeCacheKey(
  userId: string | null,
  pricingMarketKey: string | null,
  countryCode: string | null
): string {
  // User ids are UUIDs (never contain ':'), so prefix scans per user are safe.
  return `${userId ?? 'anon'}:${pricingMarketKey ?? '-'}:${countryCode ?? '-'}`;
}

export function getCachedPricingRuntimeContext(key: string): PricingRuntimeContext | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.cachedAtMs >= TTL_MS) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

export function setCachedPricingRuntimeContext(key: string, data: PricingRuntimeContext): void {
  if (!cache.has(key) && cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }

  cache.set(key, { cachedAtMs: Date.now(), data });
}

export function invalidatePricingRuntimeCacheForUser(userId: string): void {
  const prefix = `${userId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
