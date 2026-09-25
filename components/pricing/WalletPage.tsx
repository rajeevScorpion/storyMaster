'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, CheckCircle2, Coins, CreditCard, Loader2, Sparkles, Star, Wallet as WalletIcon } from 'lucide-react';
import { motion } from 'motion/react';
import KissagoLogo from '@/components/ui/KissagoLogo';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import BillingDetailsDialog from '@/components/pricing/BillingDetailsDialog';
import CheckoutSummarySheet from '@/components/pricing/checkout/CheckoutSummarySheet';
import { RazorpayScript, useRazorpayCheckout } from '@/components/pricing/checkout/useRazorpayCheckout';
import { formatPriceWithTaxLine } from '@/lib/billing/wallet-tax.shared';
import { indiaStateName } from '@/lib/billing/india-states.shared';
import { isBillingProfileComplete } from '@/lib/billing/billing-profile.shared';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { PRICING_RUNTIME_REFRESH_EVENT } from '@/lib/pricing/runtime-events';
import { getPricingWalletPageData } from '@/app/actions/pricing-runtime';
import type {
  BillingInterval,
  BillingProfileDTO,
  PrepareRazorpayCheckoutInput,
  PricingPlanOfferCard,
  PricingWalletPageData,
} from '@/lib/types/pricing';
import { COINS_PER_BEAT } from '@/lib/types/pricing';
import { buildPlanFeatures, getPlanDescription } from '@/lib/pricing/plan-copy.shared';
import { formatBillingDateLong } from '@/lib/billing/billing-dates.shared';

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
  return formatBillingDateLong(value) ?? 'Not scheduled yet';
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

function formatBeatCount(value: number) {
  return `${value.toLocaleString()} story beat${value === 1 ? '' : 's'}`;
}

function beatsToCoins(value: number) {
  return Number((value * COINS_PER_BEAT).toFixed(2));
}

function getPlanRateLabel(
  offer: PricingPlanOfferCard,
  selectedPrice: number | null,
  interval: BillingInterval
): string {
  if (offer.planKey === 'free' || selectedPrice === 0) {
    return 'Free';
  }

  if (selectedPrice == null) {
    return interval === 'annual' ? 'Yearly pricing comes later' : 'Not ready for this market';
  }

  return `${formatPrice(offer.currencyCode, selectedPrice)} ${interval}`;
}

function getPlanCtaLabel(input: {
  offer: PricingPlanOfferCard;
  currentPlan: PricingPlanOfferCard | null;
  selectedPlanInterval: BillingInterval;
  selectedProvider: string | null;
  pricingMarketKey: 'IN' | 'ROW';
  userId: string | null;
  checkoutEnabled: boolean;
  yearlyCheckoutDeferred: boolean;
  razorpayReady: boolean;
}): string {
  const {
    offer,
    currentPlan,
    selectedPlanInterval,
    selectedProvider,
    pricingMarketKey,
    userId,
    checkoutEnabled,
    yearlyCheckoutDeferred,
    razorpayReady,
  } = input;

  if (offer.isCurrentPlan) {
    return offer.planKey === 'free' ? 'Included with your account' : 'Current plan';
  }

  if (offer.planKey === 'free') {
    return 'Free with every account';
  }

  const currentTierRank = currentPlan?.tierRank ?? 1;
  const isUpgrade = offer.tierRank > currentTierRank;
  const isDowngrade = offer.tierRank < currentTierRank;

  if (!userId) {
    return `Sign in to choose ${offer.name}`;
  }

  if (isDowngrade) {
    return 'Switch after your plan ends';
  }

  if (!checkoutEnabled) {
    return isUpgrade ? `Upgrade to ${offer.name} soon` : 'Plan switching comes soon';
  }

  if (yearlyCheckoutDeferred && selectedPlanInterval === 'annual') {
    return 'Yearly comes later';
  }

  if (selectedProvider == null) {
    return 'Not ready for this market';
  }

  if (selectedProvider !== 'razorpay') {
    return pricingMarketKey === 'ROW' ? 'Outside India comes later' : 'India checkout first';
  }

  if (!razorpayReady) {
    return 'Loading checkout';
  }

  return isUpgrade ? `Upgrade to ${offer.name}` : `Choose ${offer.name}`;
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

export default function WalletPage() {
  const router = useRouter();
  const pricing = usePricingRuntime();
  const {
    data: pricingData,
    isLoading: pricingLoading,
    setMarketOverride,
    refresh: refreshPricing,
  } = pricing;
  const resolvedMarketKey = pricingData.snapshot.pricingMarketKey;
  const checkoutEnabled = pricingData.controls.pricingCheckoutEnabled;
  const currentPlanKey = pricingData.snapshot.planKey;
  const [showMyStories, setShowMyStories] = useState(false);
  const [walletData, setWalletData] = useState<PricingWalletPageData | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);
  // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): the checkout summary sheet owns its
  // own progress/result messaging now -- this is left for the Razorpay script failing to load, which
  // happens before any sheet is ever open.
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [selectedPlanInterval, setSelectedPlanInterval] = useState<BillingInterval>('monthly');
  const razorpay = useRazorpayCheckout();
  const razorpayReady = razorpay.ready;
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit D): the dialog's submit label and
  // "future invoices" line depend on whether it opened to unblock a pending checkout or from the
  // wallet's own billing-details row.
  const [billingDialogContext, setBillingDialogContext] = useState<'checkout' | 'manage'>('manage');
  const [pendingCheckoutAction, setPendingCheckoutAction] = useState<(() => void) | null>(null);
  // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): what the checkout summary sheet is
  // pricing -- null closes it. unlimitedWatching is display-only context the sheet has no other way
  // to reach (it isn't part of the server's quote).
  const [checkoutSheetOpen, setCheckoutSheetOpen] = useState(false);
  const [checkoutSheetTarget, setCheckoutSheetTarget] = useState<{
    input: PrepareRazorpayCheckoutInput;
    unlimitedWatching?: boolean;
  } | null>(null);

  useEffect(() => {
    if (
      !pricingLoading
      && pricingData.controls.indiaOnlyBetaEnabled
      && pricingData.snapshot.pricingMarketKey !== 'IN'
    ) {
      setMarketOverride('IN');
    }
  }, [
    pricingData.controls.indiaOnlyBetaEnabled,
    pricingData.snapshot.pricingMarketKey,
    pricingLoading,
    setMarketOverride,
  ]);

  const loadWalletData = useCallback(async () => {
    setWalletLoading(true);
    setWalletError(null);

    try {
      const next = await getPricingWalletPageData({
        pricingMarketKey: resolvedMarketKey,
        currentPlanKey,
      });
      setWalletData(next);
    } catch (err: any) {
      setWalletError(err?.message || 'Failed to load wallet details');
    } finally {
      setWalletLoading(false);
    }
  }, [resolvedMarketKey, currentPlanKey]);

  useEffect(() => {
    if (pricingLoading) return;
    void loadWalletData();
  }, [loadWalletData, pricingLoading]);

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
  // Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): the annual refusal is no longer
  // India-only -- AC's checkout guard keeps every Razorpay item monthly-only at US launch too, so this
  // is now just usingRazorpayMarket, whatever the market.
  const yearlyCheckoutDeferred = usingRazorpayMarket;

  useEffect(() => {
    if (yearlyCheckoutDeferred && selectedPlanInterval === 'annual') {
      setSelectedPlanInterval('monthly');
    }
  }, [selectedPlanInterval, yearlyCheckoutDeferred]);

  const showAllowancePreview =
    !pricingData.userId || !pricingData.controls.pricingSnapshotEnabled;
  const totalCoins = beatsToCoins(pricingData.snapshot.availableTotalBeats);
  const monthlyAllowanceCoins = beatsToCoins(pricingData.snapshot.monthlyIncludedBeats);
  const displayHeadlineCoins = showAllowancePreview ? monthlyAllowanceCoins : totalCoins;
  const subscriptionCoins = beatsToCoins(pricingData.snapshot.availableSubscriptionBeats);
  const displaySubscriptionCoins = showAllowancePreview ? monthlyAllowanceCoins : subscriptionCoins;
  const topupCoins = beatsToCoins(pricingData.snapshot.availableTopupBeats);
  const bonusCoins = beatsToCoins(pricingData.snapshot.availablePromoBeats);

  // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit G execution spec): stable across renders
  // where walletData hasn't changed -- the ?checkout= effect below depends on it, and a fresh []/
  // fallback array on every render would otherwise make that dependency array change every render.
  const offers = useMemo(() => walletData?.planOffers ?? [], [walletData]);
  const topups = walletData?.topupOffers ?? [];
  const activity = walletData?.recentActivity ?? [];

  const currentPlan = offers.find((offer) => offer.isCurrentPlan) ?? null;
  const primaryTopup = topups[0] ?? null;
  const marketLabel = pricingData.snapshot.pricingMarketKey === 'IN' ? 'India' : 'Outside India';
  // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, owner decision P6): kids mode hides
  // every buy button behind a "switch profiles" line -- the server refuses regardless, but the client
  // shows the same thing up front rather than letting the customer discover it after opening Razorpay.
  const isKidsMode = walletData?.audienceMode === 'kids';

  const headlineActionDisabled =
    !checkoutEnabled ||
    !pricingData.userId ||
    !usingRazorpayMarket ||
    !razorpayReady;

  // Payments Phase 2, Unit B2a: once a tax rule is published, checkout requires a declared billing
  // state (the GST place of supply). Both checkout handlers below gate on this before they ever open
  // the checkout summary sheet. Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit D, owner
  // decision P7): "has a state" isn't enough any more -- an old profile saved under the looser rules
  // can be missing phone, city or PIN, so the gate is "complete for its type".
  const requiresBillingDetails =
    Boolean(walletData?.taxPreview?.requiresBillingState) &&
    !isBillingProfileComplete(walletData?.billingProfile ?? null);

  // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): opens the checkout summary sheet,
  // which quotes the price, collects the P6 attestation and drives startRazorpayCheckout itself --
  // WalletPage no longer calls prepare/Razorpay directly.
  const openCheckoutSheet = useCallback((input: PrepareRazorpayCheckoutInput, unlimitedWatching?: boolean) => {
    setCheckoutSheetTarget({ input, unlimitedWatching });
    setCheckoutSheetOpen(true);
  }, []);

  const handlePlanCheckout = useCallback((offer: PricingPlanOfferCard) => {
    const planVersionId = getSelectedPlanVersionId(offer, selectedPlanInterval);
    // Every button that can reach this is already disabled unless a razorpay planVersionId exists for
    // the selected interval (buttonDisabled below) -- this is only a defensive fallback.
    if (!planVersionId) return;

    const input: PrepareRazorpayCheckoutInput = { kind: 'subscription', planVersionId };
    if (requiresBillingDetails) {
      setPendingCheckoutAction(() => () => openCheckoutSheet(input, offer.unlimitedWatching));
      setBillingDialogContext('checkout');
      setBillingDialogOpen(true);
      return;
    }
    openCheckoutSheet(input, offer.unlimitedWatching);
  }, [requiresBillingDetails, selectedPlanInterval, openCheckoutSheet]);

  const handleTopupCheckout = useCallback((topupPackId: string) => {
    const input: PrepareRazorpayCheckoutInput = { kind: 'topup', topupPackId };
    if (requiresBillingDetails) {
      setPendingCheckoutAction(() => () => openCheckoutSheet(input));
      setBillingDialogContext('checkout');
      setBillingDialogOpen(true);
      return;
    }
    openCheckoutSheet(input);
  }, [requiresBillingDetails, openCheckoutSheet]);

  const handleBillingDetailsSaved = useCallback((profile: BillingProfileDTO) => {
    setWalletData((current) => (current ? { ...current, billingProfile: profile } : current));
    setBillingDialogOpen(false);
    const action = pendingCheckoutAction;
    setPendingCheckoutAction(null);
    if (action) action();
  }, [pendingCheckoutAction]);

  const handleCheckoutSheetClose = useCallback(() => setCheckoutSheetOpen(false), []);

  // The quote turned out to need billing details after all (a stale or crafted client) -- close the
  // sheet, open the dialog, and reopen the same sheet target once it's saved.
  const handleCheckoutNeedsBillingDetails = useCallback(() => {
    setCheckoutSheetOpen(false);
    const target = checkoutSheetTarget;
    if (target) {
      setPendingCheckoutAction(() => () => openCheckoutSheet(target.input, target.unlimitedWatching));
    }
    setBillingDialogContext('checkout');
    setBillingDialogOpen(true);
  }, [checkoutSheetTarget, openCheckoutSheet]);

  const handleCheckoutSettled = useCallback(() => {
    void refreshPricing();
    void loadWalletData();
    router.refresh();
  }, [refreshPricing, loadWalletData, router]);

  // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit G execution spec): the /plans buy links
  // and BillingAccountPage's restart both land here as /wallet?checkout=<planVersionId>. A ref, not
  // state, gates this to once per page load -- state would itself cause the re-render this effect
  // reacts to, risking a second fire before the guard commits. Runs the exact same billing-dialog-
  // first gate a card's own button does, then always strips the param so a reload can't replay it.
  const checkoutParamHandledRef = useRef(false);
  useEffect(() => {
    if (checkoutParamHandledRef.current) return;
    if (typeof window === 'undefined') return;
    if (!pricingData.userId || isKidsMode || !checkoutEnabled || walletLoading) return;

    const checkoutParam = new URLSearchParams(window.location.search).get('checkout');
    if (!checkoutParam) return;

    checkoutParamHandledRef.current = true;

    const matchedOffer = offers.find(
      (offer) => offer.monthlyPlanVersionId === checkoutParam || offer.annualPlanVersionId === checkoutParam
    );

    if (matchedOffer && matchedOffer.planKey !== 'free' && !matchedOffer.isCurrentPlan) {
      const interval: BillingInterval = matchedOffer.annualPlanVersionId === checkoutParam ? 'annual' : 'monthly';
      const provider = getSelectedPlanProvider(matchedOffer, interval);
      const currentTierRank = currentPlan?.tierRank ?? 1;
      const isDowngrade = matchedOffer.tierRank < currentTierRank;
      const purchasable = provider === 'razorpay' && !isDowngrade && !(yearlyCheckoutDeferred && interval === 'annual');

      if (purchasable) {
        const input: PrepareRazorpayCheckoutInput = { kind: 'subscription', planVersionId: checkoutParam };
        if (requiresBillingDetails) {
          setPendingCheckoutAction(() => () => openCheckoutSheet(input, matchedOffer.unlimitedWatching));
          setBillingDialogContext('checkout');
          setBillingDialogOpen(true);
        } else {
          openCheckoutSheet(input, matchedOffer.unlimitedWatching);
        }
      }
      // An unpurchasable match (already the current plan, a downgrade under P2(a), or no razorpay
      // version for this market) is ignored silently -- same as a stale or crafted id.
    }

    router.replace('/wallet');
  }, [
    pricingData.userId,
    isKidsMode,
    checkoutEnabled,
    walletLoading,
    offers,
    currentPlan,
    yearlyCheckoutDeferred,
    requiresBillingDetails,
    openCheckoutSheet,
    router,
  ]);

  return (
    <main className="relative min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      <RazorpayScript
        enabled={checkoutEnabled && usingRazorpayMarket}
        onLoad={razorpay.onScriptLoad}
        onError={() => {
          razorpay.onScriptError();
          setCheckoutError('Failed to load Razorpay checkout. Please refresh and try again.');
        }}
      />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-40 bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-transparent"
      />

      <KissagoLogo />

      <div className="fixed top-4 right-4 z-40">
        <UserMenu onMyStories={() => setShowMyStories(true)} />
      </div>

      <MyStoriesDrawer isOpen={showMyStories} onClose={() => setShowMyStories(false)} />

      <BillingDetailsDialog
        open={billingDialogOpen}
        profile={walletData?.billingProfile ?? null}
        context={billingDialogContext}
        onClose={() => {
          setBillingDialogOpen(false);
          setPendingCheckoutAction(null);
        }}
        onSaved={handleBillingDetailsSaved}
      />

      <CheckoutSummarySheet
        open={checkoutSheetOpen}
        target={checkoutSheetTarget?.input ?? null}
        pricingMarketKey={pricingData.snapshot.pricingMarketKey}
        razorpayReady={razorpayReady}
        unlimitedWatching={checkoutSheetTarget?.unlimitedWatching}
        onClose={handleCheckoutSheetClose}
        onNeedsBillingDetails={handleCheckoutNeedsBillingDetails}
        onSettled={handleCheckoutSettled}
      />

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
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-neutral-400 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10 hover:text-neutral-200 hover:shadow-[0_12px_30px_rgba(16,185,129,0.12)]"
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
            <div className={`grid gap-2 ${pricingData.controls.indiaOnlyBetaEnabled ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <MarketButton
                label="India"
                active={pricingData.snapshot.pricingMarketKey === 'IN'}
                onClick={() => setMarketOverride('IN')}
              />
              {!pricingData.controls.indiaOnlyBetaEnabled && (
                <MarketButton
                  label="Outside India"
                  active={pricingData.snapshot.pricingMarketKey === 'ROW'}
                  onClick={() => setMarketOverride('ROW')}
                />
              )}
            </div>
            {pricingData.controls.indiaOnlyBetaEnabled && (
              <p className="px-2 pt-2 text-[11px] text-neutral-500">India-only beta</p>
            )}
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

              {!isKidsMode && (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={headlineActionDisabled}
                    onClick={() => {
                      const nextPlan = offers.find((offer) => !offer.isCurrentPlan && getSelectedPlanProvider(offer, selectedPlanInterval) === 'razorpay') ?? null;
                      if (nextPlan) {
                        handlePlanCheckout(nextPlan);
                      }
                    }}
                    className="cursor-pointer rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/40 hover:bg-emerald-500/15 hover:shadow-[0_14px_35px_rgba(16,185,129,0.16)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                  >
                    {!pricingData.userId
                      ? 'Sign in to continue'
                      : !checkoutEnabled
                      ? 'Upgrade coming soon'
                      : !usingRazorpayMarket
                      ? 'India checkout first'
                      : yearlyCheckoutDeferred
                      ? 'Upgrade plan'
                      : !razorpayReady
                      ? 'Loading checkout'
                      : 'Upgrade plan'}
                  </button>
                  <button
                    type="button"
                    disabled={headlineActionDisabled || !primaryTopup}
                    onClick={() => {
                      if (primaryTopup) {
                        handleTopupCheckout(primaryTopup.topupPackId);
                      }
                    }}
                    className="cursor-pointer rounded-2xl border border-white/10 bg-neutral-900/60 px-4 py-2.5 text-sm text-neutral-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-neutral-800/80 hover:shadow-[0_14px_35px_rgba(255,255,255,0.06)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                  >
                    {!pricingData.userId
                      ? 'Sign in to continue'
                      : !checkoutEnabled
                      ? 'Top-ups coming soon'
                      : !usingRazorpayMarket
                      ? 'India checkout first'
                      : !razorpayReady
                      ? 'Loading checkout'
                      : 'Buy coins'}
                  </button>
                </div>
              )}
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <BalanceCard
                icon={CreditCard}
                label="Subscription coins"
                value={displaySubscriptionCoins}
                hint={showAllowancePreview ? 'Preview of your monthly plan refill' : 'Monthly refill bucket'}
                loading={pricingLoading}
              />
              <BalanceCard icon={WalletIcon} label="Top-up coins" value={topupCoins} hint="Non-expiring coin packs" loading={pricingLoading} />
              <BalanceCard icon={Sparkles} label="Bonus coins" value={bonusCoins} hint="Promos and rewards" loading={pricingLoading} />
            </div>

            {pricingData.userId && walletData?.taxPreview && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-neutral-900/50 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">Billing details</p>
                  <p className="mt-1 truncate text-sm text-neutral-200">
                    {walletData.billingProfile
                      ? `${walletData.billingProfile.legalName} · ${indiaStateName(walletData.billingProfile.stateCode) ?? walletData.billingProfile.stateCode}`
                      : 'Add your legal name and GST state before you check out.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href="/account/billing"
                    className="cursor-pointer rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10 hover:text-neutral-100"
                  >
                    Manage billing →
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setBillingDialogContext('manage');
                      setBillingDialogOpen(true);
                    }}
                    className="cursor-pointer rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10 hover:text-neutral-100"
                  >
                    {walletData.billingProfile ? 'Edit' : 'Add billing details'}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-white/5 p-3 text-emerald-300">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">Your library</p>
                <p className="mt-2 text-xl font-serif text-neutral-100">Stories you can return to anytime</p>
                <p className="mt-2 text-sm text-neutral-400">
                  {pricingData.userId
                    ? 'A quick view of your active stories and the storylines you have already shaped.'
                    : 'Sign in to keep an eye on your active stories and finished storylines.'}
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-neutral-900/60 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">Stories</p>
                <p className="mt-3 text-4xl font-serif text-neutral-100">{walletData?.storyCount?.toLocaleString() ?? '0'}</p>
                <p className="mt-2 text-sm text-neutral-400">Private workspaces and in-progress branches.</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-neutral-900/60 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">Storylines</p>
                <p className="mt-3 text-4xl font-serif text-neutral-100">{walletData?.storylineCount?.toLocaleString() ?? '0'}</p>
                <p className="mt-2 text-sm text-neutral-400">Finished paths you can revisit, save, or share.</p>
              </div>
            </div>
          </section>
        </div>

        {isKidsMode && (
          <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-300">
            Switch to an adult profile to buy plans or coins.
          </p>
        )}

        {(walletError || checkoutError || (checkoutEnabled && !usingRazorpayMarket)) && (
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
            {checkoutEnabled && !usingRazorpayMarket && (
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
                <Link
                  href="/plans"
                  className="mt-1 inline-block text-sm text-emerald-300 underline-offset-2 hover:underline"
                >
                  Compare plans →
                </Link>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-1">
                  <button
                    type="button"
                    onClick={() => setSelectedPlanInterval('monthly')}
                    className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs uppercase tracking-[0.18em] transition-all duration-200 ${selectedPlanInterval === 'monthly' ? 'bg-emerald-500/15 text-emerald-200 shadow-[0_10px_25px_rgba(16,185,129,0.14)]' : 'text-neutral-500 hover:-translate-y-0.5 hover:bg-white/5 hover:text-neutral-200'}`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPlanInterval('annual')}
                    disabled={yearlyCheckoutDeferred}
                    className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs uppercase tracking-[0.18em] transition-all duration-200 ${selectedPlanInterval === 'annual' ? 'bg-emerald-500/15 text-emerald-200 shadow-[0_10px_25px_rgba(16,185,129,0.14)]' : 'text-neutral-500 hover:-translate-y-0.5 hover:bg-white/5 hover:text-neutral-200'} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0`}
                  >
                    Yearly
                  </button>
                </div>
                {walletLoading && <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />}
              </div>
            </div>

            {yearlyCheckoutDeferred && (
              <div className="mb-5 rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                Checkout is monthly-only for this stage rollout. Yearly plans stay out of checkout until monthly refills for annual billing are ready.
              </div>
            )}

            {/* Column count follows the catalogue: a fourth tier used to wrap alone onto a second
                row. Both class strings are written out in full because Tailwind scans source
                text -- an interpolated `lg:grid-cols-${n}` would be purged. */}
            <div className={`grid gap-4 ${offers.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
              {offers.map((offer) => {
                const selectedPrice = getSelectedPlanPriceMinor(offer, selectedPlanInterval);
                const selectedProvider = getSelectedPlanProvider(offer, selectedPlanInterval);
                const currentTierRank = currentPlan?.tierRank ?? 1;
                const isDowngrade = offer.tierRank < currentTierRank && offer.planKey !== 'free';
                const buttonDisabled =
                  offer.isCurrentPlan ||
                  offer.planKey === 'free' ||
                  !pricingData.userId ||
                  isDowngrade ||
                  !checkoutEnabled ||
                  (yearlyCheckoutDeferred && selectedPlanInterval === 'annual') ||
                  selectedProvider == null ||
                  selectedProvider !== 'razorpay' ||
                  !razorpayReady;
                const features = buildPlanFeatures(offer, walletData, offers);
                const description = getPlanDescription(offer);
                const rateLabel = getPlanRateLabel(offer, selectedPrice, selectedPlanInterval);
                const taxPreview = walletData?.taxPreview ?? null;
                const planTaxLine = taxPreview && selectedPrice != null
                  ? formatPriceWithTaxLine(offer.currencyCode, selectedPrice, taxPreview.ratePercent, taxPreview.taxLabel)
                  : '';
                const ctaLabel = getPlanCtaLabel({
                  offer,
                  currentPlan,
                  selectedPlanInterval,
                  selectedProvider,
                  pricingMarketKey: pricingData.snapshot.pricingMarketKey,
                  userId: pricingData.userId,
                  checkoutEnabled,
                  yearlyCheckoutDeferred,
                  razorpayReady,
                });

                return (
                  <article
                    key={offer.planKey}
                    className={`flex h-full flex-col rounded-3xl border p-5 ${offer.isCurrentPlan ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-white/10 bg-neutral-900/60'}`}
                  >
                    <div className="flex flex-1 flex-col">
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

                      <div className="mt-5">
                        <p className="text-2xl font-medium text-neutral-100">{rateLabel}</p>
                        {offer.monthlyPriceMinor != null && offer.annualPriceMinor != null && (
                          <p className="mt-2 text-xs text-neutral-500">
                            {formatPrice(offer.currencyCode, offer.monthlyPriceMinor)} monthly · {formatPrice(offer.currencyCode, offer.annualPriceMinor)} yearly
                          </p>
                        )}
                        {planTaxLine && (
                          <p className="mt-1 text-xs text-emerald-300/80">{planTaxLine}</p>
                        )}
                      </div>

                      <p className="mt-4 min-h-[3.5rem] text-sm leading-relaxed text-neutral-400">
                        {description}
                      </p>

                      <div className="mt-6 rounded-2xl border border-white/10 bg-black/15 p-4">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Included</p>
                        <ul className="mt-3 space-y-3">
                          {features.map((feature) => (
                            <li key={feature} className="flex items-start gap-2.5 text-sm text-neutral-200">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {!isKidsMode && (
                      <button
                        type="button"
                        disabled={buttonDisabled}
                        onClick={() => handlePlanCheckout(offer)}
                        className="mt-6 w-full cursor-pointer rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10 hover:shadow-[0_14px_35px_rgba(255,255,255,0.06)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                      >
                        {ctaLabel}
                      </button>
                    )}
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
                {topups.map((pack) => {
                  const topupTaxLine = walletData?.taxPreview
                    ? formatPriceWithTaxLine(pack.currencyCode, pack.priceMinor, walletData.taxPreview.ratePercent, walletData.taxPreview.taxLabel)
                    : '';

                  return (
                  <article key={pack.packKey} className="flex flex-col items-center rounded-3xl border border-white/10 bg-neutral-900/60 p-5 text-center transition-all duration-200 hover:-translate-y-1 hover:border-emerald-300/25 hover:bg-neutral-900/80 hover:shadow-[0_18px_40px_rgba(16,185,129,0.14)]">
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-emerald-300">
                      <Coins className="h-5 w-5" />
                    </div>
                    <p className="mt-4 text-lg font-serif text-neutral-100">{pack.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-neutral-500">{pack.coinAmount.toLocaleString()} coins</p>
                    <p className="mt-3 text-sm text-neutral-400">
                      Lets you create {formatBeatCount(Math.round(pack.coinAmount / COINS_PER_BEAT))}.
                    </p>
                    <p className="mt-5 text-3xl text-neutral-100">{formatPrice(pack.currencyCode, pack.priceMinor)}</p>
                    {topupTaxLine && (
                      <p className="mt-1 text-xs text-emerald-300/80">{topupTaxLine}</p>
                    )}
                    {!isKidsMode && (
                      <button
                        type="button"
                        disabled={
                          !pricingData.userId ||
                          !checkoutEnabled ||
                          pack.provider !== 'razorpay' ||
                          !razorpayReady
                        }
                        onClick={() => handleTopupCheckout(pack.topupPackId)}
                        className="mt-6 w-full cursor-pointer rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-300/30 hover:bg-white/10 hover:shadow-[0_14px_35px_rgba(16,185,129,0.14)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                      >
                        {!pricingData.userId
                          ? 'Sign in to continue'
                          : !checkoutEnabled
                          ? 'Top-up coming soon'
                          : pack.provider !== 'razorpay'
                          ? 'Coming soon in your country'
                          : !razorpayReady
                          ? 'Loading checkout'
                          : 'Buy coins'}
                      </button>
                    )}
                  </article>
                  );
                })}
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
  loading = false,
}: {
  icon: typeof Coins;
  label: string;
  value: number;
  hint: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-neutral-900/60 p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-white/5 p-2.5 text-emerald-300">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">{label}</p>
          <p className="mt-1 text-2xl text-neutral-100">{loading ? '•••' : value.toLocaleString()}</p>
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
      className={`cursor-pointer rounded-xl px-3 py-2 text-sm transition-all duration-200 ${active ? 'bg-emerald-500/15 text-emerald-200 shadow-[0_10px_25px_rgba(16,185,129,0.14)]' : 'bg-neutral-900/60 text-neutral-400 hover:-translate-y-0.5 hover:bg-neutral-800/80 hover:text-neutral-200 hover:shadow-[0_12px_30px_rgba(255,255,255,0.06)]'}`}
    >
      {label}
    </button>
  );
}

