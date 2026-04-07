'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Clock3, Coins, CreditCard, Loader2, Sparkles, Star, Wallet as WalletIcon } from 'lucide-react';
import { motion } from 'motion/react';
import KissagoLogo from '@/components/ui/KissagoLogo';
import UserMenu from '@/components/auth/UserMenu';
import MyStoriesDrawer from '@/components/story/MyStoriesDrawer';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { getPricingWalletPageData } from '@/app/actions/pricing-runtime';
import type { PricingWalletPageData } from '@/lib/types/pricing';

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

export default function WalletPage() {
  const { data: pricing, isLoading: pricingLoading } = usePricingRuntime();
  const [showMyStories, setShowMyStories] = useState(false);
  const [walletData, setWalletData] = useState<PricingWalletPageData | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setWalletLoading(true);
      setWalletError(null);

      try {
        const next = await getPricingWalletPageData();
        if (!cancelled) {
          setWalletData(next);
        }
      } catch (err: any) {
        if (!cancelled) {
          setWalletError(err?.message || 'Failed to load wallet details');
        }
      } finally {
        if (!cancelled) {
          setWalletLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pricing.userId]);

  const totalCoins = pricing.snapshot.availableTotalBeats * 10;
  const monthlyAllowanceCoins = pricing.snapshot.monthlyIncludedBeats * 10;
  const displayHeadlineCoins = totalCoins > 0 ? totalCoins : monthlyAllowanceCoins;
  const subscriptionCoins = pricing.snapshot.availableSubscriptionBeats * 10;
  const topupCoins = pricing.snapshot.availableTopupBeats * 10;
  const bonusCoins = pricing.snapshot.availablePromoBeats * 10;

  const offers = walletData?.planOffers ?? [];
  const topups = walletData?.topupOffers ?? [];
  const activity = walletData?.recentActivity ?? [];

  const currentPlan = offers.find((offer) => offer.isCurrentPlan) ?? null;

  return (
    <main className="relative min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
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
        </motion.div>

        <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-300/80">
                  {pricingLoading ? 'Loading plan' : `${titleCase(pricing.snapshot.planKey)} plan`}
                </p>
                <h2 className="mt-2 text-4xl font-serif text-neutral-100 md:text-5xl">
                  {pricingLoading ? '...' : displayHeadlineCoins.toLocaleString()}
                  <span className="ml-2 text-base font-sans text-neutral-400">
                    {totalCoins > 0 ? 'coins remaining' : 'coins / month'}
                  </span>
                </h2>
                <p className="mt-3 text-sm text-neutral-400">
                  {totalCoins > 0
                    ? pricing.snapshot.isInGracePeriod
                    ? `Payment issue detected. Your access stays active until ${formatDate(pricing.snapshot.currentPeriodEndsAt)}.`
                    : pricing.snapshot.nextResetAt
                    ? `Your plan refills on ${formatDate(pricing.snapshot.nextResetAt)}.`
                    : 'You can keep creating with your current wallet balance.'
                    : 'This shows your current monthly plan allowance while billing and wallet grants are still being wired up.'}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!walletData?.checkoutEnabled}
                  className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {walletData?.checkoutEnabled ? 'Upgrade plan' : 'Upgrade coming soon'}
                </button>
                <button
                  type="button"
                  disabled={!walletData?.checkoutEnabled}
                  className="rounded-2xl border border-white/10 bg-neutral-900/60 px-4 py-2.5 text-sm text-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {walletData?.checkoutEnabled ? 'Buy coins' : 'Top-ups coming soon'}
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <BalanceCard icon={CreditCard} label="Subscription coins" value={subscriptionCoins} hint="Monthly refill bucket" />
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
                    {currentPlan ? currentPlan.name : titleCase(pricing.snapshot.planKey)}
                  </p>
                </div>
                <div className="space-y-2 text-sm text-neutral-400">
                  <p>{pricing.snapshot.storyLengthCap} beats per story</p>
                  <p>{pricing.snapshot.currencyCode} market pricing</p>
                  <p>{pricing.snapshot.canAccessDownloads ? 'Downloads included' : 'Downloads not included yet'}</p>
                  <p>{pricing.snapshot.canAccessUnbrandedExports ? 'Unbranded exports included' : 'Branded sharing included'}</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        {walletError && (
          <div className="mt-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {walletError}
          </div>
        )}

        <div className="mt-8 grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="space-y-6">
            <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-2xl font-serif text-neutral-100">Plans</h3>
                  <p className="mt-1 text-sm text-neutral-400">Choose the rhythm that fits how you create with Kissago.</p>
                </div>
                {walletLoading && <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />}
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {offers.map((offer) => (
                  <article
                    key={offer.planKey}
                    className={`rounded-3xl border p-5 ${offer.isCurrentPlan ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-white/10 bg-neutral-900/60'}`}
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
                      <p>{offer.monthlyPriceMinor === 0 ? 'Free' : `${formatPrice(offer.currencyCode, offer.monthlyPriceMinor)} monthly`}</p>
                      {offer.annualPriceMinor != null && <p>{formatPrice(offer.currencyCode, offer.annualPriceMinor)} yearly</p>}
                      <p>{offer.canAccessDownloads ? 'Downloads included' : 'Hosted sharing included'}</p>
                      <p>{offer.canAccessUnbrandedExports ? 'Unbranded exports included' : 'Kissago branding stays'}</p>
                    </div>

                    <button
                      type="button"
                      disabled={offer.isCurrentPlan || !walletData?.checkoutEnabled}
                      className="mt-5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {offer.isCurrentPlan ? 'Current plan' : walletData?.checkoutEnabled ? 'Choose plan' : 'Checkout coming soon'}
                    </button>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
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
                <div className="grid gap-4 md:grid-cols-3">
                  {topups.map((pack) => (
                    <article key={pack.packKey} className="rounded-3xl border border-white/10 bg-neutral-900/60 p-5">
                      <p className="text-lg font-serif text-neutral-100">{pack.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-neutral-500">{pack.coinAmount.toLocaleString()} coins</p>
                      <p className="mt-5 text-2xl text-neutral-100">{formatPrice(pack.currencyCode, pack.priceMinor)}</p>
                      <button
                        type="button"
                        disabled={!walletData?.checkoutEnabled}
                        className="mt-5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {walletData?.checkoutEnabled ? 'Buy coins' : 'Top-up coming soon'}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
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
