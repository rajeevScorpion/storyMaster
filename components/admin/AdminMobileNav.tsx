'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu, X } from 'lucide-react';
import AdminNavList from '@/components/admin/AdminNavList';

/**
 * Mobile-only (below `md`) admin navigation: a slim top bar with a hamburger
 * that opens a left-anchored slide-in drawer. Mirrors the app's MyStoriesDrawer
 * pattern. On `md` and up this renders nothing and the desktop AdminSidebar
 * takes over.
 */
export default function AdminMobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);
  const close = () => setOpen(false);

  // Close on any route change (covers nav taps and programmatic navigation).
  // Adjusting state during render on a changed value is the React-recommended
  // alternative to a setState-in-effect here.
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (open) setOpen(false);
  }

  return (
    <div className="md:hidden">
      <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-white/10 bg-neutral-950/80 px-4 backdrop-blur-xl">
        <button
          type="button"
          aria-label="Open admin menu"
          onClick={() => setOpen(true)}
          className="rounded-lg p-1.5 text-neutral-300 transition-colors hover:bg-white/5 hover:text-neutral-100"
        >
          <Menu size={20} />
        </button>
        <Link href="/admin" className="text-base font-serif text-neutral-100">
          Kissago Admin
        </Link>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="admin-nav-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={close}
            />
            <motion.div
              key="admin-nav-panel"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed bottom-0 left-0 top-0 z-50 flex w-full max-w-xs flex-col border-r border-white/10 bg-neutral-950/95 backdrop-blur-xl"
            >
              <div className="flex items-center justify-between border-b border-white/10 p-4">
                <Link href="/admin" onClick={close} className="text-base font-serif text-neutral-100">
                  Kissago Admin
                </Link>
                <button
                  type="button"
                  aria-label="Close admin menu"
                  onClick={close}
                  className="rounded-lg p-1.5 text-neutral-300 transition-colors hover:bg-white/5 hover:text-neutral-100"
                >
                  <X size={20} />
                </button>
              </div>
              <nav className="flex-1 space-y-1 overflow-y-auto p-3">
                <AdminNavList childExpansion="accordion" onNavigate={close} />
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
