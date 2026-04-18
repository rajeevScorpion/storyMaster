'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { useAuth } from '@/lib/hooks/useAuth';
import { PRICING_RUNTIME_REFRESH_EVENT } from '@/lib/pricing/runtime-events';
import type { PricingMarketKey, PricingRuntimeContext } from '@/lib/types/pricing';

interface PricingRuntimeContextValue {
  data: PricingRuntimeContext;
  isLoading: boolean;
  error: string | null;
  marketOverride: PricingMarketKey | null;
  setMarketOverride: (value: PricingMarketKey | null) => void;
  refresh: () => Promise<void>;
}

const PRICING_MARKET_STORAGE_KEY = 'kissago_pricing_market_override';

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
    continue_story_new_beat: 1,
    preview_seed_plan: 0,
    regenerate_image: 1,
    regenerate_narration: 1,
    export_video_future: 5,
  },
  snapshot: {
    pricingMarketKey: 'ROW',
    routingProvider: 'stripe',
    planKey: 'free',
    planTierRank: 1,
    planVersionId: null,
    monthlyIncludedBeats: 12,
    billingProvider: null,
    billingInterval: null,
    billingCountryCode: null,
    currencyCode: 'USD',
    billingStatus: 'free',
    isInGracePeriod: false,
    currentPeriodEndsAt: null,
    gracePeriodEndsAt: null,
    nextResetAt: null,
    storyLengthCap: 4,
    canAccessDownloads: false,
    canAccessUnbrandedExports: false,
    creatorControls: false,
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

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PRICING_MARKET_STORAGE_KEY);
      if (stored === 'IN' || stored === 'ROW') {
        setMarketOverrideState(stored);
      }
    } finally {
      setMarketReady(true);
    }
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const next = await getPricingRuntimeContext({ pricingMarketKey: marketOverride });
      setData(next);
    } catch (err: any) {
      setError(err?.message || 'Failed to load pricing context');
      setData(DEFAULT_PRICING_RUNTIME_CONTEXT);
    } finally {
      setIsLoading(false);
    }
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

    void load();
  }, [authLoading, load, marketReady, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleRefresh = () => {
      if (!authLoading && marketReady) {
        void load();
      }
    };

    window.addEventListener(PRICING_RUNTIME_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(PRICING_RUNTIME_REFRESH_EVENT, handleRefresh);
  }, [authLoading, load, marketReady]);

  const value = useMemo<PricingRuntimeContextValue>(() => ({
    data,
    isLoading,
    error,
    marketOverride,
    setMarketOverride,
    refresh: load,
  }), [data, error, isLoading, load, marketOverride, setMarketOverride]);

  return (
    <PricingRuntimeContextValue.Provider value={value}>
      {children}
    </PricingRuntimeContextValue.Provider>
  );
}

export function usePricingRuntime() {
  return useContext(PricingRuntimeContextValue);
}
