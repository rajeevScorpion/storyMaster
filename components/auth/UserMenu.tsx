'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { User, LogOut, LogIn, BookMarked, Loader2, Coins, Wallet, LifeBuoy, ClipboardCheck, Receipt, Trash2, Layers } from 'lucide-react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { COINS_PER_BEAT, type PlanKey } from '@/lib/types/pricing';
import { formatBillingDayMonth } from '@/lib/billing/billing-dates.shared';
import { startNavigationProgress } from '@/lib/navigation/progress';
import { getAccountDeletionEnabled } from '@/app/actions/account';

// Only pages that don't host their own drawer need this one, so it loads on first open.
const MyStoriesDrawer = dynamic(() => import('@/components/story/MyStoriesDrawer'), { ssr: false });

interface UserMenuProps {
  onMyStories?: () => void;
  /** Story surfaces pass true: navigating to the wallet reloads the page, which would drop the in-memory story session. */
  openWalletInNewTab?: boolean;
}

function beatsToCoins(value: number) {
  return Number((value * COINS_PER_BEAT).toFixed(2));
}

// Unit 9L, D20 (docs/agentic-creator-phase9c-plan.md section 4.1): the current
// user's reviewer standing rides the pricing-runtime payload -- see
// PricingRuntimeProvider.tsx -- so this badge and the "Review queue" link below
// cost zero additional requests. Both render only when `reviewer` is non-null,
// i.e. only for the small fraction of signed-in users who are an active reviewer
// or editor (lib/agentic/reviewers.ts's resolveMyReviewerStanding()).
const REVIEWER_ROLE_LABELS: Record<'reviewer' | 'editor', string> = {
  reviewer: 'Reviewer',
  editor: 'Editor',
};

// Each plan keeps one colour everywhere in the menu; indigo stays reserved for the role badge.
const PLAN_BADGES: Record<PlanKey, { label: string; className: string }> = {
  free: { label: 'Free', className: 'border-white/10 bg-white/5 text-neutral-300' },
  audience: { label: 'Audience', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' },
  plus: { label: 'Plus', className: 'border-purple-500/25 bg-purple-500/10 text-purple-300' },
  studio: { label: 'Studio', className: 'border-amber-500/25 bg-amber-500/10 text-amber-300' },
};

const MENU_ITEM_CLASS =
  'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 hover:text-neutral-100 transition-colors';

function MenuDivider() {
  return <div role="separator" className="mx-3 my-1 h-px bg-white/5" />;
}

export default function UserMenu({ onMyStories, openWalletInNewTab = false }: UserMenuProps) {
  const { user, isLoading, openAuthDialog, signOut } = useAuth();
  const { data: pricing, isLoading: pricingPayloadLoading } = usePricingRuntime();
  const [isOpen, setIsOpen] = useState(false);
  const [ownDrawerOpen, setOwnDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Payments Phase 2 plan §7: "Delete account" is hidden while account_deletion_enabled is off.
  // Defaults to hidden (fail closed) until the flag check resolves, rather than flashing the link
  // and then removing it. Fetched only for a signed-in user -- there is nothing to gate otherwise.
  const [accountDeletionEnabled, setAccountDeletionEnabled] = useState(false);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getAccountDeletionEnabled()
      .then((enabled) => {
        if (!cancelled) setAccountDeletionEnabled(enabled);
      })
      .catch(() => {
        // Fail closed: leave the link hidden on any error, matching getFeatureFlag's own fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  if (isLoading) {
    return (
      <div className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center">
        <Loader2 className="w-4 h-4 text-neutral-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <button
        onClick={() => openAuthDialog('sign_in')}
        className="flex items-center gap-2 px-3 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-emerald-500/30 transition-all text-sm text-neutral-300 hover:text-neutral-100 backdrop-blur-md"
      >
        <LogIn className="w-4 h-4" />
        <span className="hidden sm:inline">Sign in</span>
      </button>
    );
  }

  // Right after a dialog sign-in the provider still holds the signed-out payload until its refetch
  // lands; showing it would read as "Free, 0 coins". Another account's payload counts as loading.
  const pricingLoading = pricingPayloadLoading || pricing.userId !== user.id;
  const avatarUrl = user.user_metadata?.avatar_url;
  const displayName = user.user_metadata?.full_name || user.email || 'User';
  const totalCoins = beatsToCoins(pricing.snapshot.availableTotalBeats);
  const monthlyAllowanceCoins = beatsToCoins(pricing.snapshot.monthlyIncludedBeats);
  const showAllowancePreview =
    !pricing.controls.pricingSnapshotEnabled &&
    pricing.snapshot.planKey !== 'free' &&
    monthlyAllowanceCoins > 0;
  const displayCoins = showAllowancePreview ? monthlyAllowanceCoins : totalCoins;
  const refillLabel = formatBillingDayMonth(pricing.snapshot.nextResetAt);
  const planBadge = PLAN_BADGES[pricing.snapshot.planKey] ?? PLAN_BADGES.free;
  const billingLinkProps = {
    target: openWalletInNewTab ? '_blank' : undefined,
    rel: openWalletInNewTab ? 'noopener' : undefined,
    onClick: () => setIsOpen(false),
  };
  const openMyStories = () => {
    setIsOpen(false);
    if (onMyStories) onMyStories();
    else setOwnDrawerOpen(true);
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Account menu"
        className="w-9 h-9 rounded-full overflow-hidden border-2 border-white/10 hover:border-emerald-500/40 transition-all ring-0 hover:ring-2 hover:ring-emerald-500/20"
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={displayName}
            width={36}
            height={36}
            className="object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full bg-emerald-500/20 flex items-center justify-center">
            <User className="w-4 h-4 text-emerald-400" />
          </div>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-60 rounded-2xl bg-neutral-900/95 border border-white/10 backdrop-blur-xl shadow-2xl overflow-hidden z-50"
          >
            <div className="px-4 py-3 border-b border-white/5">
              <p className="text-sm font-medium text-neutral-200 truncate">{displayName}</p>
              <p className="text-xs text-neutral-500 truncate">{user.email}</p>
              {/* `pricing.reviewer` is null both while the runtime payload is in
                  flight and when the viewer genuinely is not a reviewer. Rendering
                  nothing for both made a reviewer's own standing briefly invisible
                  on every cold load -- the menu showed the plain non-reviewer shape
                  until the fetch landed. The skeleton keeps the two states apart,
                  and does the same for the plan badge. */}
              {pricingLoading ? (
                <span
                  aria-hidden="true"
                  className="mt-2 inline-flex h-[22px] w-28 animate-pulse rounded-full border border-white/5 bg-white/5"
                />
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${planBadge.className}`}
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                    {planBadge.label}
                    <span className="sr-only"> plan</span>
                  </span>
                  {pricing.reviewer && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
                      <ClipboardCheck className="w-3 h-3" />
                      {REVIEWER_ROLE_LABELS[pricing.reviewer.role]}
                    </span>
                  )}
                </div>
              )}
            </div>

            <Link
              href="/wallet"
              {...billingLinkProps}
              className="mx-3 mt-3 block rounded-2xl border border-emerald-500/15 bg-emerald-500/8 px-4 py-3 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/10"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-300/80">Your coins</p>
                  <p className="mt-1 text-lg font-medium text-neutral-100">
                    {pricingLoading ? '...' : `${displayCoins.toLocaleString()} ${showAllowancePreview ? 'coins / month' : 'coins'}`}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400">
                    {showAllowancePreview
                      ? 'Plan allowance preview while live wallet tracking is still switched off.'
                      : totalCoins > 0
                      ? (
                        pricing.snapshot.isInGracePeriod
                          ? 'A renewal payment needs attention. Access is still active for now.'
                          : refillLabel
                            ? `Refills on ${refillLabel}`
                            : 'Wallet summary for your current account'
                      )
                      : refillLabel
                        ? `Wallet is empty for now. Refills on ${refillLabel}.`
                        : 'Wallet is empty for now. Top up or change plans to keep creating.'}
                  </p>
                </div>
                <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                  <Coins className="h-4 w-4" />
                </div>
              </div>
            </Link>

            <div className="mt-2 py-1">
              <button type="button" onClick={openMyStories} className={MENU_ITEM_CLASS}>
                <BookMarked className="w-4 h-4" />
                My Stories
              </button>
              {/* Same reasoning as the badge above: a loading payload must not be
                  rendered as "you have no review queue". */}
              {pricingLoading && (
                <div
                  aria-hidden="true"
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="h-4 w-4 animate-pulse rounded bg-white/5" />
                  <span className="h-3 w-28 animate-pulse rounded bg-white/5" />
                </div>
              )}
              {!pricingLoading && pricing.reviewer && (
                <Link
                  href="/review"
                  onClick={() => setIsOpen(false)}
                  // Explicit aria-label rather than letting the link's name compute from
                  // its children: with no whitespace between the "Review queue" span and
                  // the count bubble's own text node, the computed name would otherwise
                  // read as "Review queue3" for a screen reader.
                  aria-label={
                    pricing.reviewer.assignedCount > 0
                      ? `Review queue, ${pricing.reviewer.assignedCount} assigned to you`
                      : 'Review queue'
                  }
                  className={MENU_ITEM_CLASS}
                >
                  <ClipboardCheck className="w-4 h-4" />
                  <span className="flex-1 text-left">Review queue</span>
                  {/* Phase 10 Round 3, 5.4: active assignments whose run is still
                      awaiting review -- never all-time assignments, and never shown
                      as a "0" bubble (that's noise, not information). */}
                  {pricing.reviewer.assignedCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-500/20 px-1.5 text-[11px] font-semibold leading-none text-indigo-300"
                    >
                      {pricing.reviewer.assignedCount}
                    </span>
                  )}
                </Link>
              )}

              <MenuDivider />
              <Link href="/wallet" {...billingLinkProps} className={MENU_ITEM_CLASS}>
                <Wallet className="w-4 h-4" />
                Wallet
              </Link>
              <Link href="/plans" {...billingLinkProps} className={MENU_ITEM_CLASS}>
                <Layers className="w-4 h-4" />
                Plans
              </Link>
              <Link href="/account/billing" {...billingLinkProps} className={MENU_ITEM_CLASS}>
                <Receipt className="w-4 h-4" />
                Billing
              </Link>

              <MenuDivider />
              <Link href="/help-legal" onClick={() => setIsOpen(false)} className={MENU_ITEM_CLASS}>
                <LifeBuoy className="w-4 h-4" />
                Help & Legal
              </Link>

              <MenuDivider />
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  // signOut() ends in a full document navigation to /signed-out
                  // (see AuthProvider's SIGNED_OUT handler), which the progress
                  // bar's click listener can't see coming — start it manually.
                  startNavigationProgress();
                  signOut();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 hover:text-red-300 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
              {accountDeletionEnabled && (
                <Link
                  href="/account/delete"
                  onClick={() => setIsOpen(false)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-500 hover:bg-white/5 hover:text-rose-300 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete account
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pages without their own My Stories drawer get this one. Portalled, because a header with a
          backdrop blur would otherwise become the drawer's containing block. */}
      {!onMyStories && ownDrawerOpen &&
        createPortal(<MyStoriesDrawer isOpen onClose={() => setOwnDrawerOpen(false)} />, document.body)}
    </div>
  );
}
