'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Coins, Database, FlaskConical, ImageIcon, Images, Palette, Settings, WalletCards, Wind } from 'lucide-react';

const navItems = [
  { label: 'Content', href: '/admin/content', icon: BookOpen },
  { label: 'Backfill', href: '/admin/backfill', icon: Database },
  { label: 'Share Covers', href: '/admin/share-covers', icon: ImageIcon },
  { label: 'Image Models', href: '/admin/image-models', icon: Images },
  { label: 'Story Playground', href: '/admin/story-playground', icon: FlaskConical },
  { label: 'Reel Playground', href: '/admin/reel-playground', icon: FlaskConical },
  { label: 'Graphic Styles', href: '/admin/graphic-styles', icon: Palette },
  { label: 'Moods', href: '/admin/moods', icon: Wind },
  { label: 'Cost', href: '/admin/cost', icon: WalletCards },
  {
    label: 'Pricing and offers',
    href: '/admin/pricing',
    icon: Coins,
    children: [
      { label: 'Pricing workshop', href: '/admin/pricing' },
      { label: 'Plans', href: '/admin/pricing/plans' },
      { label: 'Top-up packs', href: '/admin/pricing/top-up-packs' },
      { label: 'Promotions', href: '/admin/pricing/promotions' },
      { label: 'Action costs', href: '/admin/pricing/action-costs' },
      { label: 'Runtime controls', href: '/admin/pricing/runtime-controls' },
      { label: 'Recovery tools', href: '/admin/pricing/recovery-tools' },
      { label: 'Recent audit', href: '/admin/pricing/audit' },
    ],
  },
  {
    label: 'Global Settings',
    href: '/admin/settings',
    icon: Settings,
    children: [
      { label: 'Overview', href: '/admin/settings' },
      { label: 'Storyboard', href: '/admin/settings/storyboard' },
      { label: 'Reels', href: '/admin/settings/reels' },
      { label: 'Reader and loader', href: '/admin/settings/reader' },
      { label: 'Narration voices', href: '/admin/settings/narration' },
      { label: 'Authoring', href: '/admin/settings/authoring' },
      { label: 'Character references', href: '/admin/settings/characters' },
      { label: 'Video export', href: '/admin/settings/video-export' },
      { label: 'Generation timeouts', href: '/admin/settings/generation' },
      { label: 'Pages', href: '/admin/settings/pages' },
    ],
  },
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 h-screen w-56 shrink-0 overflow-y-auto border-r border-white/10 bg-white/5 backdrop-blur-xl flex flex-col">
      <div className="p-6 border-b border-white/10">
        <Link href="/admin" className="text-lg font-serif text-neutral-100">
          Kissago Admin
        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ label, href, icon: Icon, children }) => {
          const active = isActivePath(pathname, href);
          return (
            <div key={href}>
              <Link
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300'
                    : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
                }`}
              >
                <Icon size={18} />
                {label}
              </Link>
              {children && active && (
                <div className="mt-1 space-y-1 border-l border-white/10 pl-4">
                  {children.map((child) => {
                    const childActive = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
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
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
