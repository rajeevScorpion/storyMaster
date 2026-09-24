import type { Metadata } from 'next';
import { getPricingRuntimeContext, getPricingWalletPageData } from '@/app/actions/pricing-runtime';
import PlansComparison from '@/components/pricing/PlansComparison';

// Public, and depends on the viewer's session (current plan) and the live catalogue -- resolved per
// request rather than at build time, same as /wallet and the gallery.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Plans',
};

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit G execution spec): the public plan
 * comparison. A thin server shell for first paint -- PlansComparison reconciles against the live
 * usePricingRuntime() client hook afterwards, the same way WalletPage does, so a sign-in that
 * happens without leaving the page (the auth dialog, not a redirect) still lands on the right CTAs.
 */
export default async function PlansPage() {
  const context = await getPricingRuntimeContext();
  const walletData = await getPricingWalletPageData({
    pricingMarketKey: context.snapshot.pricingMarketKey,
    currentPlanKey: context.snapshot.planKey,
  });

  return (
    <PlansComparison
      initialWalletData={walletData}
      initialCurrentPlanKey={context.snapshot.planKey}
      initialUserId={context.userId}
      initialFreeDailyWatchQuota={context.controls.freeDailyWatchQuota}
    />
  );
}
