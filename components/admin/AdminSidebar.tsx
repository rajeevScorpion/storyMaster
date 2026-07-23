'use client';

import Link from 'next/link';
import AdminNavList from '@/components/admin/AdminNavList';

export function AdminSidebar() {
  return (
    <aside className="sticky top-0 h-screen w-56 shrink-0 overflow-y-auto border-r border-white/10 bg-white/5 backdrop-blur-xl flex flex-col">
      <div className="p-6 border-b border-white/10">
        <Link href="/admin" className="text-lg font-serif text-neutral-100">
          Kissago Admin
        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        <AdminNavList />
      </nav>
    </aside>
  );
}
