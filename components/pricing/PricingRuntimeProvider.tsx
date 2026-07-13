'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { useAuth } from '@/lib/hooks/useAuth';
import { PRICING_RUNTIME_REFRESH_EVENT } from '@/lib/pricing/runtime-events';
import { DEFAULT_VIDEO_EXPORT_PRESET, type PricingMarketKey, type PricingRuntimeContext } from '@/lib/types/pricing';

interface PricingRuntimeContextValue {
  data: PricingRuntimeContext;
  isLoading: boolean;
  error: string | null;
  marketOverride: PricingMarketKey | null;
  setMarketOverride: (value: PricingMarketKey | null) => void;
  refresh: () => Promise<void>;
}

const PRICING_MARKET_STORAGE_KEY = 'kissago_pricing_market_override';

// Bump the version suffix whenever the PricingRuntimeContext shape changes so
// stale snapshots from an older deploy are discarded instead of painted.
const PRICING_SNAPSHOT_STORAGE_KEY = 'kissago_pricing_runtime_snapshot_v1';
const PRICING_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredPricingSnapshot {
  cachedAt: number;
  userId: string | null;
  marketOverride: PricingMarketKey | null;
  data: PricingRuntimeContext;
}

function readStoredPricingSnapshot(marketOverride: PricingMarketKey | null): StoredPricingSnapshot | null {
  try {
    const raw = window.localStorage.getItem(PRICING_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as StoredPricingSnapshot | null;
    if (!parsed || typeof parsed !== 'object' || !parsed.data?.snapshot || !parsed.data?.controls) {
      return null;
    }
    if ((parsed.marketOverride ?? null) !== (marketOverride ?? null)) {
      return null;
    }
    if (typeof parsed.cachedAt !== 'number' || Date.now() - parsed.cachedAt > PRICING_SNAPSHOT_MAX_AGE_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeStoredPricingSnapshot(snapshot: StoredPricingSnapshot): void {
  try {
    window.localStorage.setItem(PRICING_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage full or unavailable — the snapshot is purely an optimization.
  }
}

function clearStoredPricingSnapshot(): void {
  try {
    window.localStorage.removeItem(PRICING_SNAPSHOT_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

const DEFAULT_PRICING_RUNTIME_CONTEXT: PricingRuntimeContext = {
  userId: null,
  controls: {
    pricingAdminTabEnabled: false,
    pricingSnapshotEnabled: false,
    pricingCheckoutEnabled: false,
    pricingShadowMeteringEnabled: false,
    pricingHardEnforcementEnabled: false,
    pricingAdminBypassEnabled: false,
    pricingStoryLengthUiLimitsEnabled: false,
    defaultGracePeriodDays: 5,
    defaultCarryForwardCapMultiplier: 2,
    reservationTimeoutSeconds: 1800,
    migrationGrantBeats: 25,
    testerStudioDurationDays: 90,
    routingProviderIn: 'razorpay',
    routingProviderRow: 'stripe',
  },
  actionCosts: {
    start_story_initial_beat: 1,
    start_story_initial_beat_prompt_only: 0.5,
    start_reel_full_generation: 3,
    start_reel_full_generation_prompt_only: 1.5,
    continue_story_new_beat: 1,
    continue_story_new_beat_prompt_only: 0.5,
    preview_seed_plan: 0,
    regenerate_image: 1,
    regenerate_narration: 1,
    generate_social_share_cover: 1,
    generate_audio_story_cover: 1,
    generate_reel_thumbnail: 1,
    export_video_future: 5,
  },
  snapshot: {
    pricingMarketKey: 'IN',
    routingProvider: 'razorpay',
    planKey: 'free',
    planTierRank: 1,
    planVersionId: null,
    monthlyIncludedBeats: 12,
    billingProvider: null,
    billingInterval: null,
    billingCountryCode: null,
    currencyCode: 'INR',
    billingStatus: 'free',
    isInGracePeriod: false,
    currentPeriodEndsAt: null,
    gracePeriodEndsAt: null,
    nextResetAt: null,
    storyLengthCap: 4,
    canAccessDownloads: false,
    canAccessUnbrandedExports: false,
    creatorControls: false,
    videoExportPreset: DEFAULT_VIDEO_EXPORT_PRESET,
    availablePromoBeats: 0,
    availableSubscriptionBeats: 0,
    availableTopupBeats: 0,
    availableTotalBeats: 0,
  },
};

const PricingRuntimeContextValue = createContext<PricingRuntimeContextValue>({
  data: DEFAULT_PRICING_RUNTIME_CONTEXT,
  isLoading: true,
  error: null,
  marketOverride: null,
  setMarketOverride: () => {},
  refresh: async () => {},
});

export default function PricingRuntimeProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<PricingRuntimeContext>(DEFAULT_PRICING_RUNTIME_CONTEXT);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketOverride, setMarketOverrideState] = useState<PricingMarketKey | null>(null);
  const [marketReady, setMarketReady] = useState(false);

  // undefined = nothing painted yet; otherwise the userId the painted data belongs to.
  const paintedUserIdRef = useRef<string | null | undefined>(undefined);
  const hasPaintedRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let storedOverride: PricingMarketKey | null = null;
    try {
      const stored = window.localStorage.getItem(PRICING_MARKET_STORAGE_KEY);
      if (stored === 'IN' || stored === 'ROW') {
        storedOverride = stored;
        setMarketOverrideState(stored);
      }
    } finally {
      // Paint the last known pricing context immediately (before auth resolves)
      // so coins/plan render instantly; the background load reconciles it.
      const snapshot = readStoredPricingSnapshot(storedOverride);
      if (snapshot) {
        setData(snapshot.data);
        setIsLoading(false);
        paintedUserIdRef.current = snapshot.userId;
        hasPaintedRef.current = true;
      }
      setMarketReady(true);
    }
  }, []);

  const load = useCallback(async (options: { forceRefresh?: boolean } = {}) => {
    if (inFlightRef.current) {
      if (!options.forceRefresh) {
        return inFlightRef.current;
      }
      await inFlightRef.current.catch(() => {});
    }

    const run = (async () => {
      if (!hasPaintedRef.current) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const next = await getPricingRuntimeContext({
          pricingMarketKey: marketOverride,
          forceRefresh: options.forceRefresh,
        });
        setData(next);
        hasPaintedRef.current = true;
        paintedUserIdRef.current = next.userId;
        writeStoredPricingSnapshot({
          cachedAt: Date.now(),
          userId: next.userId,
          marketOverride,
          data: next,
        });
      } catch (err: any) {
        setError(err?.message || 'Failed to load pricing context');
        if (!hasPaintedRef.current) {
          setData(DEFAULT_PRICING_RUNTIME_CONTEXT);
        }
      } finally {
        setIsLoading(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = run;
    return run;
  }, [marketOverride]);

  const setMarketOverride = useCallback((value: PricingMarketKey | null) => {
    setMarketOverrideState(value);

    if (value) {
      window.localStorage.setItem(PRICING_MARKET_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(PRICING_MARKET_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !marketReady) {
      return;
    }

    // The painted snapshot belongs to a different account (user switch or
    // sign-out) — drop it and show defaults until the fresh load lands.
    const currentUserId = user?.id ?? null;
    if (paintedUserIdRef.current !== undefined && paintedUserIdRef.current !== currentUserId) {
      clearStoredPricingSnapshot();
      paintedUserIdRef.current = undefined;
      hasPaintedRef.current = false;
      setData(DEFAULT_PRICING_RUNTIME_CONTEXT);
      setIsLoading(true);
    }

    void load();
  }, [authLoading, load, marketReady, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleRefresh = () => {
      if (!authLoading && marketReady) {
        void load({ forceRefresh: true });
      }
    };

    window.addEventListener(PRICING_RUNTIME_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(PRICING_RUNTIME_REFRESH_EVENT, handleRefresh);
  }, [authLoading, load, marketReady]);

  const refresh = useCallback(() => load({ forceRefresh: true }), [load]);

  const value = useMemo<PricingRuntimeContextValue>(() => ({
    data,
    isLoading,
    error,
    marketOverride,
    setMarketOverride,
    refresh,
  }), [data, error, isLoading, marketOverride, refresh, setMarketOverride]);

  return (
    <PricingRuntimeContextValue.Provider value={value}>
      {children}
    </PricingRuntimeContextValue.Provider>
  );
}

export function usePricingRuntime() {
  return useContext(PricingRuntimeContextValue);
}
