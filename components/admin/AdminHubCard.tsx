import Link from 'next/link';
import type { ComponentType } from 'react';

// Shared hub/workspace card used by the Global Settings overview and the
// Pricing workshop so both hubs render identical card anatomy. The summary
// line renders only when provided.
export default function AdminHubCard({
  href,
  label,
  description,
  summary,
  icon: Icon,
}: {
  href: string;
  label: string;
  description: string;
  summary?: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-white/10 bg-neutral-900/60 p-4 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-emerald-500/10 p-2 text-emerald-300">
            <Icon size={16} />
          </span>
          <span className="text-sm font-medium text-neutral-100 group-hover:text-emerald-200">{label}</span>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
          Open
        </span>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-neutral-400">{description}</p>
      {summary && <p className="mt-4 text-xs text-emerald-300/80">{summary}</p>}
    </Link>
  );
}
