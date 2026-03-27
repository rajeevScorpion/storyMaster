'use client';

interface KissagoLogoProps {
  fixed?: boolean;
}

export default function KissagoLogo({ fixed = true }: KissagoLogoProps) {
  return (
    <a
      href="/"
      className={`${fixed ? 'fixed top-4 left-4 z-40 ' : ''}px-5 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md text-xl font-serif font-semibold tracking-wide text-emerald-400 hover:bg-white/10 hover:border-emerald-500/30 transition-all duration-200 cursor-pointer`}
    >
      kissago
    </a>
  );
}
