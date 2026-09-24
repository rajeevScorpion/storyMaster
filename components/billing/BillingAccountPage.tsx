'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Coins,
  CreditCard,
  Download,
  Loader2,
  Receipt,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { motion } from 'motion/react';

import KissagoLogo from '@/components/ui/KissagoLogo';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import Modal from '@/components/ui/Modal';
import BillingDetailsDialog from '@/components/pricing/BillingDetailsDialog';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { getPricingWalletPageData } from '@/app/actions/pricing-runtime';
import {
  cancelMySubscription,
  getMyBillingOverview,
  getMyPaymentHistory,
  restartMyHaltedSubscription,
} from '@/app/actions/billing-account';
import { documentTypeLabel, subscriptionBanner } from '@/lib/billing/billing-account.shared';
import type { BillingPaymentOverview, GetMyBillingOverviewResult } from '@/lib/billing/billing-account.shared';
import { buildPlanFeatures } from '@/lib/pricing/plan-copy.shared';
import { formatCurrencyMinor } from '@/lib/billing/wallet-tax.shared';
import { indiaStateName } from '@/lib/billing/india-states.shared';
import { COINS_PER_BEAT } from '@/lib/types/pricing';
import type { BillingProfileDTO, PricingWalletPageData } from '@/lib/types/pricing';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit F execution spec): Settings -> Billing.
 * Reuses the wallet's own catalogue/balances reads (getPricingWalletPageData, usePricingRuntime) for
 * plan benefits and coin balances, and adds getMyBillingOverview for the subscription/payments/
 * documents this page is actually for. The cancel and restart actions are the money-moving surface
 * Opus reviews line by line -- both live in app/actions/billing-account.ts, not here.
 */

function beatsToCoins(value: number): number {
  return Number((value * COINS_PER_BEAT).toFixed(2));
}

function formatLongDate(value: string | null): string {
  if (!value) return 'an unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'an unknown date';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

const UNAVAILABLE_TEXT = "This isn't available right now.";

export default function BillingAccountPage() {
  const { user, isLoading: authLoading, openAuthDialog } = useAuth();
  const pricing = usePricingRuntime();
  const { data: pricingData, isLoading: pricingLoading, refresh: refreshPricing } = pricing;

  const [showMyStories, setShowMyStories] = useState(false);
  const [walletData, setWalletData] = useState<PricingWalletPageData | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [overview, setOverview] = useState<GetMyBillingOverviewResult | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  const [morePayments, setMorePayments] = useState<BillingPaymentOverview[]>([]);
  const [paymentsHasMore, setPaymentsHasMore] = useState(false);
  const [loadingMorePayments, setLoadingMorePayments] = useState(false);
  const [paymentsPageError, setPaymentsPageError] = useState<string | null>(null);

  const [billingDialogOpen, setBillingDialogOpen] = useState(false);

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restartNeedsPlanPick, setRestartNeedsPlanPick] = useState(false);

  const userId = pricingData.userId;
  const resolvedMarketKey = pricingData.snapshot.pricingMarketKey;
  const currentPlanKey = pricingData.snapshot.planKey;

  const loadWalletData = useCallback(async () => {
    if (!userId) return;
    try {
      const next = await getPricingWalletPageData({ pricingMarketKey: resolvedMarketKey, currentPlanKey });
      setWalletData(next);
      setWalletError(null);
    } catch (err: any) {
      setWalletError(err?.message || "This isn't available right now.");
    }
  }, [userId, resolvedMarketKey, currentPlanKey]);

  const loadOverview = useCallback(async () => {
    if (!userId) return;
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const next = await getMyBillingOverview();
      setOverview(next);
      setMorePayments([]);
      setPaymentsHasMore(next.payments.hasMore);
    } catch (err: any) {
      setOverviewError(err?.message || "We couldn't load your billing right now.");
    } finally {
      setOverviewLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (pricingLoading || !userId) return;
    void loadWalletData();
    void loadOverview();
  }, [pricingLoading, userId, loadWalletData, loadOverview]);

  const handleShowMorePayments = useCallback(async () => {
    setLoadingMorePayments(true);
    setPaymentsPageError(null);
    const page = Math.floor((overview?.payments.items.length ?? 0) + morePayments.length) / 20;
    const result = await getMyPaymentHistory({ page: Math.floor(page) });
    setLoadingMorePayments(false);
    if (!result.ok) {
      setPaymentsPageError(result.error);
      return;
    }
    setMorePayments((current) => [...current, ...result.items]);
    setPaymentsHasMore(result.hasMore);
  }, [overview, morePayments]);

  const handleBillingDetailsSaved = useCallback((profile: BillingProfileDTO) => {
    setWalletData((current) => (current ? { ...current, billingProfile: profile } : current));
    setBillingDialogOpen(false);
  }, []);

  const handleConfirmCancel = useCallback(async () => {
    setCancelling(true);
    setCancelError(null);
    const result = await cancelMySubscription();
    setCancelling(false);
    if (!result.ok) {
      setCancelError(result.error);
      return;
    }
    setCancelModalOpen(false);
    void loadOverview();
    void refreshPricing();
  }, [loadOverview, refreshPricing]);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    setRestartError(null);
    setRestartNeedsPlanPick(false);
    const result = await restartMyHaltedSubscription();
    setRestarting(false);
    if (!result.ok) {
      setRestartError(result.error);
      return;
    }
    if (result.planVersionId) {
      // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit G execution spec): a full document
      // load, not a client-side push. The wallet is the only route served without COEP
      // (lib/navigation/cross-origin-isolation.shared.ts) -- Razorpay Checkout's frame needs that,
      // and the isolation boundary is a header on the document, not something a router push can flip.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/wallet?checkout=${result.planVersionId}`);
      return;
    }
    void loadOverview();
    void refreshPricing();
    setRestartNeedsPlanPick(true);
  }, [loadOverview, refreshPricing]);

  if (!authLoading && !user) {
    return (
      <main className="relative min-h-screen bg-neutral-950 px-4 py-16 text-neutral-200">
        <KissagoLogo />
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center">
          <h1 className="text-2xl font-serif text-neutral-100">Sign in to see your billing</h1>
          <p className="text-sm text-neutral-400">Your plan, coins, and payment history live here once you sign in.</p>
          <button
            type="button"
            onClick={() => openAuthDialog('sign_in', '/account/billing')}
            className="cursor-pointer rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-2.5 text-sm text-emerald-200 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/40 hover:bg-emerald-500/15"
          >
            Sign in
          </button>
        </div>
      </main>
    );
  }

  const offers = walletData?.planOffers ?? [];
  const subscription = overview?.subscription ?? null;
  const matchingOffer = subscription ? offers.find((offer) => offer.planKey === subscription.planKey) ?? null : null;
  const priceMinor = subscription?.priceMinor ?? null;
  const banner = subscription && overview!.sections.subscription === 'ok' ? subscriptionBanner(subscription, new Date()) : null;
  const benefits = matchingOffer ? buildPlanFeatures(matchingOffer, walletData, offers) : [];
  const canCancel = Boolean(subscription && ['authenticated', 'active', 'pending'].includes(subscription.status) && !subscription.cancelAtPeriodEnd);
  const canRestart = subscription?.status === 'halted';

  const displaySubscriptionCoins = beatsToCoins(pricingData.snapshot.availableSubscriptionBeats);
  const topupCoins = beatsToCoins(pricingData.snapshot.availableTopupBeats);
  const bonusCoins = beatsToCoins(pricingData.snapshot.availablePromoBeats);

  const allPayments = [...(overview?.payments.items ?? []), ...morePayments];

  return (
    <main className="relative min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      <KissagoLogo />

      <div className="fixed top-4 right-4 z-40">
        <UserMenu onMyStories={() => setShowMyStories(true)} />
      </div>

      <MyStoriesDrawer isOpen={showMyStories} onClose={() => setShowMyStories(false)} />

      <BillingDetailsDialog
        open={billingDialogOpen}
        profile={walletData?.billingProfile ?? null}
        context="manage"
        onClose={() => setBillingDialogOpen(false)}
        onSaved={handleBillingDetailsSaved}
      />

      <Modal
        isOpen={cancelModalOpen}
        onClose={() => {
          if (!cancelling) setCancelModalOpen(false);
        }}
        title={`Cancel your ${matchingOffer?.name ?? subscription?.planName ?? 'plan'}?`}
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-neutral-300">
            You keep everything until {formatLongDate(subscription?.currentPeriodEnd ?? null)}. After that you won&apos;t be
            charged again.
          </p>
          {cancelError && (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{cancelError}</div>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              disabled={cancelling}
              onClick={() => setCancelModalOpen(false)}
              className="cursor-pointer rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-200 transition-colors hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Keep plan
            </button>
            <button
              type="button"
              disabled={cancelling}
              onClick={() => void handleConfirmCancel()}
              className="cursor-pointer rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 transition-colors hover:border-rose-400/40 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel plan'}
            </button>
          </div>
        </div>
      </Modal>

      <div className="mx-auto max-w-4xl px-4 pb-16 pt-[clamp(5.5rem,18vh,8rem)]">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="mb-8 space-y-3">
          <Link
            href="/wallet"
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-neutral-400 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10 hover:text-neutral-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to wallet
          </Link>
          <div>
            <h1 className="text-3xl font-serif text-neutral-100 md:text-4xl">Billing</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-400">
              Your plan, coins, and payment history in one place.
            </p>
          </div>
        </motion.div>

        {(overviewLoading || pricingLoading) && !overview ? (
          <div className="flex items-center justify-center rounded-[28px] border border-white/10 bg-white/5 p-12">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
          </div>
        ) : overviewError ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{overviewError}</div>
        ) : (
          <div className="space-y-4">
            {/* Your plan */}
            <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
              <p className="text-xs uppercase tracking-[0.18em] text-emerald-300/80">Your plan</p>
              {overview!.sections.subscription === 'unavailable' ? (
                <p className="mt-3 text-sm text-neutral-400">{UNAVAILABLE_TEXT}</p>
              ) : !subscription || banner?.tone === 'ended' ? (
                <>
                  <h2 className="mt-2 text-2xl font-serif text-neutral-100">You&apos;re on the free plan.</h2>
                  {subscription && banner && (
                    <p className="mt-2 text-sm text-neutral-400">
                      {subscription.planName}: {banner.text}
                    </p>
                  )}
                  <Link href="/wallet" className="mt-3 inline-block text-sm text-emerald-300 underline-offset-2 hover:underline">
                    Choose a plan on your wallet
                  </Link>
                </>
              ) : (
                <>
                  <h2 className="mt-2 text-2xl font-serif text-neutral-100">
                    {matchingOffer?.name ?? subscription.planName}
                    {priceMinor != null && subscription.currencyCode && (
                      <span className="ml-2 text-base font-sans text-neutral-400">
                        {formatCurrencyMinor(subscription.currencyCode, priceMinor)} / {subscription.interval === 'annual' ? 'year' : 'month'}
                        {walletData?.taxPreview ? ' + GST' : ''}
                      </span>
                    )}
                  </h2>
                  {banner && (
                    <p
                      className={`mt-2 text-sm ${
                        banner.tone === 'pending' || banner.tone === 'halted'
                          ? 'text-amber-300'
                          : banner.tone === 'cancelling'
                          ? 'text-neutral-400'
                          : 'text-emerald-300'
                      }`}
                    >
                      {banner.text}
                    </p>
                  )}

                  {benefits.length > 0 && (
                    <ul className="mt-4 space-y-1.5">
                      {benefits.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm text-neutral-300">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-400/80" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-5 flex flex-wrap gap-3">
                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => {
                          setCancelError(null);
                          setCancelModalOpen(true);
                        }}
                        className="cursor-pointer rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-200 transition-colors hover:border-white/20 hover:bg-white/10"
                      >
                        Cancel plan
                      </button>
                    )}
                    {canRestart && (
                      <button
                        type="button"
                        disabled={restarting}
                        onClick={() => void handleRestart()}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 transition-colors hover:border-emerald-400/40 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {restarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Restart your plan
                      </button>
                    )}
                  </div>
                  {restartError && <p className="mt-3 text-sm text-rose-300">{restartError}</p>}
                  {restartNeedsPlanPick && (
                    <p className="mt-3 text-sm text-neutral-400">
                      Choose a plan on your{' '}
                      <Link href="/wallet" className="text-emerald-300 underline-offset-2 hover:underline">
                        wallet
                      </Link>
                      .
                    </p>
                  )}
                </>
              )}
            </section>

            {/* Coins */}
            <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
              <p className="text-xs uppercase tracking-[0.18em] text-emerald-300/80">Coins</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <CoinStat icon={CreditCard} label="Subscription coins" value={displaySubscriptionCoins} loading={pricingLoading} />
                <CoinStat icon={Coins} label="Top-up coins" value={topupCoins} loading={pricingLoading} />
                <CoinStat icon={Sparkles} label="Bonus coins" value={bonusCoins} loading={pricingLoading} />
              </div>
              {pricingData.snapshot.nextResetAt && pricingData.snapshot.monthlyIncludedBeats > 0 && (
                <p className="mt-3 text-xs text-neutral-500">
                  Subscription coins reset on {formatLongDate(pricingData.snapshot.nextResetAt)}.
                </p>
              )}
            </section>

            {/* Payment history */}
            <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
              <p className="text-xs uppercase tracking-[0.18em] text-emerald-300/80">Payment history</p>
              {overview!.sections.payments === 'unavailable' ? (
                <p className="mt-3 text-sm text-neutral-400">{UNAVAILABLE_TEXT}</p>
              ) : allPayments.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-400">No payments yet.</p>
              ) : (
                <div className="mt-4 divide-y divide-white/5">
                  {allPayments.map((payment) => (
                    <div key={payment.id} className="py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-neutral-200">{payment.description}</p>
                          <p className="text-xs text-neutral-500">
                            {formatLongDate(payment.date)} · {payment.methodLabel}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-neutral-200">{formatCurrencyMinor(payment.currencyCode, payment.grossMinor)}</p>
                          {payment.taxLines.length > 0 && (
                            <p className="text-[11px] text-neutral-500">
                              {payment.taxLines.map((line) => `${line.label} ${formatCurrencyMinor(payment.currencyCode, line.amountMinor)}`).join(' + ')}
                            </p>
                          )}
                        </div>
                      </div>
                      {payment.refund && (
                        <p className="mt-1 pl-3 text-xs text-neutral-500">
                          {payment.refund.processed
                            ? `Refunded ${formatCurrencyMinor(payment.currencyCode, payment.refund.amountMinor)} on ${formatLongDate(payment.refund.date)}`
                            : 'Refund processing'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {paymentsPageError && <p className="mt-3 text-sm text-rose-300">{paymentsPageError}</p>}
              {overview!.sections.payments === 'ok' && paymentsHasMore && (
                <button
                  type="button"
                  disabled={loadingMorePayments}
                  onClick={() => void handleShowMorePayments()}
                  className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-neutral-300 transition-colors hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMorePayments && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Show more
                </button>
              )}
            </section>

            {/* Invoices & receipts */}
            <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-neutral-400" />
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-300/80">Invoices &amp; receipts</p>
              </div>
              {overview!.sections.documents === 'unavailable' ? (
                <p className="mt-3 text-sm text-neutral-400">{UNAVAILABLE_TEXT}</p>
              ) : overview!.documents.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-400">Tax invoices will appear here.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {overview!.documents.map((doc) => (
                    <div key={doc.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] uppercase tracking-wide text-neutral-400">
                          {documentTypeLabel(doc.documentType)}
                        </span>
                        <span className="text-neutral-200">{doc.documentNumber}</span>
                        <span className="text-neutral-500">{formatLongDate(doc.issuedAt)}</span>
                        <span className="text-neutral-200">{formatCurrencyMinor(doc.currencyCode, doc.totalMinor)}</span>
                      </div>
                      <a
                        href={`/api/billing/documents/${doc.id}/pdf`}
                        download
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-neutral-100"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Billing details */}
            <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-300/80">Billing details</p>
                <button
                  type="button"
                  onClick={() => setBillingDialogOpen(true)}
                  className="cursor-pointer rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-neutral-100"
                >
                  {walletData?.billingProfile ? 'Edit' : 'Add billing details'}
                </button>
              </div>
              {walletError ? (
                <p className="mt-3 text-sm text-neutral-400">{UNAVAILABLE_TEXT}</p>
              ) : walletData?.billingProfile ? (
                <div className="mt-3 text-sm text-neutral-300">
                  <p>
                    {walletData.billingProfile.profileType === 'business' ? 'Business' : 'Personal'} ·{' '}
                    {walletData.billingProfile.legalName}
                  </p>
                  <p className="mt-1 text-neutral-500">
                    {indiaStateName(walletData.billingProfile.stateCode) ?? walletData.billingProfile.stateCode}
                    {walletData.billingProfile.profileType === 'business' && walletData.billingProfile.gstin
                      ? ` · ${walletData.billingProfile.gstin}`
                      : ''}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-neutral-400">You haven&apos;t added billing details yet.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function CoinStat({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: typeof Coins;
  label: string;
  value: number;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-neutral-900/50 p-4">
      <div className="flex items-center gap-2 text-neutral-400">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-[0.14em]">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-serif text-neutral-100">{loading ? '…' : value.toLocaleString()}</p>
    </div>
  );
}
