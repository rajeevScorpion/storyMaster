'use client';

import Link from 'next/link';
import type { MouseEventHandler } from 'react';

interface KissagoLogoProps {
  fixed?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

export default function KissagoLogo({ fixed = true, onClick }: KissagoLogoProps) {
  return (
    <Link
      href="/"
      onClick={onClick}
      className={`${
        // max() collapses to the plain 1rem inset wherever the device reports
        // no safe area, so this only shifts under OS chrome (notch, Capacitor).
        fixed
          ? 'fixed top-[max(1rem,var(--safe-top))] left-[max(1rem,var(--safe-left))] z-40 '
          : ''
      }px-5 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md text-xl font-serif font-semibold tracking-wide text-emerald-400 hover:bg-white/10 hover:border-emerald-500/30 transition-all duration-200 cursor-pointer`}
    >
      kissago
    </Link>
  );
}
