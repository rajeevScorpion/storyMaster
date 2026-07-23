'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ADMIN_NAV, type AdminNavItem } from '@/lib/admin/nav';

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Shared admin nav renderer used by both the desktop sidebar and the mobile
 * drawer. Driven entirely by ADMIN_NAV.
 *
 * - `active-route` (desktop): a parent's children show only while its route is
 *   active — this preserves the sidebar's prior behavior exactly.
 * - `accordion` (mobile drawer): parents expand/collapse via a chevron, seeded
 *   open when their route is active.
 */
export default function AdminNavList({
  onNavigate,
  childExpansion = 'active-route',
}: {
  onNavigate?: () => void;
  childExpansion?: 'active-route' | 'accordion';
}) {
  const pathname = usePathname();

  return (
    <>
      {ADMIN_NAV.map((group, groupIndex) => (
        <div key={group.id}>
          <p
            className={`px-3 ${groupIndex === 0 ? 'pt-1' : 'pt-4'} pb-1 text-[10px] font-medium uppercase tracking-wider text-neutral-600`}
          >
            {group.label}
          </p>
          {group.items.map((item) => (
            <AdminNavRow
              key={item.href}
              item={item}
              pathname={pathname}
              onNavigate={onNavigate}
              childExpansion={childExpansion}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function AdminNavRow({
  item,
  pathname,
  onNavigate,
  childExpansion,
}: {
  item: AdminNavItem;
  pathname: string;
  onNavigate?: () => void;
  childExpansion: 'active-route' | 'accordion';
}) {
  const active = isActivePath(pathname, item.href);
  const hasChildren = Boolean(item.childGroups?.length);
  const [expanded, setExpanded] = useState(active);
  const Icon = item.icon;

  const rowClass = `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
    active
      ? 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300'
      : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
  }`;

  const showChildren = hasChildren && (childExpansion === 'accordion' ? expanded : active);

  return (
    <div>
      {childExpansion === 'accordion' && hasChildren ? (
        <div className={`${rowClass} pr-1`}>
          <Link href={item.href} onClick={onNavigate} className="flex flex-1 items-center gap-3">
            <Icon size={18} />
            {item.label}
          </Link>
          <button
            type="button"
            aria-label={expanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="rounded p-1 text-neutral-400 transition-colors hover:text-neutral-200"
          >
            <ChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      ) : (
        <Link href={item.href} onClick={onNavigate} className={rowClass}>
          <Icon size={18} />
          {item.label}
        </Link>
      )}

      {showChildren && (
        <div className="mt-1 space-y-1 border-l border-white/10 pl-4">
          {item.childGroups!.map((childGroup) => (
            <div key={childGroup.id}>
              {childGroup.label && (
                <p className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-neutral-600">
                  {childGroup.label}
                </p>
              )}
              {childGroup.items.map((child) => {
                const childActive = pathname === child.href;
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={onNavigate}
                    className={`block rounded-lg px-3 py-2 text-xs transition-colors ${
                      childActive
                        ? 'bg-emerald-500/10 text-emerald-200'
                        : 'text-neutral-500 hover:bg-white/5 hover:text-neutral-300'
                    }`}
                  >
                    {child.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
