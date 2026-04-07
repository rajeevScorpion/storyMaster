'use client';

import { usePricingRuntime as usePricingRuntimeContext } from '@/components/pricing/PricingRuntimeProvider';

export function usePricingRuntime() {
  return usePricingRuntimeContext();
}
