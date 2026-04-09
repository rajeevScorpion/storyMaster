'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Clock3, Coins, CreditCard, Loader2, Sparkles, Star, Wallet as WalletIcon } from 'lucide-react';
import { motion } from 'motion/react';
import KissagoLogo from '@/components/ui/KissagoLogo';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import { RAZORPAY_CHECKOUT_SCRIPT_URL } from '@/lib/billing/razorpay-shared';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { PRICING_RUNTIME_REFRESH_EVENT } from '@/lib/pricing/runtime-events';
import { getPricingWalletPageData } from '@/app/actions/pricing-runtime';
import type {
  BillingInterval,
  PreparedRazorpayCheckout,
  PricingPlanOfferCard,
  PricingWalletPageData,
} from '@/lib/types/pricing';
import { COINS_PER_BEAT } from '@/lib/types/pricing';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on?: (event: string, handler: (payload: any) => void) => void;
    };
  }
}

function formatPrice(currencyCode: string, amountMinor: number | null) {
  if (amountMinor == null) {
    return 'Coming soon';
  }

  const locale = currencyCode === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function formatDate(value: string | null) {
  if (!value) return 'Not scheduled yet';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getSelectedPlanVersionId(offer: PricingPlanOfferCard, interval: BillingInterval) {
  return interval === 'annual'
    ? offer.annualPlanVersionId
    : offer.monthlyPlanVersionId;
}

function getSelectedPlanProvider(offer: PricingPlanOfferCard, interval: BillingInterval) {
  return interval === 'annual'
    ? offer.annualProvider
    : offer.monthlyProvider;
}

function getSelectedPlanPriceMinor(offer: PricingPlanOfferCard, interval: BillingInterval) {
  return interval === 'annual'
    ? offer.annualPriceMinor
    : offer.monthlyPriceMinor;
}

async function requestPreparedRazorpayCheckout(
  payload: {
    input: {
      kind: 'subscription';
      planVersionId: string;
    } | {
      kind: 'topup';
      topupPackId: string;
    };
    pricingMarketKey: 'IN' | 'ROW';
  }
): Promise<PreparedRazorpayCheckout> {
  const response = await fetch('/api/billing/razorpay/prepare', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  let data: { ok?: boolean; error?: string; checkout?: PreparedRazorpayCheckout } | null = null;

  if (rawText) {
    try {
      data = JSON.parse(rawText) as { ok?: boolean; error?: string; checkout?: PreparedRazorpayCheckout };
    } catch {
      data = null;
    }
  }

  if (!response.ok || !data?.ok) {
    const fallbackError =
      rawText && !data
        ? rawText.slice(0, 500)
        : 'Failed to prepare Razorpay checkout';
    throw new Error(data?.error || fallbackError);
  }

  return data.checkout as PreparedRazorpayCheckout;
}

export default function WalletPage() {
  const router = useRouter();
  const pricing = usePricingRuntime();
  const {
    data: pricingData,
    isLoading: pricingLoading,
    marketOverride,
    setMarketOverride,
    refresh: refreshPricing,
  } = pricing;
  const [showMyStories, setShowMyStories] = useState(false);
  const [walletData, setWalletData] = useState<PricingWalletPageData | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<string | null>(null);
  const [selectedPlanInterval, setSelectedPlanInterval] = useState<BillingInterval>('monthly');
  const [checkoutBusyKey, setCheckoutBusyKey] = useState<string | null>(null);
  const [razorpayReady, setRazorpayReady] = useState(false);

  const loadWalletData = useCallback(async () => {
    setWalletLoading(true);
    setWalletError(null);

    try {
      const next = await getPricingWalletPageData({
        pricingMarketKey: marketOverride,
      });
      setWalletData(next);
    } catch (err: any) {
      setWalletError(err?.message || 'Failed to load wallet details');
    } finally {
      setWalletLoading(false);
    }
  }, [marketOverride]);

  useEffect(() => {
    void loadWalletData();
  }, [loadWalletData, pricingData.userId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleRefresh = () => {
      void loadWalletData();
    };

    window.addEventListener(PRICING_RUNTIME_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(PRICING_RUNTIME_REFRESH_EVENT, handleRefresh);
  }, [loadWalletData]);

  const usingRazorpayMarket = pricingData.snapshot.routingProvider === 'razorpay';
  const yearlyCheckoutDeferred =
    usingRazorpayMarket && pricingData.snapshot.pricingMarketKey === 'IN';

  useEffect(() => {
    if (yearlyCheckoutDeferred && selectedPlanInterval === 'annual') {
      setSelectedPlanInterval('monthly');
    }
  }, [selectedPlanInterval, yearlyCheckoutDeferred]);

  const showAllowancePreview =
    !pricingData.userId || !pricingData.controls.pricingSnapshotEnabled;
  const totalCoins = pricingData.snapshot.availableTotalBeats * COINS_PER_BEAT;
  const monthlyAllowanceCoins = pricingData.snapshot.monthlyIncludedBeats * COINS_PER_BEAT;
  const displayHeadlineCoins = showAllowancePreview ? monthlyAllowanceCoins : totalCoins;
  const subscriptionCoins = pricingData.snapshot.availableSubscriptionBeats * COINS_PER_BEAT;
  const displaySubscriptionCoins = showAllowancePreview ? monthlyAllowanceCoins : subscriptionCoins;
  const topupCoins = pricingData.snapshot.availableTopupBeats * COINS_PER_BEAT;
  const bonusCoins = pricingData.snapshot.availablePromoBeats * COINS_PER_BEAT;

  const offers = walletData?.planOffers ?? [];
  const topups = walletData?.topupOffers ?? [];
  const activity = walletData?.recentActivity ?? [];

  const currentPlan = offers.find((offer) => offer.isCurrentPlan) ?? null;
  const primaryTopup = topups[0] ?? null;
  const marketLabel = pricingData.snapshot.pricingMarketKey === 'IN' ? 'India' : 'Outside India';
  const headlineActionDisabled =
    !walletData?.checkoutEnabled ||
    !pricingData.userId ||
    !usingRazorpayMarket ||
    !razorpayReady;

  const handlePlanCheckout = useCallback(async (offer: PricingPlanOfferCard) => {
    const planVersionId = getSelectedPlanVersionId(offer, selectedPlanInterval);
    const provider = getSelectedPlanProvider(offer, selectedPlanInterval);

    if (
      selectedPlanInterval === 'annual' &&
      pricingData.snapshot.pricingMarketKey === 'IN' &&
      pricingData.snapshot.routingProvider === 'razorpay'
    ) {
      setCheckoutError('Yearly checkout for India comes a little later. Use monthly plans while we test monthly refills end to end.');
      return;
    }

    if (!planVersionId) {
      setCheckoutError('This plan interval is not ready yet.');
      return;
    }

    if (provider !== 'razorpay') {
      setCheckoutError('Razorpay checkout is available only for the India market in this launch slice.');
      return;
    }

    setCheckoutBusyKey(`plan:${offer.planKey}`);
    setCheckoutError(null);
    setCheckoutStatus(null);

    try {
      const checkout = await requestPreparedRazorpayCheckout({
        input: {
          kind: 'subscription',
          planVersionId,
        },
        pricingMarketKey: pricingData.snapshot.pricingMarketKey,
      });

      const message = await openRazorpayCheckout(checkout);
      setCheckoutStatus(message);
      await refreshPricing();
      await loadWalletData();
      router.refresh();
    } catch (err: any) {
      if (err?.message !== 'Razorpay checkout dismissed') {
        setCheckoutError(err?.message || 'Failed to start Razorpay checkout');
      }
    } finally {
      setCheckoutBusyKey(null);
    }
  }, [loadWalletData, pricingData.snapshot.pricingMarketKey, pricingData.snapshot.routingProvider, refreshPricing, router, selectedPlanInterval]);

  const handleTopupCheckout = useCallback(async (topupPackId: string, packKey: string, provider: string | null) => {
    if (provider !== 'razorpay') {
      setCheckoutError('Razorpay checkout is available only for the India market in this launch slice.');
      return;
    }

    setCheckoutBusyKey(`topup:${packKey}`);
    setCheckoutError(null);
    setCheckoutStatus(null);

    try {
      const checkout = await requestPreparedRazorpayCheckout({
        input: {
          kind: 'topup',
          topupPackId,
        },
        pricingMarketKey: pricingData.snapshot.pricingMarketKey,
      });

      const message = await openRazorpayCheckout(checkout);
      setCheckoutStatus(message);
      await refreshPricing();
      await loadWalletData();
      router.refresh();
    } catch (err: any) {
      if (err?.message !== 'Razorpay checkout dismissed') {
        setCheckoutError(err?.message || 'Failed to start Razorpay checkout');
      }
    } finally {
      setCheckoutBusyKey(null);
    }
  }, [loadWalletData, pricingData.snapshot.pricingMarketKey, refreshPricing, router]);

  return (
    <main className="relative min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      {walletData?.checkoutEnabled && usingRazorpayMarket && (
        <Script
          src={RAZORPAY_CHECKOUT_SCRIPT_URL}
          strategy="afterInteractive"
          onLoad={() => setRazorpayReady(true)}
          onError={() => setCheckoutError('Failed to load Razorpay checkout. Please refresh and try again.')}
        />
      )}

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-40 bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-transparent"
      />

      <KissagoLogo />

      <div className="fixed top-4 right-4 z-40">
        <UserMenu onMyStories={() => setShowMyStories(true)} />
      </div>

      <MyStoriesDrawer isOpen={showMyStories} onClose={() => setShowMyStories(false)} />

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-[clamp(5.5rem,18vh,8rem)]">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-8 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="space-y-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-neutral-400 hover:border-white/20 hover:text-neutral-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to storymaking
            </Link>
            <div>
              <h1 className="text-3xl font-serif text-neutral-100 md:text-4xl">Wallet & Billing</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-400">
                Keep an eye on your coins, plan benefits, and recent activity without losing the joy of creating.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur-md">
            <p className="px-2 pb-2 text-[11px] uppercase tracking-[0.18em] text-neutral-500">Checkout market</p>
            <div className="grid grid-cols-2 gap-2">
              <MarketButton
                label="India"
                active={pricingData.snapshot.pricingMarketKey === 'IN'}
                onClick={() => setMarketOverride('IN')}
              />
              <MarketButton
                label="Outside India"
                active={pricingData.snapshot.pricingMarketKey === 'ROW'}
                onClick={() => setMarketOverride('ROW')}
              />
            </div>
          </div>
        </motion.div>

        <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-300/80">
                  {pricingLoading ? 'Loading plan' : `${titleCase(pricingData.snapshot.planKey)} plan · ${marketLabel}`}
                </p>
                <h2 className="mt-2 text-4xl font-serif text-neutral-100 md:text-5xl">
                  {pricingLoading ? '...' : displayHeadlineCoins.toLocaleString()}
                  <span className="ml-2 text-base font-sans text-neutral-400">
                    {showAllowancePreview ? 'coins / month' : 'coins remaining'}
                  </span>
                </h2>
                <p className="mt-3 text-sm text-neutral-400">
                  {showAllowancePreview
                    ? 'This is your plan allowance preview. Once live pricing is switched on for this environment, this area will show the real coins in your wallet.'
                    : totalCoins > 0
                    ? pricingData.snapshot.isInGracePeriod
                    ? `A renewal payment needs attention. Your access stays active until ${formatDate(pricingData.snapshot.gracePeriodEndsAt ?? pricingData.snapshot.currentPeriodEndsAt)}.`
                    : pricingData.snapshot.nextResetAt
                    ? `Your plan refills on ${formatDate(pricingData.snapshot.nextResetAt)}.`
                    : 'You can keep creating with your current wallet balance.'
                    : pricingData.snapshot.nextResetAt
                    ? `Your wallet is empty right now. It refills on ${formatDate(pricingData.snapshot.nextResetAt)} unless you top up first.`
                    : 'Your wallet is empty right now. Top up or change plans to keep creating.'}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={headlineActionDisabled || checkoutBusyKey !== null}
                  onClick={() => {
                    const nextPlan = offers.find((offer) => !offer.isCurrentPlan && getSelectedPlanProvider(offer, selectedPlanInterval) === 'razorpay') ?? null;
                    if (nextPlan) {
                      void handlePlanCheckout(nextPlan);
                    }
                  }}
                  className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {!pricingData.userId
                    ? 'Sign in to continue'
                    : !walletData?.checkoutEnabled
                    ? 'Upgrade coming soon'
                    : !usingRazorpayMarket
                    ? 'India checkout first'
                    : yearlyCheckoutDeferred && checkoutBusyKey === null
                    ? 'Upgrade plan'
                    : !razorpayReady
                    ? 'Loading checkout'
                    : checkoutBusyKey !== null
                    ? 'Opening checkout...'
                    : 'Upgrade plan'}
                </button>
                <button
                  type="button"
                  disabled={headlineActionDisabled || !primaryTopup || checkoutBusyKey !== null}
                  onClick={() => {
                    if (primaryTopup) {
                      void handleTopupCheckout(primaryTopup.topupPackId, primaryTopup.packKey, primaryTopup.provider);
                    }
                  }}
                  className="rounded-2xl border border-white/10 bg-neutral-900/60 px-4 py-2.5 text-sm text-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {!pricingData.userId
                    ? 'Sign in to continue'
                    : !walletData?.checkoutEnabled
                    ? 'Top-ups coming soon'
                    : !usingRazorpayMarket
                    ? 'India checkout first'
                    : !razorpayReady
                    ? 'Loading checkout'
                    : checkoutBusyKey !== null
                    ? 'Opening checkout...'
                    : 'Buy coins'}
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <BalanceCard
                icon={CreditCard}
                label="Subscription coins"
                value={displaySubscriptionCoins}
                hint={showAllowancePreview ? 'Preview of your monthly plan refill' : 'Monthly refill bucket'}
              />
              <BalanceCard icon={WalletIcon} label="Top-up coins" value={topupCoins} hint="Non-expiring coin packs" />
              <BalanceCard icon={Sparkles} label="Bonus coins" value={bonusCoins} hint="Promos and rewards" />
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-white/5 p-3 text-emerald-300">
                <Clock3 className="h-5 w-5" />
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">Current plan</p>
                  <p className="mt-2 text-xl font-serif text-neutral-100">
                    {currentPlan ? currentPlan.name : titleCase(pricingData.snapshot.planKey)}
                  </p>
                </div>
                <div className="space-y-2 text-sm text-neutral-400">
                  <p>{pricingData.snapshot.storyLengthCap} beats per story</p>
                  <p>{pricingData.snapshot.currencyCode} market pricing</p>
                  <p>{pricingData.snapshot.canAccessDownloads ? 'Downloads included' : 'Downloads not included yet'}</p>
                  <p>{pricingData.snapshot.canAccessUnbrandedExports ? 'Unbranded exports included' : 'Branded sharing included'}</p>
                  <p>{usingRazorpayMarket ? 'Razorpay checkout path is active for this market' : 'Razorpay launches for India first in this phase'}</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        {(walletError || checkoutError || checkoutStatus || (walletData?.checkoutEnabled && !usingRazorpayMarket)) && (
          <div className="mt-6 space-y-3">
            {walletError && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {walletError}
              </div>
            )}
            {checkoutError && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {checkoutError}
              </div>
            )}
            {checkoutStatus && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {checkoutStatus}
              </div>
            )}
            {walletData?.checkoutEnabled && !usingRazorpayMarket && (
              <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                Razorpay is the first checkout path being integrated. Switch the market selector to India to test real checkout buttons for now.
              </div>
            )}
          </div>
        )}

        <div className="mt-8 space-y-8">
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-2xl font-serif text-neutral-100">Plans</h3>
                <p className="mt-1 text-sm text-neutral-400">Choose the rhythm that fits how you create with Kissago.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-1">
                  <button
                    type="button"
                    onClick={() => setSelectedPlanInterval('monthly')}
                    className={`rounded-xl px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${selectedPlanInterval === 'monthly' ? 'bg-emerald-500/15 text-emerald-200' : 'text-neutral-500'}`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPlanInterval('annual')}
                    disabled={yearlyCheckoutDeferred}
                    className={`rounded-xl px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${selectedPlanInterval === 'annual' ? 'bg-emerald-500/15 text-emerald-200' : 'text-neutral-500'} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    Yearly
                  </button>
                </div>
                {walletLoading && <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />}
              </div>
            </div>

            {yearlyCheckoutDeferred && (
              <div className="mb-5 rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                India checkout is monthly-only for this stage rollout. Yearly plans stay out of checkout until monthly refills for annual billing are ready.
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              {offers.map((offer) => {
                const selectedPrice = getSelectedPlanPriceMinor(offer, selectedPlanInterval);
                const selectedProvider = getSelectedPlanProvider(offer, selectedPlanInterval);
                const buttonDisabled =
                  offer.isCurrentPlan ||
                  !pricingData.userId ||
                  !walletData?.checkoutEnabled ||
                  (yearlyCheckoutDeferred && selectedPlanInterval === 'annual') ||
                  selectedProvider == null ||
                  selectedProvider !== 'razorpay' ||
                  !razorpayReady ||
                  checkoutBusyKey !== null;

                return (
                  <article
                    key={offer.planKey}
                    className={`flex h-full flex-col rounded-3xl border p-5 ${offer.isCurrentPlan ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-white/10 bg-neutral-900/60'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-serif text-neutral-100">{offer.name}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-neutral-500">{offer.monthlyCoins.toLocaleString()} coins / month</p>
                      </div>
                      {offer.isCurrentPlan && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                          <CheckCircle2 className="h-3 w-3" />
                          Current
                        </span>
                      )}
                    </div>

                    <p className="mt-4 text-sm leading-relaxed text-neutral-400">
                      {offer.description || 'Thoughtfully tuned for a different pace of storymaking.'}
                    </p>

                    <div className="mt-5 space-y-2 text-sm text-neutral-300">
                      <p>{offer.storyLengthCap} beats per story</p>
                      <p>{selectedPrice === 0 ? 'Free' : `${formatPrice(offer.currencyCode, selectedPrice)} ${selectedPlanInterval}`}</p>
                      {offer.monthlyPriceMinor != null && offer.annualPriceMinor != null && (
                        <p className="text-neutral-500">
                          {formatPrice(offer.currencyCode, offer.monthlyPriceMinor)} monthly · {formatPrice(offer.currencyCode, offer.annualPriceMinor)} yearly
                        </p>
                      )}
                      {selectedPlanInterval === 'annual' && selectedPrice == null && (
                        <p className="text-neutral-500">Yearly pricing is not live for this plan yet.</p>
                      )}
                      <p>{offer.canAccessDownloads ? 'Downloads included' : 'Hosted sharing included'}</p>
                      <p>{offer.canAccessUnbrandedExports ? 'Unbranded exports included' : 'Kissago branding stays'}</p>
                    </div>

                    <button
                      type="button"
                      disabled={buttonDisabled}
                      onClick={() => void handlePlanCheckout(offer)}
                      className="mt-auto w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 pt-3 text-sm text-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {offer.isCurrentPlan
                        ? 'Current plan'
                        : !pricingData.userId
                        ? 'Sign in to continue'
                        : !walletData?.checkoutEnabled
                        ? 'Checkout coming soon'
                        : yearlyCheckoutDeferred && selectedPlanInterval === 'annual'
                        ? 'Yearly comes later'
                        : selectedProvider == null
                        ? selectedPlanInterval === 'annual'
                          ? 'Yearly coming soon'
                          : 'Checkout coming soon'
                        : selectedProvider !== 'razorpay'
                        ? 'Stripe comes next'
                        : !razorpayReady
                        ? 'Loading checkout'
                        : checkoutBusyKey === `plan:${offer.planKey}`
                        ? 'Opening checkout...'
                        : selectedPlanInterval === 'annual'
                        ? 'Choose yearly plan'
                        : 'Choose monthly plan'}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-2xl font-serif text-neutral-100">Coin packs</h3>
                <p className="mt-1 text-sm text-neutral-400">Top up anytime when you want to keep creating without changing plans.</p>
              </div>
            </div>

            {topups.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-neutral-500">
                Published coin packs are not ready for this market yet.
              </p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                {topups.map((pack) => (
                  <article key={pack.packKey} className="rounded-3xl border border-white/10 bg-neutral-900/60 p-5">
                    <p className="text-lg font-serif text-neutral-100">{pack.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-neutral-500">{pack.coinAmount.toLocaleString()} coins</p>
                    <p className="mt-5 text-2xl text-neutral-100">{formatPrice(pack.currencyCode, pack.priceMinor)}</p>
                    <button
                      type="button"
                      disabled={
                        !pricingData.userId ||
                        !walletData?.checkoutEnabled ||
                        pack.provider !== 'razorpay' ||
                        !razorpayReady ||
                        checkoutBusyKey !== null
                      }
                      onClick={() => void handleTopupCheckout(pack.topupPackId, pack.packKey, pack.provider)}
                      className="mt-5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {!pricingData.userId
                        ? 'Sign in to continue'
                        : !walletData?.checkoutEnabled
                        ? 'Top-up coming soon'
                        : pack.provider !== 'razorpay'
                        ? 'Stripe comes next'
                        : !razorpayReady
                        ? 'Loading checkout'
                        : checkoutBusyKey === `topup:${pack.packKey}`
                        ? 'Opening checkout...'
                        : 'Buy coins'}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-2xl font-serif text-neutral-100">Recent activity</h3>
                <p className="mt-1 text-sm text-neutral-400">A simple view of how coins came in and how they were spent.</p>
              </div>
            </div>

            {walletLoading && activity.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading wallet activity...
              </div>
            ) : activity.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-neutral-500">
                No coin activity yet. Your refills, top-ups, and story actions will appear here.
              </div>
            ) : (
              <div className="space-y-3">
                {activity.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-neutral-900/60 px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-neutral-100">{item.title}</p>
                        <p className="mt-1 text-xs text-neutral-500">{item.subtitle}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-medium ${item.coinsDelta >= 0 ? 'text-emerald-300' : 'text-neutral-200'}`}>
                          {item.coinsDelta >= 0 ? '+' : ''}{item.coinsDelta.toLocaleString()} coins
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">{formatActivityTime(item.occurredAt)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-white/10 bg-neutral-900/50 p-4 text-sm text-neutral-400">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                  <Star className="h-4 w-4" />
                </div>
                <p>
                  Coins are shown in a friendly format for creators and families. Under the hood, Kissago still tracks them using the internal beat system so pricing stays predictable.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function BalanceCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Coins;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-neutral-900/60 p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-white/5 p-2.5 text-emerald-300">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">{label}</p>
          <p className="mt-1 text-2xl text-neutral-100">{value.toLocaleString()}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-neutral-500">{hint}</p>
    </div>
  );
}

function MarketButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-2 text-sm transition-colors ${active ? 'bg-emerald-500/15 text-emerald-200' : 'bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'}`}
    >
      {label}
    </button>
  );
}

async function openRazorpayCheckout(checkout: PreparedRazorpayCheckout): Promise<string> {
  const RazorpayCtor = window.Razorpay;

  if (!RazorpayCtor) {
    throw new Error('Razorpay checkout is not ready yet');
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const settleResolve = (message: string) => {
      if (settled) return;
      settled = true;
      resolve(message);
    };

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const options: Record<string, unknown> = {
      key: checkout.keyId,
      name: checkout.displayName,
      description: checkout.description,
      prefill: {
        name: checkout.userName ?? undefined,
        email: checkout.userEmail ?? undefined,
      },
      theme: {
        color: '#10b981',
      },
      modal: {
        ondismiss: () => settleReject(new Error('Razorpay checkout dismissed')),
      },
      handler: async (response: any) => {
        try {
          const verifyResponse = await fetch('/api/billing/razorpay/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(
              checkout.kind === 'subscription'
                ? {
                    kind: 'subscription',
                    internalOrderId: checkout.internalOrderId,
                    razorpayPaymentId: response.razorpay_payment_id,
                    razorpaySignature: response.razorpay_signature,
                    razorpaySubscriptionId: response.razorpay_subscription_id,
                  }
                : {
                    kind: 'topup',
                    internalOrderId: checkout.internalOrderId,
                    razorpayPaymentId: response.razorpay_payment_id,
                    razorpaySignature: response.razorpay_signature,
                    razorpayOrderId: response.razorpay_order_id,
                  }
            ),
          });

          const payload = await verifyResponse.json();
          if (!verifyResponse.ok) {
            throw new Error(payload?.error || 'Failed to verify Razorpay checkout');
          }

          settleResolve(payload?.message || 'Checkout completed successfully.');
        } catch (err: any) {
          settleReject(new Error(err?.message || 'Failed to verify Razorpay checkout'));
        }
      },
    };

    if (checkout.kind === 'subscription') {
      options.subscription_id = checkout.razorpaySubscriptionId;
    } else {
      options.order_id = checkout.razorpayOrderId;
      options.amount = checkout.amountMinor;
      options.currency = checkout.currencyCode;
    }

    const instance = new RazorpayCtor(options);
    if (typeof instance.on === 'function') {
      instance.on('payment.failed', (event: any) => {
        const description =
          event?.error?.description ||
          event?.error?.reason ||
          'Razorpay reported a payment failure.';
        settleReject(new Error(description));
      });
    }

    instance.open();
  });
}
