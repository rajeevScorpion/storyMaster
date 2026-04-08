export const PRICING_RUNTIME_REFRESH_EVENT = 'kissago:pricing-runtime-refresh';

export function dispatchPricingRuntimeRefresh(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(PRICING_RUNTIME_REFRESH_EVENT));
}
