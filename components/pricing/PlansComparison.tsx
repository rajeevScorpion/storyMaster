'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import KissagoLogo from '@/components/ui/KissagoLogo';
import UserMenu from '@/components/auth/UserMenu';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { getPricingWalletPageData } from '@/app/actions/pricing-runtime';
import { formatCurrencyMinor } from '@/lib/billing/wallet-tax.shared';
import { buildPlanFeatures } from '@/lib/pricing/plan-copy.shared';
import {
  describeVideoExportQuality,
  describeWatchAllowance,
  formatPlanPriceCell,
  resolvePlansCta,
  type PlansCtaState,
} from '@/lib/pricing/plans-comparison.shared';
import type { PlanKey, PricingPlanOfferCard, PricingWalletPageData } from '@/lib/types/pricing';

interface PlansComparisonProps {
  initialWalletData: PricingWalletPageData;
  initialCurrentPlanKey: PlanKey;
  initialUserId: string | null;
  initialFreeDailyWatchQuota: number;
}

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit G execution spec): the public plan
 * comparison content. Never loads Razorpay and never opens checkout itself -- every buy path is a
 * plain link to /wallet?checkout=<planVersionId>, which is the only route served without COEP
 * (lib/navigation/cross-origin-isolation.shared.ts) and owns the actual checkout sheet.
 */
export default function PlansComparison({
  initialWalletData,
  initialCurrentPlanKey,
  initialUserId,
  initialFreeDailyWatchQuota,
}: PlansComparisonProps) {
  const { openAuthDialog } = useAuth();
  const { data: pricingData, isLoading: pricingLoading } = usePricingRuntime();
  const prefersReducedMotion = useReducedMotion();

  const [walletData, setWalletData] = useState<PricingWalletPageData>(initialWalletData);
  const [offersRefreshing, setOffersRefreshing] = useState(false);

  const resolvedMarketKey = pricingData.snapshot.pricingMarketKey;
  // While the client pricing hook is still resolving, its first render is always the same
  // signed-out-shaped default (see PricingRuntimeProvider.DEFAULT_PRICING_RUNTIME_CONTEXT) -- reading
  // it directly here would flash a signed-in visitor's own comparison page back to "Sign in" CTAs for
  // a moment. The server-resolved initial values match what was actually rendered, so hydration never
  // disagrees with the first client paint either.
  const currentPlanKey = pricingLoading ? initialCurrentPlanKey : pricingData.snapshot.planKey;
  const userId = pricingLoading ? initialUserId : pricingData.userId;
  const freeDailyWatchQuota = pricingLoading ? initialFreeDailyWatchQuota : pricingData.controls.freeDailyWatchQuota;

  const loadOffers = useCallback(async () => {
    setOffersRefreshing(true);
    try {
      const next = await getPricingWalletPageData({ pricingMarketKey: resolvedMarketKey, currentPlanKey });
      setWalletData(next);
    } catch {
      // Keep whatever is already on screen -- a public comparison page degrading to the last good
      // catalogue beats an error screen.
    } finally {
      setOffersRefreshing(false);
    }
  }, [resolvedMarketKey, currentPlanKey]);

  useEffect(() => {
    if (pricingLoading) return;
    void loadOffers();
  }, [loadOffers, pricingLoading]);

  const offers = walletData.planOffers;

  return (
    <main className="relative min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-40 bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-transparent"
      />

      <KissagoLogo />

      <div className="fixed top-4 right-4 z-40">
        <UserMenu />
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-[clamp(5.5rem,18vh,8rem)]">
        <motion.div
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: prefersReducedMotion ? 0.01 : 0.45 }}
          className="mb-8 space-y-3"
        >
          <Link
            href="/"
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-neutral-400 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10 hover:text-neutral-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to storymaking
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h1 className="text-3xl font-serif text-neutral-100 md:text-4xl">Plans</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-400">
                Every plan includes the same characters, setting, and visual continuity. Pick the one that
                matches how much you create and watch.
              </p>
            </div>
            {offersRefreshing && <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />}
          </div>
        </motion.div>

        <div
          data-testid="plans-table"
          className="hidden overflow-x-auto rounded-[28px] border border-white/10 bg-white/5 backdrop-blur-md md:block"
        >
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th scope="col" className="w-40 px-5 py-5 text-xs uppercase tracking-[0.18em] text-neutral-500">
                  Plan
                </th>
                {offers.map((offer) => (
                  <th key={offer.planKey} scope="col" className="px-5 py-5 align-top">
                    <span className="text-lg font-serif text-neutral-100">{offer.name}</span>
                    {offer.isCurrentPlan && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 align-middle text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                        Current
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <ComparisonRow label="Price">
                {offers.map((offer) => (
                  <td key={offer.planKey} className="px-5 py-4 text-neutral-100">
                    {formatPlanPriceCell({
                      planKey: offer.planKey,
                      monthlyPriceMinor: offer.monthlyPriceMinor,
                      priceLabel: formatCurrencyMinor(offer.currencyCode, offer.monthlyPriceMinor ?? 0),
                    })}
                    {offer.monthlyPriceMinor != null && offer.annualPriceMinor != null && (
                      <span className="mt-1 block text-xs text-neutral-500">
                        {formatCurrencyMinor(offer.currencyCode, offer.annualPriceMinor)} / year + GST
                      </span>
                    )}
                  </td>
                ))}
              </ComparisonRow>
              <ComparisonRow label="Coins a month">
                {offers.map((offer) => (
                  <td key={offer.planKey} className="px-5 py-4 text-neutral-300">
                    {offer.monthlyCoins > 0 ? offer.monthlyCoins.toLocaleString() : '—'}
                  </td>
                ))}
              </ComparisonRow>
              <ComparisonRow label="Watching">
                {offers.map((offer) => (
                  <td key={offer.planKey} className="px-5 py-4 text-neutral-300">
                    {describeWatchAllowance(offer.unlimitedWatching, freeDailyWatchQuota)}
                  </td>
                ))}
              </ComparisonRow>
              <ComparisonRow label="Story length">
                {offers.map((offer) => (
                  <td key={offer.planKey} className="px-5 py-4 text-neutral-300">
                    {offer.storyLengthCap} beats
                  </td>
                ))}
              </ComparisonRow>
              <ComparisonRow label="Downloads">
                {offers.map((offer) => (
                  <td key={offer.planKey} className="px-5 py-4 text-neutral-300">
                    {offer.canAccessDownloads ? '✓' : '—'}
                  </td>
                ))}
              </ComparisonRow>
              <ComparisonRow label="Unbranded exports">
                {offers.map((offer) => (
                  <td key={offer.planKey} className="px-5 py-4 text-neutral-300">
                    {offer.canAccessUnbrandedExports ? '✓' : '—'}
                  </td>
                ))}
              </ComparisonRow>
              <ComparisonRow label="Creator controls">
                {offers.map((offer) => (
                  <td key={offer.planKey} className="px-5 py-4 text-neutral-300">
                    {offer.creatorControls ? '✓' : '—'}
                  </td>
                ))}
              </ComparisonRow>
              <ComparisonRow label="Video export quality">
                {offers.map((offer) => (
                  <td key={offer.planKey} className="px-5 py-4 text-neutral-300">
                    {describeVideoExportQuality(offer.videoExportPreset)}
                  </td>
                ))}
              </ComparisonRow>
              <tr>
                <td className="px-5 py-5" />
                {offers.map((offer) => (
                  <td key={offer.planKey} className="px-5 py-5 align-top">
                    <PlanCta
                      cta={resolvePlansCta({ offer, currentPlanKey, userId })}
                      onSignIn={() => openAuthDialog('sign_in', '/plans')}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <div data-testid="plans-cards" className="grid gap-4 md:hidden">
          {offers.map((offer) => {
            const cta = resolvePlansCta({ offer, currentPlanKey, userId });
            const features = buildPlanFeatures(offer, walletData, offers);
            return (
              <article
                key={offer.planKey}
                className={`rounded-3xl border p-5 ${offer.isCurrentPlan ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-white/10 bg-neutral-900/60'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-lg font-serif text-neutral-100">{offer.name}</p>
                  {offer.isCurrentPlan && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                      Current
                    </span>
                  )}
                </div>

                <p className="mt-3 text-2xl font-medium text-neutral-100">
                  {formatPlanPriceCell({
                    planKey: offer.planKey,
                    monthlyPriceMinor: offer.monthlyPriceMinor,
                    priceLabel: formatCurrencyMinor(offer.currencyCode, offer.monthlyPriceMinor ?? 0),
                  })}
                </p>

                <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs text-neutral-400">
                  <dt>Coins a month</dt>
                  <dd className="text-right text-neutral-200">{offer.monthlyCoins > 0 ? offer.monthlyCoins.toLocaleString() : '—'}</dd>
                  <dt>Watching</dt>
                  <dd className="text-right text-neutral-200">{describeWatchAllowance(offer.unlimitedWatching, freeDailyWatchQuota)}</dd>
                  <dt>Story length</dt>
                  <dd className="text-right text-neutral-200">{offer.storyLengthCap} beats</dd>
                  <dt>Downloads</dt>
                  <dd className="text-right text-neutral-200">{offer.canAccessDownloads ? '✓' : '—'}</dd>
                  <dt>Unbranded exports</dt>
                  <dd className="text-right text-neutral-200">{offer.canAccessUnbrandedExports ? '✓' : '—'}</dd>
                  <dt>Creator controls</dt>
                  <dd className="text-right text-neutral-200">{offer.creatorControls ? '✓' : '—'}</dd>
                  <dt>Video export</dt>
                  <dd className="text-right text-neutral-200">{describeVideoExportQuality(offer.videoExportPreset)}</dd>
                </dl>

                {features.length > 0 && (
                  <ul className="mt-4 space-y-2 border-t border-white/10 pt-4">
                    {features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm text-neutral-300">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-400/80" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-5">
                  <PlanCta cta={cta} onSignIn={() => openAuthDialog('sign_in', '/plans')} />
                </div>
              </article>
            );
          })}
        </div>

        <p className="mt-8 max-w-3xl text-xs leading-relaxed text-neutral-500">
          Prices exclude GST, which is added at checkout. Coins reset each cycle and don&apos;t roll over.
          Top-up coins never expire. See the{' '}
          <Link href="/terms" className="text-emerald-300 underline-offset-2 hover:underline">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/refund-policy" className="text-emerald-300 underline-offset-2 hover:underline">
            Refund Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}

function ComparisonRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-white/5 last:border-b-0">
      <th scope="row" className="px-5 py-4 text-xs uppercase tracking-[0.14em] text-neutral-500 font-normal">
        {label}
      </th>
      {children}
    </tr>
  );
}

function PlanCta({ cta, onSignIn }: { cta: PlansCtaState; onSignIn: () => void }) {
  if (cta.kind === 'free') {
    return <p className="text-sm text-neutral-400">Included with every account</p>;
  }

  if (cta.kind === 'coming_soon') {
    return <p className="text-sm text-neutral-500">—</p>;
  }

  if (cta.kind === 'sign_in') {
    return (
      <button
        type="button"
        onClick={onSignIn}
        className="w-full cursor-pointer rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/40 hover:bg-emerald-500/15"
      >
        {cta.label}
      </button>
    );
  }

  if (cta.kind === 'current') {
    return (
      <button
        type="button"
        disabled
        className="w-full cursor-not-allowed rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-neutral-400 opacity-70"
      >
        {cta.label}
      </button>
    );
  }

  if (cta.kind === 'switch_after') {
    return (
      <div>
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-neutral-400 opacity-70"
        >
          {cta.label}
        </button>
        <p className="mt-2 text-xs text-neutral-500">
          Cancel your current plan in{' '}
          <Link href="/account/billing" className="text-emerald-300 underline-offset-2 hover:underline">
            Billing
          </Link>
          , then choose this one once it ends.
        </p>
      </div>
    );
  }

  return (
    <Link
      href={`/wallet?checkout=${cta.planVersionId}`}
      className="block w-full cursor-pointer rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-center text-sm text-neutral-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10"
    >
      {cta.label}
    </Link>
  );
}
