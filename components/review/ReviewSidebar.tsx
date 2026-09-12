'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ClipboardCheck, History, UserCheck } from 'lucide-react';
import type { ComponentType } from 'react';

// ── Agentic Creator System: Phase 9c, Unit 9L ───────────────────────────
//
// The reviewer workspace's own minimal nav, living in app/review/ (not
// components/admin/) on purpose -- app/review/layout.tsx must never import
// AdminSidebar or any admin nav (plan section 4.2/4: a reviewer is not staff and
// must not see the ~40-page admin information architecture). This is a client
// component, unlike its server layout, because highlighting the active item
// needs usePathname()/useSearchParams() -- Next's App Router deliberately does
// not hand a layout its own searchParams (that would re-render the whole
// subtree on every query change), so there is no way to do this from the server
// component above it.
//
// Three items: Queue, "My assignments", and (Unit 9k) History. The first two are the
// same page under different filters; History is its own route, /review/history,
// because it reads a different table (agent_review_decisions, 112) and shows finished
// work rather than a queue.
//
// "My assignments" is NOT a separate route -- there is only one page under
// /review. It links to `/review?assignment=mine`, which app/review/page.tsx
// reads to both fetch initialRows already filtered server-side and seed
// ReviewQueue's own assignment dropdown to match (see that file's
// parseAssignmentParam and ReviewQueue's initialAssignmentFilter prop).
//
// Phase 10 Round 3, 5.3: with the queue itself scoped to a plain reviewer's own
// assignments (agentic-review.ts's listReviewQueueAction clamp, 5.2), "Queue" and
// "My assignments" are the same list for them -- so this item is dropped for role
// 'reviewer' and kept for 'editor', who still sees everyone by default and uses it
// to narrow down. `role` only decides which items THIS nav renders -- the route
// itself is untouched, so `/review?assignment=mine` keeps working as a bookmarked
// URL for anyone, reviewer included.
type ReviewSidebarRole = 'reviewer' | 'editor';

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  isActive: (pathname: string, assignment: string | null) => boolean;
  /** Omit to show for every role; set to restrict to specific roles (5.3). */
  roles?: readonly ReviewSidebarRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/review',
    label: 'Queue',
    icon: ClipboardCheck,
    isActive: (pathname, assignment) => pathname === '/review' && assignment !== 'mine',
  },
  {
    href: '/review?assignment=mine',
    label: 'My assignments',
    icon: UserCheck,
    isActive: (pathname, assignment) => pathname === '/review' && assignment === 'mine',
    roles: ['editor'],
  },
  {
    href: '/review/history',
    label: 'History',
    icon: History,
    // A real route, so the assignment param is irrelevant to whether this is active.
    isActive: (pathname) => pathname === '/review/history',
  },
];

export default function ReviewSidebar({ role }: { role: ReviewSidebarRole }) {
  const pathname = usePathname();
  const assignment = useSearchParams().get('assignment');
  const items = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 md:w-48 md:shrink-0 md:flex-col md:overflow-visible md:pb-0">
      {items.map((item) => {
        const active = item.isActive(pathname, assignment);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors md:shrink ${
              active
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                : 'border-white/10 bg-white/[0.02] text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
