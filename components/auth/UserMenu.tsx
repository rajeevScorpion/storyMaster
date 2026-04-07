'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { User, LogOut, LogIn, BookMarked, Loader2, Coins, Wallet } from 'lucide-react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { COINS_PER_BEAT } from '@/lib/types/pricing';

interface UserMenuProps {
  onMyStories?: () => void;
}

export default function UserMenu({ onMyStories }: UserMenuProps) {
  const { user, isLoading, openAuthDialog, signOut } = useAuth();
  const { data: pricing, isLoading: pricingLoading } = usePricingRuntime();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const avatarUrl = user.user_metadata?.avatar_url;
  const displayName = user.user_metadata?.full_name || user.email || 'User';
  const totalCoins = pricing.snapshot.availableTotalBeats * COINS_PER_BEAT;
  const monthlyAllowanceCoins = pricing.snapshot.monthlyIncludedBeats * COINS_PER_BEAT;
  const displayCoins = totalCoins > 0 ? totalCoins : monthlyAllowanceCoins;
  const refillLabel = pricing.snapshot.nextResetAt
    ? new Date(pricing.snapshot.nextResetAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;
  const planLabel = `${pricing.snapshot.planKey.charAt(0).toUpperCase()}${pricing.snapshot.planKey.slice(1)} plan`;

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
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
            className="absolute right-0 mt-2 w-56 rounded-2xl bg-neutral-900/95 border border-white/10 backdrop-blur-xl shadow-2xl overflow-hidden z-50"
          >
            <div className="px-4 py-3 border-b border-white/5">
              <p className="text-sm font-medium text-neutral-200 truncate">{displayName}</p>
              <p className="text-xs text-neutral-500 truncate">{user.email}</p>
            </div>

            <div className="mx-3 mt-3 rounded-2xl border border-emerald-500/15 bg-emerald-500/8 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-300/80">{planLabel}</p>
                  <p className="mt-1 text-lg font-medium text-neutral-100">
                    {pricingLoading ? '...' : `${displayCoins.toLocaleString()} ${totalCoins > 0 ? 'coins' : 'coins / month'}`}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400">
                    {totalCoins > 0
                      ? (
                        pricing.snapshot.isInGracePeriod
                          ? 'Payment issue detected. Access is still active for now.'
                          : refillLabel
                            ? `Refills on ${refillLabel}`
                            : 'Wallet summary for your current account'
                      )
                      : 'Monthly allowance preview while billing is being wired up.'}
                  </p>
                </div>
                <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                  <Coins className="h-4 w-4" />
                </div>
              </div>
            </div>

            <div className="py-1">
              <Link
                href="/wallet"
                onClick={() => setIsOpen(false)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 hover:text-neutral-100 transition-colors"
              >
                <Wallet className="w-4 h-4" />
                Wallet & Billing
              </Link>
              {onMyStories && (
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onMyStories();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 hover:text-neutral-100 transition-colors"
                >
                  <BookMarked className="w-4 h-4" />
                  My Stories
                </button>
              )}
              <button
                onClick={() => {
                  setIsOpen(false);
                  signOut();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 hover:text-red-300 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
