'use client';

import Link from 'next/link';
import { ArrowLeft, Baby, Plus, Search, X } from 'lucide-react';
import KissagoLogo from '@/components/ui/KissagoLogo';
import UserMenu from '@/components/auth/UserMenu';
import GallerySearchField from '@/components/gallery/GallerySearchField';

interface GalleryTopBarProps {
  searchOpen: boolean;
  query: string;
  onQueryChange: (next: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onMyStories: () => void;
  /** The kids surface swaps the Kids shortcut for a way back to the main feed. */
  variant?: 'main' | 'kids';
}

/**
 * The one fixed row across the top of both discovery surfaces.
 *
 * Search lives here rather than in a section at the bottom of the page, because
 * searching and browsing are different intents: an OTT header offers the search
 * affordance everywhere and swaps the page underneath it, instead of asking the
 * viewer to scroll past the whole catalogue to reach a filter bar.
 *
 * On desktop the field is always present. On phones there is no room beside the
 * logo and the account controls, so search is an icon that expands this bar into
 * a dedicated search header.
 *
 * Create is the one filled control here. The gallery is the front door and
 * authoring is the other half of the platform, so it cannot read as another
 * utility link sitting between Search and the avatar. It is shown signed-out
 * too: the composer already stashes an anonymous prompt and opens sign-in on
 * Begin, so "compose, then sign in" is the funnel — hiding Create would mean
 * never telling a visitor they can make one of these.
 */
export default function GalleryTopBar({
  searchOpen,
  query,
  onQueryChange,
  onOpenSearch,
  onCloseSearch,
  onMyStories,
  variant = 'main',
}: GalleryTopBarProps) {
  return (
    <div className="fixed inset-x-0 top-0 z-40 flex items-center gap-2 pb-3 pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))] pt-[max(0.75rem,var(--safe-top))]">
      {/* Expanded mobile search header. Replaces the row rather than stacking
          under it, so the results start at the top of the viewport. */}
      {searchOpen && (
        <div className="flex w-full items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={onCloseSearch}
            aria-label="Close search"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-neutral-200 backdrop-blur-md transition-colors hover:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <GallerySearchField
            value={query}
            onChange={onQueryChange}
            onEscape={onCloseSearch}
            autoFocus
            className="flex-1"
            placeholder="Search stories, authors"
          />
        </div>
      )}

      <div className={`${searchOpen ? 'hidden md:flex' : 'flex'} w-full items-center gap-2`}>
        <KissagoLogo fixed={false} />

        <GallerySearchField
          value={query}
          onChange={onQueryChange}
          onActivate={searchOpen ? undefined : onOpenSearch}
          onEscape={onCloseSearch}
          className="ml-2 hidden w-full max-w-sm md:block lg:max-w-md"
        />

        <div className="ml-auto flex items-center gap-2">
          {/* Desktop needs a visible way out: the logo goes home, not back to
              the feed, and Escape is not an affordance anyone can see. */}
          {searchOpen && (
            <button
              type="button"
              onClick={onCloseSearch}
              className="hidden min-h-11 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-neutral-300 backdrop-blur-md transition-colors hover:border-white/20 hover:bg-white/10 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 md:flex"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Close
            </button>
          )}

          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search stories"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-neutral-200 backdrop-blur-md transition-colors hover:border-emerald-500/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 md:hidden"
          >
            <Search className="h-5 w-5" />
          </button>

          <Link
            href="/create"
            className="flex min-h-11 items-center gap-1.5 rounded-full bg-emerald-300 px-4 text-sm font-semibold text-neutral-950 shadow-[0_10px_40px_rgba(52,211,153,0.2)] transition-colors hover:bg-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create
          </Link>

          {variant === 'kids' ? (
            <Link
              href="/"
              aria-label="Back to Kissago"
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-neutral-200 backdrop-blur-md transition-colors hover:border-emerald-500/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Back to Kissago</span>
            </Link>
          ) : (
            <Link
              href="/gallery/kids"
              aria-label="Kids"
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-neutral-200 backdrop-blur-md transition-colors hover:border-emerald-500/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              <Baby className="h-4 w-4" aria-hidden="true" />
              {/* Create took the room this label used to have. The icon alone
                  carries it on phones; the word returns from sm up. */}
              <span className="hidden sm:inline">Kids</span>
            </Link>
          )}

          <UserMenu onMyStories={onMyStories} />
        </div>
      </div>
    </div>
  );
}
