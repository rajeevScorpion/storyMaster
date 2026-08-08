'use client';

import type { GalleryRailLayout } from '@/lib/types/database';

const SURFACE = 'shimmer-surface rounded-2xl border border-white/5 bg-neutral-900/60';

/**
 * Placeholders are sized from the same aspect ratios as the real cards so the
 * page does not shift when content lands.
 */
export function HeroSkeleton() {
  return (
    <div className="shimmer-surface relative h-[62dvh] min-h-[420px] max-h-[560px] w-full overflow-hidden bg-neutral-900/60 md:h-[72dvh] md:max-h-[720px]">
      <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 space-y-4 px-4 pb-14 lg:px-8 lg:pb-20">
        <div className="h-3 w-32 rounded bg-neutral-800" />
        <div className="h-10 w-3/4 max-w-xl rounded bg-neutral-800" />
        <div className="h-3 w-48 rounded bg-neutral-800" />
        <div className="h-12 w-40 rounded-2xl bg-neutral-800" />
      </div>
    </div>
  );
}

export function RailSkeleton({ layout = 'wide' }: { layout?: GalleryRailLayout }) {
  const cardClass =
    layout === 'portrait'
      ? 'w-[150px] aspect-[9/16] sm:w-[170px]'
      : 'w-[280px] aspect-video md:w-[320px]';

  return (
    <div>
      <div className="mb-3 px-4 lg:px-8">
        <div className="shimmer-surface h-6 w-40 rounded bg-neutral-800" />
      </div>
      <div className="flex gap-4 overflow-hidden px-4 lg:px-8">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className={`shrink-0 ${SURFACE} ${cardClass}`} />
        ))}
      </div>
    </div>
  );
}

export function GalleryRailsSkeleton() {
  return (
    <div className="space-y-10">
      <RailSkeleton />
      <RailSkeleton />
    </div>
  );
}

export function GridSkeleton({
  count,
  layout = 'wide',
  className,
}: {
  count: number;
  layout?: GalleryRailLayout;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={`${SURFACE} ${layout === 'portrait' ? 'aspect-[9/16]' : 'aspect-video'}`}
        />
      ))}
    </div>
  );
}
