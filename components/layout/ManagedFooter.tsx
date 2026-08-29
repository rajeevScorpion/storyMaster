'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { getEssentialLegalFooterLinksAction } from '@/app/actions/managed-pages';
import type { ManagedFooterLink } from '@/lib/managed-pages/types';

// Minimal, unobtrusive footer per the legal/auth UX pack: Terms and Privacy
// are always public and viewer-independent, so — unlike the old role/billing-
// aware footer — there is nothing here that needs per-user caching.
const FOOTER_CACHE_KEY = 'kissago:managed-footer:v2:essential';
const FOOTER_CACHE_TTL_MS = 5 * 60_000;

function readCachedLinks(): ManagedFooterLink[] | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(FOOTER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cachedAt?: number; links?: ManagedFooterLink[] };
    if (!parsed.cachedAt || !Array.isArray(parsed.links)) return null;
    if (Date.now() - parsed.cachedAt > FOOTER_CACHE_TTL_MS) return null;
    return parsed.links;
  } catch {
    return null;
  }
}

function writeCachedLinks(links: ManagedFooterLink[]): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(FOOTER_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), links }));
  } catch {
    // Storage may be unavailable in private or locked-down browser contexts.
  }
}

let inFlightRequest: Promise<ManagedFooterLink[]> | null = null;

function loadEssentialFooterLinks(): Promise<ManagedFooterLink[]> {
  if (inFlightRequest) return inFlightRequest;
  inFlightRequest = getEssentialLegalFooterLinksAction().finally(() => {
    inFlightRequest = null;
  });
  return inFlightRequest;
}

export default function ManagedFooter() {
  // Deliberately NOT read from sessionStorage in the initializer: that runs
  // during SSR too (where there's no window/cache), so a client with an
  // already-warm cache from an earlier page would render more links on its
  // first pass than the server did, producing a hydration mismatch on the
  // next full page load. Starting empty always matches what SSR produced.
  const [links, setLinks] = useState<ManagedFooterLink[]>([]);

  useEffect(() => {
    let cancelled = false;
    const cached = readCachedLinks();

    if (cached) {
      // Deferred to a microtask rather than called synchronously in the
      // effect body, which react-hooks/set-state-in-effect flags.
      Promise.resolve().then(() => {
        if (!cancelled) setLinks(cached);
      });
      return () => {
        cancelled = true;
      };
    }

    loadEssentialFooterLinks()
      .then((items) => {
        writeCachedLinks(items);
        if (!cancelled) setLinks(items);
      })
      .catch((error) => {
        console.error('Failed to load footer legal links:', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const termsLink = links.find((link) => link.key === 'terms');
  const privacyLink = links.find((link) => link.key === 'privacy_policy');
  const year = new Date().getFullYear();

  return (
    <footer className="mt-[150px] flex min-h-[76px] items-center border-t border-white/10 bg-black px-4 py-7 text-center text-sm leading-6 text-neutral-400 sm:px-6">
      <p className="mx-auto">
        {`© ${year} Kissago`}
        {termsLink ? (
          <>
            {' · '}
            <Link href={termsLink.href} className="transition-colors hover:text-emerald-300">
              Terms
            </Link>
          </>
        ) : null}
        {privacyLink ? (
          <>
            {' · '}
            <Link href={privacyLink.href} className="transition-colors hover:text-emerald-300">
              Privacy
            </Link>
          </>
        ) : null}
        {' · '}
        <Link href="/help-legal" className="transition-colors hover:text-emerald-300">
          Help &amp; Legal
        </Link>
      </p>
    </footer>
  );
}
