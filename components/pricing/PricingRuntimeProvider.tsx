'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { useAuth } from '@/lib/hooks/useAuth';
import type { PricingRuntimeContext } from '@/lib/types/pricing';

interface PricingRuntimeContextValue {
  data: PricingRuntimeContext;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DEFAULT_PRICING_RUNTIME_CONTEXT: PricingRuntimeContext = {
  userId: null,
  controls: {
    pricingAdminTabEnabled: false,
    pricingSnapshotEnabled: false,
    pricingCheckoutEnabled: false,
    pricingShadowMeteringEnabled: false,
    pricingHardEnforcementEnabled: false,
    pricingStoryLengthUiLimitsEnabled: false,
    defaultGracePeriodDays: 5,
    defaultCarryForwardCapMultiplier: 2,
    reservationTimeoutSeconds: 1800,
    migrationGrantBeats: 25,
    testerStudioDurationDays: 90,
    routingProviderIn: 'razorpay',
    routingProviderRow: 'stripe',
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
    nextResetAt: null,
    storyLengthCap: 4,
    canAccessDownloads: false,
    canAccessUnbrandedExports: false,
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
  refresh: async () => {},
});

export default function PricingRuntimeProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<PricingRuntimeContext>(DEFAULT_PRICING_RUNTIME_CONTEXT);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const next = await getPricingRuntimeContext();
      setData(next);
    } catch (err: any) {
      setError(err?.message || 'Failed to load pricing context');
      setData(DEFAULT_PRICING_RUNTIME_CONTEXT);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    void load();
  }, [authLoading, load, user?.id]);

  const value = useMemo<PricingRuntimeContextValue>(() => ({
    data,
    isLoading,
    error,
    refresh: load,
  }), [data, error, isLoading, load]);

  return (
    <PricingRuntimeContextValue.Provider value={value}>
      {children}
    </PricingRuntimeContextValue.Provider>
  );
}

export function usePricingRuntime() {
  return useContext(PricingRuntimeContextValue);
}
