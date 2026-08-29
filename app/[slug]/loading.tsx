import KissagoLogo from '@/components/ui/KissagoLogo';

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/[0.06] ${className}`} />;
}

/**
 * Streamed the instant navigation to a managed page starts. Removing
 * `force-dynamic` from app/[slug]/page.tsx means the route can now suspend
 * while its cached data resolves — without this file the screen would sit on
 * the previous page with no feedback, which is the "did my click register"
 * complaint this pack was raised to fix.
 */
export default function ManagedPageLoading() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between">
          <KissagoLogo fixed={false} />
        </header>

        <article className="py-14 sm:py-20">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="mt-4 h-11 w-3/4 sm:h-14" />
          <SkeletonBlock className="mt-5 h-6 w-2/3" />
          <SkeletonBlock className="mt-5 h-4 w-40" />

          <div className="mt-12 border-t border-white/10 pt-10">
            <div className="space-y-5">
              {Array.from({ length: 6 }).map((_, index) => (
                <SkeletonBlock key={index} className={`h-4 ${index % 3 === 2 ? 'w-5/6' : 'w-full'}`} />
              ))}
            </div>
          </div>
        </article>
      </div>
    </main>
  );
}
