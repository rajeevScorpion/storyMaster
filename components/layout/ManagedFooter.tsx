'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, ExternalLink } from 'lucide-react';

import { getManagedFooterLinksAction } from '@/app/actions/managed-pages';
import { useAuth } from '@/lib/hooks/useAuth';
import type { ManagedFooterLink } from '@/lib/managed-pages/types';

const FOOTER_LABELS: Record<string, string> = {
  privacy_policy: 'Privacy Policy',
  content_usage_policy: 'Content Policy',
  terms: 'Terms',
  refund_policy: 'Refund Policy',
  contact_support: 'Support',
  blog_news: 'News',
  documentation: 'Documentation',
  faq: 'FAQ',
  ai_disclosure: 'AI Disclosure',
  copyright_licensing: 'Copyright and Licensing',
  account_deletion: 'Account Deletion',
};

function getFooterLabel(link: ManagedFooterLink): string {
  return FOOTER_LABELS[link.key] ?? link.title.replaceAll(' / ', ' and ');
}

const FOOTER_MENU_GROUPS = [
  {
    id: 'policies',
    label: 'Policies',
    keys: ['privacy_policy', 'content_usage_policy', 'refund_policy'],
  },
  {
    id: 'rights',
    label: 'AI and Rights',
    keys: ['ai_disclosure', 'copyright_licensing'],
  },
] as const;

const GROUPED_FOOTER_KEYS = new Set<string>(FOOTER_MENU_GROUPS.flatMap((group) => group.keys));
const FOOTER_CACHE_TTL_MS = 60_000;
const PUBLIC_FOOTER_CACHE_KEY = 'kissago:managed-footer:v1:public';
const footerRequests = new Map<string, Promise<ManagedFooterLink[]>>();

type FooterItem =
  | { type: 'link'; key: string; order: number; link: ManagedFooterLink }
  | { type: 'menu'; key: string; order: number; label: string; links: ManagedFooterLink[] };

function buildFooterItems(links: ManagedFooterLink[]): FooterItem[] {
  const linkByKey = new Map(links.map((link) => [link.key, link]));
  const items: FooterItem[] = [];

  FOOTER_MENU_GROUPS.forEach((group) => {
    const groupLinks = group.keys
      .map((key) => linkByKey.get(key))
      .filter((link): link is ManagedFooterLink => Boolean(link));

    if (groupLinks.length > 0) {
      items.push({
        type: 'menu',
        key: group.id,
        label: group.label,
        links: groupLinks,
        order: Math.min(...groupLinks.map((link) => link.footerOrder)),
      });
    }
  });

  links.forEach((link) => {
    if (GROUPED_FOOTER_KEYS.has(link.key)) return;
    items.push({ type: 'link', key: link.key, link, order: link.footerOrder });
  });

  return items.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

function getViewerFooterCacheKey(userId: string | null): string {
  return userId ? `kissago:managed-footer:v1:user:${userId}` : PUBLIC_FOOTER_CACHE_KEY;
}

function readCachedFooterLinks(cacheKey: string): ManagedFooterLink[] | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cachedAt?: number; links?: ManagedFooterLink[] };
    if (!parsed.cachedAt || !Array.isArray(parsed.links)) return null;
    if (Date.now() - parsed.cachedAt > FOOTER_CACHE_TTL_MS) return null;
    return parsed.links;
  } catch {
    return null;
  }
}

function writeCachedFooterLinks(cacheKey: string, links: ManagedFooterLink[]): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), links }));
  } catch {
    // Storage may be unavailable in private or locked-down browser contexts.
  }
}

function loadFooterLinks(cacheKey: string): Promise<ManagedFooterLink[]> {
  const existing = footerRequests.get(cacheKey);
  if (existing) return existing;

  const request = getManagedFooterLinksAction().finally(() => {
    footerRequests.delete(cacheKey);
  });
  footerRequests.set(cacheKey, request);
  return request;
}

function FooterLink({
  link,
  onClick,
  className = '',
}: {
  link: ManagedFooterLink;
  onClick?: () => void;
  className?: string;
}) {
  const label = getFooterLabel(link);

  return (
    <Link
      href={link.href}
      target={link.openInNewTab ? '_blank' : undefined}
      rel={link.openInNewTab ? 'noreferrer' : undefined}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors hover:text-emerald-300 ${className}`}
    >
      <span>{label}</span>
      {link.openInNewTab ? <ExternalLink size={12} strokeWidth={1.8} aria-hidden="true" /> : null}
    </Link>
  );
}

export default function ManagedFooter() {
  const { user, isLoading } = useAuth();
  const [links, setLinks] = useState<ManagedFooterLink[]>(() => readCachedFooterLinks(PUBLIC_FOOTER_CACHE_KEY) ?? []);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  const footerItems = useMemo(() => buildFooterItems(links), [links]);

  useEffect(() => {
    if (isLoading) return;

    let cancelled = false;
    const cacheKey = getViewerFooterCacheKey(user?.id ?? null);
    const cachedLinks = readCachedFooterLinks(cacheKey);

    if (cachedLinks) {
      Promise.resolve().then(() => {
        if (!cancelled) setLinks(cachedLinks);
      });
      return () => {
        cancelled = true;
      };
    }

    loadFooterLinks(cacheKey)
      .then((items) => {
        const includesAdminOnlyDocs = items.some((item) => item.key === 'documentation');

        writeCachedFooterLinks(cacheKey, items);
        if (!includesAdminOnlyDocs) {
          writeCachedFooterLinks(PUBLIC_FOOTER_CACHE_KEY, items);
        }

        if (!cancelled) setLinks(items);
      })
      .catch((error) => {
        console.error('Failed to load managed footer links:', error);
        if (!cancelled) setLinks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoading, user?.id]);

  useEffect(() => {
    if (!openMenu) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (footerRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenu]);

  if (links.length === 0) return null;

  return (
    <footer ref={footerRef} className="border-t border-white/10 bg-black px-4 py-7 text-neutral-400 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <nav
          aria-label="Footer pages"
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-center text-sm leading-6"
        >
          {footerItems.map((item) => {
            if (item.type === 'link') {
              return <FooterLink key={item.key} link={item.link} />;
            }

            const expanded = openMenu === item.key;

            return (
              <div key={item.key} className="relative inline-flex justify-center">
                <button
                  type="button"
                  onClick={() => setOpenMenu(expanded ? null : item.key)}
                  aria-expanded={expanded}
                  className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors hover:text-emerald-300"
                >
                  <span>{item.label}</span>
                  <ChevronUp size={13} strokeWidth={1.8} aria-hidden="true" />
                </button>

                {expanded ? (
                  <div className="absolute bottom-full left-1/2 z-30 mb-3 min-w-56 -translate-x-1/2 rounded-xl border border-white/10 bg-neutral-950/95 p-2 text-left shadow-2xl shadow-black/50 backdrop-blur-md">
                    <div className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/10 bg-neutral-950/95" />
                    <div className="relative flex flex-col gap-1">
                      {item.links.map((link) => (
                        <FooterLink
                          key={link.key}
                          link={link}
                          onClick={() => setOpenMenu(null)}
                          className="w-full justify-start rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-white/5"
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </div>
    </footer>
  );
}
