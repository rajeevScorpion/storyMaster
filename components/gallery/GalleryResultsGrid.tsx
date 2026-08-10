'use client';

import { motion, useReducedMotion } from 'motion/react';
import StorylineCard from '@/components/gallery/StorylineCard';
import type { GalleryItem, GalleryRailLayout } from '@/lib/types/database';

export const RESULTS_GRID_CLASS: Record<GalleryRailLayout, string> = {
  wide: 'grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
  portrait: 'grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8',
};

export const RESULTS_CARD_SIZES: Record<GalleryRailLayout, string> = {
  wide: '(max-width: 640px) 92vw, (max-width: 1024px) 46vw, (max-width: 1280px) 31vw, (max-width: 1536px) 24vw, 19vw',
  portrait: '(max-width: 640px) 46vw, (max-width: 768px) 31vw, (max-width: 1280px) 23vw, (max-width: 1536px) 16vw, 12vw',
};

interface GalleryResultsGridProps {
  items: GalleryItem[];
  layout: GalleryRailLayout;
  savedIds: Set<string>;
  isLoggedIn: boolean;
  onToggleSave: (storylineId: string, saved: boolean) => void;
  hideEngagementCounts?: boolean;
  /** Overrides the default column ramp (the kids grid runs wider cards). */
  gridClassName?: string;
  sizes?: string;
  /** Stagger resets per page, so appended pages animate from their own start. */
  pageSize?: number;
}

/**
 * The result surface shared by search on both discovery routes. Cards here are
 * plain links: expansion is a rail affordance, and a grid that reflows on hover
 * would fight the scroll.
 */
export default function GalleryResultsGrid({
  items,
  layout,
  savedIds,
  isLoggedIn,
  onToggleSave,
  hideEngagementCounts = false,
  gridClassName,
  sizes,
  pageSize = 12,
}: GalleryResultsGridProps) {
  const prefersReducedMotion = useReducedMotion();

  const enterProps = (index: number) =>
    prefersReducedMotion
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.35, delay: (index % pageSize) * 0.03 },
        };

  return (
    <div className={gridClassName ?? RESULTS_GRID_CLASS[layout]}>
      {items.map((item, index) => (
        <motion.div key={item.id} {...enterProps(index)}>
          <StorylineCard
            item={item}
            layout={layout}
            sizes={sizes ?? RESULTS_CARD_SIZES[layout]}
            isSaved={savedIds.has(item.id)}
            isLoggedIn={isLoggedIn}
            hideEngagementCounts={hideEngagementCounts}
            onToggleSave={onToggleSave}
          />
        </motion.div>
      ))}
    </div>
  );
}
