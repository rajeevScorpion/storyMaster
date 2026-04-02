'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Database, FlaskConical, Settings } from 'lucide-react';

const navItems = [
  { label: 'Content', href: '/admin/content', icon: BookOpen },
  { label: 'Backfill', href: '/admin/backfill', icon: Database },
  { label: 'Playground', href: '/admin/playground', icon: FlaskConical },
  { label: 'Global Settings', href: '/admin/settings', icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-white/10 bg-white/5 backdrop-blur-xl flex flex-col">
      <div className="p-6 border-b border-white/10">
        <Link href="/admin" className="text-lg font-serif text-neutral-100">
          Kissago Admin
        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ label, href, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
